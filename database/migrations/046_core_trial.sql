-- 046-core-trial-apply.sql (revisão 2, parecer SecOps/Tech Lead)
-- Migração aditiva. Decisões do usuário (26/11):
--   (1) Módulos essenciais (core) = Dashboard e Vendas/PDV: sempre ligados, não desligáveis por override.
--       Os demais seguem como estão. 'settings' continua NÃO core.
--   (2) Trial = mesmos módulos do Avançado (como na página de vendas). A loja em trial SEM linha em subscriptions
--       lê os módulos do plano 'avancado'. Não altera o CHECK de subscriptions.
-- Sem DELETE. Sem alterar outras linhas do catálogo.
-- Substitui apply_store_modules (036) e store_module_enabled (036) com a mesma assinatura e o mesmo comportamento,
-- acrescentando o fallback do plano do trial.
-- PRÉ-REQUISITOS: 024, 035, 036, 044 e 045 (opcional; não usado aqui).
-- NÃO EXECUTAR antes do rollback-test verde e da revisão da SecOps.

DO $pre$
BEGIN
  IF to_regclass('public.module_catalog') IS NULL
     OR to_regclass('public.plans') IS NULL
     OR to_regclass('public.plan_modules') IS NULL
     OR to_regprocedure('public.apply_store_modules(uuid)') IS NULL
     OR to_regprocedure('public.store_module_enabled(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: aplique 024, 035, 036 e 044 antes do 046.';
  END IF;
END
$pre$;

-- (1) Core: Dashboard e Vendas/PDV
UPDATE public.module_catalog SET core = true WHERE key IN ('dashboard', 'sales');

-- (2) Plano 'trial' (linha em plans, FK de plan_modules) com os módulos do Avançado.
INSERT INTO public.plans (key, name, price_cents, annual_price_cents, max_sellers, active)
VALUES ('trial', 'Trial (Avançado)', 0, 0, NULL, true)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.plan_modules (plan_key, module_key, enabled)
SELECT 'trial', pm.module_key, pm.enabled FROM public.plan_modules pm WHERE pm.plan_key = 'avancado'
ON CONFLICT (plan_key, module_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- Plano efetivo de uma loja para leitura: assinatura; sem assinatura e em trial, 'avancado' (decisão do Tech Lead).
CREATE OR REPLACE FUNCTION public._store_plan_for_modules(p_store uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $f$
  SELECT COALESCE(
    (SELECT sb.plan_id FROM public.subscriptions sb WHERE sb.store_id = p_store),
    CASE WHEN (SELECT public.store_effective_status(st.status, st.trial_ends_at, st.valid_until) FROM public.stores st WHERE st.id = p_store) = 'trial' THEN 'avancado' END
  )
$f$;
REVOKE ALL ON FUNCTION public._store_plan_for_modules(uuid) FROM PUBLIC, anon, authenticated;

-- Cache store_modules (servidor): mesma regra da 036, com o plano efetivo acima.
CREATE OR REPLACE FUNCTION public.apply_store_modules(p_store uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_plan text;
  v_count integer;
BEGIN
  v_plan := public._store_plan_for_modules(p_store);

  INSERT INTO public.store_modules (store_id, module_key, enabled, updated_at)
  SELECT p_store,
         mc.key,
         CASE
           WHEN mc.core THEN true
           WHEN ov.action = 'grant' THEN true
           WHEN ov.action = 'revoke' THEN false
           ELSE COALESCE(pm.enabled, false)
         END,
         now()
    FROM public.module_catalog mc
    LEFT JOIN public.store_module_overrides ov
           ON ov.store_id = p_store AND ov.module_key = mc.key
          AND ov.revoked_at IS NULL
          AND (ov.expires_at IS NULL OR ov.expires_at > now())
    LEFT JOIN public.plan_modules pm
           ON pm.plan_key = v_plan AND pm.module_key = mc.key
   WHERE mc.active
  ON CONFLICT (store_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$f$;
REVOKE ALL ON FUNCTION public.apply_store_modules(uuid) FROM PUBLIC, anon, authenticated;

-- Leitura (front): mesma regra da 036, com o plano efetivo acima.
CREATE OR REPLACE FUNCTION public.store_module_enabled(p_store uuid, p_module text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_core boolean;
  v_action text;
  v_plan text;
  v_plan_enabled boolean;
BEGIN
  IF NOT (public.is_platform_admin() OR p_store = public.current_store_id()) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;
  SELECT mc.core INTO v_core FROM public.module_catalog mc WHERE mc.key = p_module AND mc.active;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_core THEN RETURN true; END IF;

  SELECT ov.action INTO v_action FROM public.store_module_overrides ov
   WHERE ov.store_id = p_store AND ov.module_key = p_module AND ov.revoked_at IS NULL
     AND (ov.expires_at IS NULL OR ov.expires_at > now())
   LIMIT 1;
  IF v_action = 'grant' THEN RETURN true; END IF;
  IF v_action = 'revoke' THEN RETURN false; END IF;

  v_plan := public._store_plan_for_modules(p_store);
  SELECT pm.enabled INTO v_plan_enabled FROM public.plan_modules pm WHERE pm.plan_key = v_plan AND pm.module_key = p_module;
  RETURN COALESCE(v_plan_enabled, false);
END
$f$;
REVOKE ALL ON FUNCTION public.store_module_enabled(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_module_enabled(uuid, text) TO authenticated, service_role;

-- Recalcula o cache das lojas com assinatura (servidor)
DO $r$
DECLARE
  rec record;
BEGIN
  FOR rec IN SELECT sb.store_id FROM public.subscriptions sb LOOP
    PERFORM public.apply_store_modules(rec.store_id);
  END LOOP;
END
$r$;

-- 031-plano-modulos-ativacao-apply.sql (revisão 2, após revisao-secops-031-032.md)
-- REVISÃO 3: admin_set_store_plan REMOVIDO (duplicava a troca da 037 e ignorava D-A1/D-A2). Troca de plano pelo admin: só 037.
-- Migração aditiva. PRÉ-REQUISITO: 024 aplicada (plans, plan_modules, apply_plan_modules_internal, process_billing_event).
-- A checagem abaixo para a migração se a 024 não estiver aplicada.
-- NÃO EXECUTAR em produção antes do teste verde em ROLLBACK, da revisão da SecOps e da autorização do usuário.
--
-- Regra do CEO/CTO: ativação e vencimento passam SOMENTE pelo caminho do webhook (process_billing_event, 024).
-- Esta migração não ativa loja e não altera stores.status nem valid_until.
--
-- 1) Marca/cor é do Avançado (D-7): chave 'brand' em plan_modules. Início e Crescimento com brand = false.
-- 2) choose_trial_plan(p_plan): só o dono, só loja em trial (stores.status = 'trial') e assinatura sem linha ou 'trialing'.
--    Loja paga criada sem linha em subscriptions (ex.: admin_create_client modo 'paid') é recusada.

-- 0) Pré-requisito: 024 aplicada
DO $pre$
BEGIN
  IF to_regclass('public.plan_modules') IS NULL
     OR to_regclass('public.plans') IS NULL
     OR to_regprocedure('public.apply_plan_modules_internal(uuid,text,uuid)') IS NULL
     OR to_regprocedure('public.process_billing_event(text,text,uuid,text,timestamptz,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: aplique a 024 antes da 031.';
  END IF;
END
$pre$;

-- 1) Marcador de plano para a marca
INSERT INTO public.plan_modules (plan_key, module_key, enabled) VALUES
  ('inicio', 'brand', false),
  ('crescimento', 'brand', false),
  ('avancado', 'brand', true)
ON CONFLICT (plan_key, module_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- 2) Escolha do plano de trial pelo DONO (nome usado pelo Front-end, commit 6f2cb45)
CREATE OR REPLACE FUNCTION public.choose_trial_plan(p_plan text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_store uuid := public.current_store_id();
  v_store_status text;
  v_price integer;
  v_status text;
  v_modules integer;
BEGIN
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'Usuário sem loja ativa.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store_members m WHERE m.store_id = v_store AND m.user_id = auth.uid() AND m.role = 'OWNER') THEN
    RAISE EXCEPTION 'Apenas o dono da loja escolhe o plano.' USING ERRCODE = '42501';
  END IF;
  IF p_plan NOT IN ('inicio', 'crescimento', 'avancado') THEN
    RAISE EXCEPTION 'Plano inválido: %. Use inicio, crescimento ou avancado.', p_plan;
  END IF;

  -- Só loja em trial. Loja paga (mesmo sem linha em subscriptions) não passa aqui.
  SELECT st.status INTO v_store_status FROM public.stores st WHERE st.id = v_store;
  IF v_store_status IS DISTINCT FROM 'trial' THEN
    RAISE EXCEPTION 'Troca de plano de loja fora do trial passa pelo administrador ou pelo pagamento.' USING ERRCODE = '42501';
  END IF;

  -- Assinatura: sem linha ou 'trialing'. Qualquer outro status é recusado.
  SELECT sb.status INTO v_status FROM public.subscriptions sb WHERE sb.store_id = v_store;
  IF FOUND AND v_status <> 'trialing' THEN
    RAISE EXCEPTION 'Troca de plano de assinatura paga passa pelo administrador ou pelo pagamento.' USING ERRCODE = '42501';
  END IF;

  SELECT pl.price_cents INTO v_price FROM public.plans pl WHERE pl.key = p_plan;

  INSERT INTO public.subscriptions (store_id, plan_id, status, price_cents, billing_cycle, updated_at)
  VALUES (v_store, p_plan, 'trialing', COALESCE(v_price, 0), 'monthly', now())
  ON CONFLICT (store_id) DO UPDATE
     SET plan_id = EXCLUDED.plan_id, price_cents = EXCLUDED.price_cents, updated_at = now()
     WHERE public.subscriptions.status = 'trialing';

  v_modules := public.apply_plan_modules_internal(v_store, p_plan, auth.uid());

  RETURN jsonb_build_object('plan', p_plan, 'modules_applied', v_modules);
END
$f$;

REVOKE ALL ON FUNCTION public.choose_trial_plan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.choose_trial_plan(text) TO authenticated;

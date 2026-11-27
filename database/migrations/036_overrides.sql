-- 036-overrides-apply.sql
-- Migração aditiva. Overrides de módulo por loja + recálculo do cache store_modules.
-- Base: admin-plano/02-arquitetura.md, seção 2 e seção 1 (efetivo = override > plano; core sempre true).
-- PRÉ-REQUISITO: 035 (module_catalog) e 024 (plan_modules, plans) aplicadas. Checagem abaixo aborta se faltar.
-- Regras: um override ativo por (loja, módulo); não se altera, remove-se (revoked_at) e cria-se outro; sem DELETE.
--   grant exige expires_at entre agora e 90 dias; revoke aceita expires_at NULL. Motivo com 10+ caracteres.
--   core não aceita override. Auditoria na mesma transação.
-- Sem GRANT a clientes: funções só para admin da plataforma (ou service_role).
-- NÃO EXECUTAR em produção antes do teste verde em ROLLBACK, da revisão da SecOps e da autorização do usuário.

-- 0) Pré-requisitos
DO $pre$
BEGIN
  IF to_regclass('public.module_catalog') IS NULL
     OR to_regclass('public.plan_modules') IS NULL
     OR to_regclass('public.plans') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: aplique a 035 e a 024 antes da 036.';
  END IF;
END
$pre$;

-- 1) Tabela de overrides
CREATE TABLE IF NOT EXISTS public.store_module_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  module_key  text NOT NULL REFERENCES public.module_catalog(key),
  action      text NOT NULL CHECK (action IN ('grant', 'revoke')),
  reason      text NOT NULL CHECK (length(btrim(reason)) >= 10),
  expires_at  timestamptz,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_by  uuid,
  CONSTRAINT store_module_overrides_grant_expiry CHECK (
    action <> 'grant' OR (expires_at IS NOT NULL AND expires_at <= created_at + interval '90 days')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS store_module_overrides_ativo_uk
  ON public.store_module_overrides (store_id, module_key) WHERE revoked_at IS NULL;

ALTER TABLE public.store_module_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_module_overrides_admin_read ON public.store_module_overrides;
CREATE POLICY store_module_overrides_admin_read ON public.store_module_overrides FOR SELECT TO authenticated
  USING (public.is_platform_admin());
-- Sem policy de escrita para clientes.

-- 2) Recálculo do cache store_modules a partir do plano + overrides (servidor)
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
  SELECT sb.plan_id INTO v_plan FROM public.subscriptions sb WHERE sb.store_id = p_store;

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

-- 3) Criar override (admin): revoga o ativo anterior do mesmo módulo e cria outro
CREATE OR REPLACE FUNCTION public.admin_set_module_override(p_store uuid, p_module text, p_action text, p_reason text, p_expires_at timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_core boolean;
  v_id uuid;
  v_prev uuid;
BEGIN
  PERFORM public._require_platform_admin();

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store) THEN
    RAISE EXCEPTION 'Loja não encontrada.';
  END IF;
  SELECT mc.core INTO v_core FROM public.module_catalog mc WHERE mc.key = p_module AND mc.active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Módulo inexistente ou inativo: %.', p_module; END IF;
  IF v_core THEN RAISE EXCEPTION 'Módulo core não aceita override.'; END IF;
  IF p_action NOT IN ('grant', 'revoke') THEN RAISE EXCEPTION 'Ação inválida: use grant ou revoke.'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'Informe o motivo (mínimo 10 caracteres).'; END IF;
  IF p_action = 'grant' THEN
    IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '90 days' THEN
      RAISE EXCEPTION 'Liberação (grant) exige validade entre agora e 90 dias.';
    END IF;
  END IF;

  -- Revoga o override ativo anterior (histórico preservado)
  SELECT ov.id INTO v_prev FROM public.store_module_overrides ov
   WHERE ov.store_id = p_store AND ov.module_key = p_module AND ov.revoked_at IS NULL;
  IF FOUND THEN
    UPDATE public.store_module_overrides SET revoked_at = now(), revoked_by = auth.uid() WHERE id = v_prev;
  END IF;

  INSERT INTO public.store_module_overrides (store_id, module_key, action, reason, expires_at, created_by)
  VALUES (p_store, p_module, p_action, btrim(p_reason), p_expires_at, auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.apply_store_modules(p_store);

  PERFORM public.admin_log_audit(p_store, 'module_override_set',
    jsonb_build_object('module', p_module, 'action', p_action, 'expires_at', p_expires_at,
                       'reason', btrim(p_reason), 'replaced', v_prev));
  RETURN v_id;
END
$f$;

REVOKE ALL ON FUNCTION public.admin_set_module_override(uuid, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_module_override(uuid, text, text, text, timestamptz) TO authenticated, service_role;

-- 4) Remover override (admin): marca revoked_at, recalcula, audita
CREATE OR REPLACE FUNCTION public.admin_clear_module_override(p_override_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  ov public.store_module_overrides%ROWTYPE;
BEGIN
  PERFORM public._require_platform_admin();
  IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'Informe o motivo (mínimo 10 caracteres).'; END IF;
  SELECT * INTO ov FROM public.store_module_overrides WHERE id = p_override_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Override não encontrado.'; END IF;
  IF ov.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Override já removido.'; END IF;

  UPDATE public.store_module_overrides SET revoked_at = now(), revoked_by = auth.uid() WHERE id = p_override_id;
  PERFORM public.apply_store_modules(ov.store_id);

  PERFORM public.admin_log_audit(ov.store_id, 'module_override_cleared',
    jsonb_build_object('module', ov.module_key, 'action', ov.action, 'reason', btrim(p_reason)));
END
$f$;

REVOKE ALL ON FUNCTION public.admin_clear_module_override(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_module_override(uuid, text) TO authenticated, service_role;

-- 5) Expiração de override (revisão 3): o cache store_modules só muda quando recalculado.
--    O job (servidor, service_role) recalcula as lojas com override vencido. apply_store_modules já ignora
--    override vencido (expires_at > now()), então o recálculo corrige o cache. Agendamento: PENDENTE (pg_cron ou Edge Function).
CREATE OR REPLACE FUNCTION public.expire_store_module_overrides()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  rec record;
  v_n integer := 0;
BEGIN
  IF NOT (auth.role() = 'service_role' OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Apenas o servidor executa a expiração de overrides.' USING ERRCODE = '42501';
  END IF;
  FOR rec IN
    SELECT DISTINCT ov.store_id
      FROM public.store_module_overrides ov
     WHERE ov.revoked_at IS NULL AND ov.expires_at IS NOT NULL AND ov.expires_at <= now()
  LOOP
    PERFORM public.apply_store_modules(rec.store_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$f$;

REVOKE ALL ON FUNCTION public.expire_store_module_overrides() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_store_module_overrides() TO service_role;

-- 6) Leitura com validade (correção do caso 7, rev5): o override vencido NÃO conta na leitura, mesmo com cache stale.
--    Efetivo calculado a partir de módulo core, override vigente (grant/revoke) e plano; não lê store_modules.
--    Acesso: admin da plataforma ou a própria loja (current_store_id). Só leitura.
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

  SELECT sb.plan_id INTO v_plan FROM public.subscriptions sb WHERE sb.store_id = p_store;
  SELECT pm.enabled INTO v_plan_enabled FROM public.plan_modules pm WHERE pm.plan_key = v_plan AND pm.module_key = p_module;
  RETURN COALESCE(v_plan_enabled, false);
END
$f$;
REVOKE ALL ON FUNCTION public.store_module_enabled(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_module_enabled(uuid, text) TO authenticated, service_role;

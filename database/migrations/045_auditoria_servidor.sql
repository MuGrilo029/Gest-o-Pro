-- 045-auditoria-servidor-apply.sql
-- Migração aditiva (depois da 037 já aplicada). Motivo: o job de downgrade (040) roda como postgres, sem admin nas
-- claims. A auditoria 'plan_applied' feita por admin_log_audit exige administrador da plataforma e falha no job.
-- Correção:
--   1) cria _audit_server: grava em admin_audit_logs só para admin da plataforma ou sessão de servidor
--      (service_role ou session_user = 'postgres'). Usuário comum continua sem poder registrar auditoria;
--      admin_log_audit fica INALTERADO.
--   2) _apply_plan_now_internal passa a usar _audit_server (mesma transação, mesma regra de negócio).
-- PRÉ-REQUISITO: 037 aplicada.
-- NÃO EXECUTAR antes do rollback-test verde e da revisão da SecOps.

DO $pre$
BEGIN
  IF to_regprocedure('public._apply_plan_now_internal(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: _apply_plan_now_internal (037).';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public._audit_server(p_store uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
BEGIN
  IF NOT (public.is_platform_admin() OR auth.role() = 'service_role' OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Apenas administrador ou servidor registra auditoria.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.admin_audit_logs (admin_id, store_id, action, details)
  VALUES (auth.uid(), p_store, p_action, COALESCE(p_details, '{}'::jsonb));
END
$f$;
REVOKE ALL ON FUNCTION public._audit_server(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._apply_plan_now_internal(p_store uuid, p_plan text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_modules integer;
BEGIN
  IF public._plan_rank(p_plan) IS NULL THEN RAISE EXCEPTION 'Plano inválido: %.', p_plan; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE store_id = p_store) THEN
    RAISE EXCEPTION 'Loja sem assinatura: a troca de plano depende da assinatura.';
  END IF;
  UPDATE public.subscriptions
     SET plan_id = p_plan, pending_plan = NULL, pending_plan_at = NULL, pending_kind = NULL, pending_amount_cents = NULL, updated_at = now()
   WHERE store_id = p_store;
  v_modules := public.apply_store_modules(p_store);
  PERFORM public._audit_server(p_store, 'plan_applied', jsonb_build_object('plan', p_plan, 'modules_recalculated', v_modules));
  RETURN v_modules;
END
$f$;
REVOKE ALL ON FUNCTION public._apply_plan_now_internal(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

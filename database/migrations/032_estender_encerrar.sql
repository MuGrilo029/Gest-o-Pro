-- 032-estender-encerrar-apply.sql (revisão 4: condições da SecOps, rev3)
-- Migração aditiva. Estender e encerrar loja. Sem DELETE. Auditoria na mesma transação.
-- NÃO EXECUTAR em produção antes do teste verde em ROLLBACK, da revisão da SecOps e da autorização do usuário.
--
-- Fonte do vencimento:
--   - trial: stores.trial_ends_at.
--   - loja com assinatura: subscriptions.current_period_end é a fonte; stores.valid_until é espelho (mesmo valor).
--   - loja sem assinatura fora do trial: stores.valid_until (legado).
--
-- ENCERRAR (condição CRÍTICA da SecOps):
--   - Loja SEM assinatura (trial/sem gateway): vai a 'expired' na hora. Nada a cancelar no Asaas.
--   - Loja COM assinatura: NÃO muda o status aqui. Grava um pedido 'pending' em billing_gateway_requests.
--     O status só vai a 'expired' quando o servidor confirma o cancelamento no Asaas (apply_gateway_cancel_done).
--     Falha no cancelamento: pedido 'failed' + auditoria 'gateway_cancel_failed' (alerta para o admin).
--   - Enquanto billing_config.billing_cancel_enabled = 'false' (Edge Function billing-cancel não publicada e testada),
--     encerrar loja COM assinatura é RECUSADO. A loja continua ativa e cobrando como antes.
--   - Webhook: billing_store_closed(p_store) devolve true para loja encerrada; o billing-webhook não deve
--     reativar loja encerrada por evento 'confirmed' (regra a aplicar no webhook antes do go-live).
--
-- PRÉ-REQUISITO: 024 (subscriptions com gateway_subscription_id, billing_events). O bloco $pre$ aborta se faltar.

DO $pre$
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: tabela subscriptions (009/024).';
  END IF;
END
$pre$;

-- Chave de controle: cancelamento no gateway habilitado? Começa DESLIGADO.
CREATE TABLE IF NOT EXISTS public.billing_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_config_admin_read ON public.billing_config;
CREATE POLICY billing_config_admin_read ON public.billing_config FOR SELECT TO authenticated USING (public.is_platform_admin());
INSERT INTO public.billing_config (key, value) VALUES ('billing_cancel_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- Fila de pedidos ao gateway. Só admin lê; escrita só pelas funções.
CREATE TABLE IF NOT EXISTS public.billing_gateway_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                 uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  kind                     text NOT NULL CHECK (kind IN ('cancel_subscription')),
  gateway_subscription_id  text,
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  attempts                 integer NOT NULL DEFAULT 0,
  last_error               text,
  requested_by             uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  processed_at             timestamptz
);
ALTER TABLE public.billing_gateway_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_gateway_requests_admin_read ON public.billing_gateway_requests;
CREATE POLICY billing_gateway_requests_admin_read ON public.billing_gateway_requests FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- (a) Estender
CREATE OR REPLACE FUNCTION public.admin_extend_store(p_store uuid, p_hours integer DEFAULT NULL, p_days integer DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  s public.stores%ROWTYPE;
  v_sub_end timestamptz;
  v_has_sub boolean;
  v_add interval;
  v_new timestamptz;
BEGIN
  PERFORM public._require_platform_admin();
  IF COALESCE(p_hours, 0) <= 0 AND COALESCE(p_days, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe horas ou dias maiores que zero.';
  END IF;
  SELECT * INTO s FROM public.stores WHERE id = p_store;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
  v_add := make_interval(days => COALESCE(p_days, 0), hours => COALESCE(p_hours, 0));
  SELECT sb.current_period_end INTO v_sub_end FROM public.subscriptions sb WHERE sb.store_id = p_store;
  v_has_sub := FOUND;
  IF s.status = 'trial' THEN
    v_new := GREATEST(COALESCE(s.trial_ends_at, now()), now()) + v_add;
    UPDATE public.stores SET trial_ends_at = v_new WHERE id = p_store;
  ELSIF v_has_sub THEN
    v_new := GREATEST(COALESCE(v_sub_end, now()), now()) + v_add;
    UPDATE public.subscriptions SET current_period_end = v_new, updated_at = now() WHERE store_id = p_store;
    UPDATE public.stores SET valid_until = v_new WHERE id = p_store;
  ELSE
    v_new := GREATEST(COALESCE(s.valid_until, now()), now()) + v_add;
    UPDATE public.stores SET valid_until = v_new WHERE id = p_store;
  END IF;
  PERFORM public.admin_log_audit(p_store, 'extend_store',
    jsonb_build_object('hours', p_hours, 'days', p_days, 'new_end', v_new, 'status_before', s.status));
  RETURN v_new;
END
$f$;
REVOKE ALL ON FUNCTION public.admin_extend_store(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_extend_store(uuid, integer, integer) TO authenticated, service_role;

-- (b) Encerrar (admin). Loja com assinatura: só pede o cancelamento; o status muda depois, pelo servidor.
DROP FUNCTION IF EXISTS public.admin_close_store(uuid, text);
CREATE FUNCTION public.admin_close_store(p_store uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  s public.stores%ROWTYPE;
  v_gw text;
  v_has_sub boolean;
  v_req uuid;
  v_enabled text;
BEGIN
  PERFORM public._require_platform_admin();
  SELECT * INTO s FROM public.stores WHERE id = p_store;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;

  SELECT sb.gateway_subscription_id INTO v_gw FROM public.subscriptions sb WHERE sb.store_id = p_store;
  v_has_sub := FOUND;
  IF v_has_sub AND v_gw IS NULL THEN
    RAISE EXCEPTION 'Loja com assinatura sem gateway_subscription_id: não há o que cancelar no Asaas. Corrija o vínculo antes de encerrar.';
  END IF;

  IF NOT v_has_sub THEN
    -- Sem assinatura no gateway: encerra direto
    UPDATE public.stores SET status = 'expired' WHERE id = p_store;
    PERFORM public.admin_log_audit(p_store, 'close_store',
      jsonb_build_object('status_before', s.status, 'note', p_note, 'gateway_cancel', 'sem_assinatura'));
    RETURN jsonb_build_object('status', 'expired', 'gateway_request', NULL);
  END IF;

  -- Loja com assinatura: só com o cancelamento no Asaas habilitado
  SELECT bc.value INTO v_enabled FROM public.billing_config bc WHERE bc.key = 'billing_cancel_enabled';
  IF COALESCE(v_enabled, 'false') <> 'true' THEN
    RAISE EXCEPTION 'Encerramento de loja com assinatura indisponível: o cancelamento no Asaas (billing-cancel) ainda não está ativo. A loja continua ativa.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.billing_gateway_requests (store_id, kind, gateway_subscription_id, requested_by)
  VALUES (p_store, 'cancel_subscription', v_gw, auth.uid())
  RETURNING id INTO v_req;

  PERFORM public.admin_log_audit(p_store, 'close_store_requested',
    jsonb_build_object('status_before', s.status, 'note', p_note, 'gateway_request', v_req, 'gateway_subscription_id', v_gw));
  RETURN jsonb_build_object('status', 'pendente_gateway', 'gateway_request', v_req);
END
$f$;
REVOKE ALL ON FUNCTION public.admin_close_store(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_store(uuid, text) TO authenticated, service_role;

-- (c) Confirmação do cancelamento pelo servidor (billing-cancel). Só service_role.
CREATE OR REPLACE FUNCTION public.apply_gateway_cancel_done(p_request uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  g public.billing_gateway_requests%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Apenas o servidor confirma cancelamento.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO g FROM public.billing_gateway_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF g.status = 'done' THEN RETURN; END IF;  -- idempotente
  UPDATE public.billing_gateway_requests SET status = 'done', processed_at = now(), attempts = attempts + 1 WHERE id = p_request;
  UPDATE public.subscriptions SET status = 'cancelled', cancel_at_period_end = true, updated_at = now() WHERE store_id = g.store_id;
  UPDATE public.stores SET status = 'expired' WHERE id = g.store_id;
  PERFORM public.admin_log_audit(g.store_id, 'close_store',
    jsonb_build_object('gateway_request', p_request, 'gateway_cancel', 'confirmado'));
END
$f$;
REVOKE ALL ON FUNCTION public.apply_gateway_cancel_done(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_gateway_cancel_done(uuid) TO service_role;

-- (d) Falha no cancelamento: fica 'failed' e gera alerta na auditoria (a loja continua ativa e cobrando).
CREATE OR REPLACE FUNCTION public.apply_gateway_cancel_failed(p_request uuid, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  g public.billing_gateway_requests%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Apenas o servidor registra falha de cancelamento.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO g FROM public.billing_gateway_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  UPDATE public.billing_gateway_requests
     SET status = 'failed', attempts = attempts + 1, last_error = left(COALESCE(p_error, ''), 200)
   WHERE id = p_request;
  PERFORM public.admin_log_audit(g.store_id, 'gateway_cancel_failed',
    jsonb_build_object('gateway_request', p_request, 'alerta', 'cancelamento no Asaas falhou; loja continua ativa'));
END
$f$;
REVOKE ALL ON FUNCTION public.apply_gateway_cancel_failed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_gateway_cancel_failed(uuid, text) TO service_role;

-- (e) Guarda para o webhook: loja encerrada não é reativada por evento 'confirmed'. Só service_role.
CREATE OR REPLACE FUNCTION public.billing_store_closed(p_store uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $f$
  SELECT EXISTS (SELECT 1 FROM public.stores st WHERE st.id = p_store AND st.status = 'expired')
      OR EXISTS (SELECT 1 FROM public.billing_gateway_requests g
                  WHERE g.store_id = p_store AND g.kind = 'cancel_subscription' AND g.status = 'done')
$f$;
REVOKE ALL ON FUNCTION public.billing_store_closed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_store_closed(uuid) TO service_role;

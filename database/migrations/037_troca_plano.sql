-- 037-troca-plano-apply.sql (revisão 4: condições da SecOps rev3)
-- Migração aditiva. Troca de plano pelo Admin.
-- Base: admin-plano/02-arquitetura.md, seção 3; revisao-secops-031-038-rev3.md.
-- PRÉ-REQUISITO: 036 (apply_store_modules) e 024 (plans com max_sellers). O bloco $pre$ aborta se faltar.
--
-- Regras:
--   - UPGRADE: cobra a diferença agora (Asaas). NÃO aplica plano nem módulos aqui: fica pendente
--     (pending_kind='upgrade', pending_amount_cents = diferença de preço). Quem aplica é apply_upgrade_on_payment,
--     chamado pelo webhook com: id do evento, plano e valor pago. Valida plano e valor e é IDEMPOTENTE
--     (upgrade_payment_events: mesmo evento não aplica duas vezes).
--   - DOWNGRADE: bloqueado se vendedores > limite do destino (D-A1). Senão agendado (pending_kind='downgrade').
--     apply_pending_plan_changes aplica só downgrade vencido.
--   - Nada aqui ativa loja, muda stores.status ou valid_until. Loja encerrada não sobe de plano (checada).
--   - Guardas: _apply_plan_now_internal sem guarda e sem GRANT. Públicas: service_role ou admin. Sem GRANT a authenticated,
--     exceto admin_request_plan_change (checa _require_platform_admin antes de qualquer alteração).
--   - Auditoria na mesma transação.
--   - VALOR DO UPGRADE (decisão rev4): a fonte é o valor real cobrado pelo Asaas, gravado por set_upgrade_charge_amount (service_role)
--     Pendência: billing-checkout precisa chamar set_upgrade_charge_amount antes do go-live.
-- NÃO EXECUTAR em produção antes do teste verde em ROLLBACK, da revisão da SecOps e da autorização do usuário.

DO $pre$
BEGIN
  IF to_regclass('public.plans') IS NULL
     OR to_regprocedure('public.apply_store_modules(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: aplique a 024 e a 036 antes da 037.';
  END IF;
END
$pre$;

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS pending_plan text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS pending_plan_at timestamptz;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS pending_kind text CHECK (pending_kind IN ('upgrade', 'downgrade'));
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS pending_amount_cents integer;

-- Registro de upgrades aplicados (idempotência por id do evento do gateway)
CREATE TABLE IF NOT EXISTS public.upgrade_payment_events (
  event_id     text PRIMARY KEY,
  store_id     uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  plan_id      text NOT NULL,
  amount_cents integer NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.upgrade_payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS upgrade_payment_events_admin_read ON public.upgrade_payment_events;
CREATE POLICY upgrade_payment_events_admin_read ON public.upgrade_payment_events FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public._plan_rank(p_plan text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $f$
  SELECT CASE p_plan WHEN 'inicio' THEN 1 WHEN 'crescimento' THEN 2 WHEN 'avancado' THEN 3 ELSE NULL END
$f$;

-- Caminho do webhook para upgrade pago. Valida plano e valor; idempotente pelo id do evento.
-- Interna: troca o plano e recalcula módulos. Sem guarda; sem GRANT para ninguém.
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
  PERFORM public.admin_log_audit(p_store, 'plan_applied', jsonb_build_object('plan', p_plan, 'modules_recalculated', v_modules));
  RETURN v_modules;
END
$f$;
REVOKE ALL ON FUNCTION public._apply_plan_now_internal(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_upgrade_on_payment(p_store uuid, p_plan text, p_event_id text, p_amount_cents integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  sb record;
  v_inserted text;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Apenas o servidor (webhook) ou o administrador aplica upgrade.' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR length(btrim(p_event_id)) = 0 THEN RAISE EXCEPTION 'Evento sem id.'; END IF;

  -- Idempotência: evento já aplicado não aplica de novo
  IF EXISTS (SELECT 1 FROM public.upgrade_payment_events e WHERE e.event_id = p_event_id) THEN
    RETURN 0;
  END IF;

  SELECT st.status INTO v_inserted FROM public.stores st WHERE st.id = p_store;
  IF v_inserted IS NULL THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
  IF v_inserted = 'expired' THEN
    RAISE EXCEPTION 'Loja encerrada: o upgrade não é aplicado.';
  END IF;

  SELECT sb2.pending_plan, sb2.pending_kind, sb2.pending_amount_cents INTO sb
    FROM public.subscriptions sb2 WHERE sb2.store_id = p_store;
  IF NOT FOUND OR sb.pending_kind IS DISTINCT FROM 'upgrade' THEN
    RETURN 0;  -- não há upgrade pendente
  END IF;
  IF sb.pending_plan IS DISTINCT FROM p_plan THEN
    RAISE EXCEPTION 'Plano do pagamento (%) diverge do upgrade pendente (%).', p_plan, sb.pending_plan;
  END IF;
  IF sb.pending_amount_cents IS NULL THEN
    RAISE EXCEPTION 'Upgrade sem valor confirmado pelo gateway: a cobrança do Asaas ainda não foi registrada.';
  END IF;
  IF p_amount_cents IS DISTINCT FROM sb.pending_amount_cents THEN
    RAISE EXCEPTION 'Valor pago (%) diverge do valor do upgrade pendente (%).', p_amount_cents, sb.pending_amount_cents;
  END IF;

  INSERT INTO public.upgrade_payment_events (event_id, store_id, plan_id, amount_cents)
  VALUES (p_event_id, p_store, p_plan, p_amount_cents);

  RETURN public._apply_plan_now_internal(p_store, p_plan);
END
$f$;
REVOKE ALL ON FUNCTION public.apply_upgrade_on_payment(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_upgrade_on_payment(uuid, text, text, integer) TO service_role;

-- Valor do upgrade: a fonte é o valor REAL cobrado pelo Asaas (proration), não a diferença de tabela.
-- Decisão (rev4): sem valor confirmado pelo gateway, o upgrade NÃO é aplicado (falha fechada). Sem tolerância.
-- O servidor grava o valor ao criar a cobrança no Asaas (billing-checkout). Só service_role.
CREATE OR REPLACE FUNCTION public.set_upgrade_charge_amount(p_store uuid, p_plan text, p_amount_cents integer, p_gateway_charge_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Apenas o servidor grava o valor da cobrança do upgrade.' USING ERRCODE = '42501';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 0 THEN RAISE EXCEPTION 'Valor da cobrança inválido.'; END IF;
  UPDATE public.subscriptions
     SET pending_amount_cents = p_amount_cents, updated_at = now()
   WHERE store_id = p_store AND pending_kind = 'upgrade' AND pending_plan = p_plan;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não há upgrade pendente para este plano.'; END IF;
  PERFORM public.admin_log_audit(p_store, 'upgrade_charge_confirmed',
    jsonb_build_object('plan', p_plan, 'amount_cents', p_amount_cents, 'gateway_charge_id', p_gateway_charge_id));
END
$f$;
REVOKE ALL ON FUNCTION public.set_upgrade_charge_amount(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_upgrade_charge_amount(uuid, text, integer, text) TO service_role;

-- Pedido de troca pelo Admin (único caminho de cliente).
CREATE OR REPLACE FUNCTION public.admin_request_plan_change(p_store uuid, p_plan text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_cur text;
  v_cur_end timestamptz;
  v_cur_price integer;
  v_new_price integer;
  v_status text;
  v_limit integer;
  v_sellers integer;
BEGIN
  PERFORM public._require_platform_admin();
  IF public._plan_rank(p_plan) IS NULL THEN RAISE EXCEPTION 'Plano inválido: %.', p_plan; END IF;
  SELECT sb.plan_id, sb.current_period_end, sb.price_cents INTO v_cur, v_cur_end, v_cur_price
    FROM public.subscriptions sb WHERE sb.store_id = p_store;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja sem assinatura: a troca de plano depende da assinatura.'; END IF;
  SELECT st.status INTO v_status FROM public.stores st WHERE st.id = p_store;
  IF v_status = 'expired' THEN RAISE EXCEPTION 'Loja encerrada: não há troca de plano.'; END IF;
  IF v_cur = p_plan THEN RAISE EXCEPTION 'A loja já está no plano %.', p_plan; END IF;

  IF public._plan_rank(p_plan) > public._plan_rank(v_cur) THEN
    -- Upgrade: pendente até o pagamento da diferença ser confirmado pelo webhook
    SELECT pl.price_cents INTO v_new_price FROM public.plans pl WHERE pl.key = p_plan;
    UPDATE public.subscriptions
       SET pending_plan = p_plan, pending_plan_at = now(), pending_kind = 'upgrade',
           pending_amount_cents = NULL, updated_at = now()
     WHERE store_id = p_store;
    PERFORM public.admin_log_audit(p_store, 'plan_change_requested',
      jsonb_build_object('from', v_cur, 'to', p_plan, 'kind', 'upgrade', 'status', 'aguardando_pagamento_proration'));
    RETURN jsonb_build_object('kind', 'upgrade', 'status', 'aguardando_pagamento', 'plan', p_plan);
  END IF;

  -- Downgrade: bloqueado se houver mais vendedores que o limite do destino (null = ilimitado)
  SELECT pl.max_sellers INTO v_limit FROM public.plans pl WHERE pl.key = p_plan;
  SELECT count(*)::integer INTO v_sellers FROM public.store_members m WHERE m.store_id = p_store AND m.role = 'SELLER';
  IF v_limit IS NOT NULL AND v_sellers > v_limit THEN
    RAISE EXCEPTION 'Downgrade bloqueado: a loja tem % vendedores e o plano % aceita %. Remova vendedores antes.', v_sellers, p_plan, v_limit
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.subscriptions
     SET pending_plan = p_plan, pending_plan_at = COALESCE(v_cur_end, now()), pending_kind = 'downgrade', pending_amount_cents = NULL, updated_at = now()
   WHERE store_id = p_store;
  PERFORM public.admin_log_audit(p_store, 'plan_change_requested',
    jsonb_build_object('from', v_cur, 'to', p_plan, 'kind', 'downgrade', 'effective', COALESCE(v_cur_end, now())));
  RETURN jsonb_build_object('kind', 'downgrade', 'status', 'agendado', 'effective', COALESCE(v_cur_end, now()), 'plan', p_plan);
END
$f$;
REVOKE ALL ON FUNCTION public.admin_request_plan_change(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_request_plan_change(uuid, text) TO authenticated, service_role;

-- Aplica downgrades vencidos (só downgrade). Só servidor/admin. Agendamento em 040.
CREATE OR REPLACE FUNCTION public.apply_pending_plan_changes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  rec record;
  v_n integer := 0;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_platform_admin() OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Apenas o servidor ou o administrador aplica trocas agendadas.' USING ERRCODE = '42501';
  END IF;
  FOR rec IN
    SELECT sb.store_id, sb.pending_plan FROM public.subscriptions sb
     WHERE sb.pending_kind = 'downgrade' AND sb.pending_plan_at <= now()
  LOOP
    PERFORM public._apply_plan_now_internal(rec.store_id, rec.pending_plan);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$f$;
REVOKE ALL ON FUNCTION public.apply_pending_plan_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pending_plan_changes() TO service_role;

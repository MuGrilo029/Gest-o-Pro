-- 038-pagamento-manual-contrato-apply.sql (revisão 3: decisões do usuário 26/11)
-- Migração aditiva. admin_register_payment SÓ para contrato fora do Asaas (billing_mode = 'manual_contract').
-- Lojas de gateway: recusadas (o pagamento delas entra só pelo webhook do Asaas).
-- Regra do CEO/CTO: admin_register_payment NÃO ativa a loja direto. Por isso esta versão só REGISTRA o pagamento
-- e recalcula o cache de módulos. Não altera stores.status, stores.valid_until nem subscriptions.status/período.
-- Ativação e vencimento de contrato manual: DECISÃO PENDENTE (CEO/CTO). Sem decisão, a loja segue como está.
-- Plano: nunca cai em 'inicio' em silêncio. Se a loja não tem plano em subscriptions, a função recusa.
-- Substitui o corpo da 033 (superseded). Não apaga nada.
-- PRÉ-REQUISITOS: 035 (billing_mode) e 036 (apply_store_modules).
-- NÃO EXECUTAR em produção antes do teste verde em ROLLBACK, da revisão da SecOps e da autorização do usuário.

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'billing_mode') THEN
    RAISE EXCEPTION 'Pré-requisito ausente: stores.billing_mode (035).';
  END IF;
  IF to_regprocedure('public.apply_store_modules(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: apply_store_modules (036).';
  END IF;
END
$pre$;

ALTER TABLE public.subscription_payments ADD COLUMN IF NOT EXISTS source text;

CREATE OR REPLACE FUNCTION public.admin_register_payment(p_store uuid, p_amount numeric, p_method text, p_days integer, p_note text DEFAULT NULL::text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  s public.stores%ROWTYPE;
  v_end timestamptz;
BEGIN
  PERFORM public._require_platform_admin();
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero.'; END IF;
  IF COALESCE(p_days, 0) <= 0 THEN RAISE EXCEPTION 'Informe o período em dias.'; END IF;

  SELECT * INTO s FROM public.stores WHERE id = p_store;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;

  -- Só contrato fora do Asaas. Loja de gateway não tem caminho por aqui.
  IF s.billing_mode IS DISTINCT FROM 'manual_contract' THEN
    RAISE EXCEPTION 'Loja de gateway: o pagamento entra pelo webhook do Asaas. Pagamento manual só para contrato fora do gateway.'
      USING ERRCODE = '42501';
  END IF;

  -- Plano precisa existir na assinatura (sem fallback silencioso)
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions sb WHERE sb.store_id = p_store AND sb.plan_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Loja sem assinatura/plano: defina o plano antes de registrar o pagamento.';
  END IF;

  -- Período que seria contratado (apenas registrado; não é aplicado nesta versão)
  v_end := GREATEST(COALESCE(s.valid_until, now()), now()) + make_interval(days => p_days);

  INSERT INTO public.subscription_payments (store_id, amount, method, period_days, note, created_by, source)
  VALUES (p_store, p_amount, COALESCE(NULLIF(btrim(COALESCE(p_method, '')), ''), 'manual'), p_days, p_note, auth.uid(), 'manual');

  -- Recalcula o cache de módulos (plano + overrides vigentes); não muda status nem validade
  PERFORM public.apply_store_modules(p_store);

  PERFORM public.admin_log_audit(p_store, 'payment_recorded_manual',
    jsonb_build_object('amount', p_amount, 'days', p_days, 'method', p_method, 'note', p_note,
                       'billing_mode', 'manual_contract', 'period_end_calc', v_end, 'activated', false));
  RETURN v_end;
END
$f$;

REVOKE ALL ON FUNCTION public.admin_register_payment(uuid, numeric, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_register_payment(uuid, numeric, text, integer, text) TO authenticated, service_role;

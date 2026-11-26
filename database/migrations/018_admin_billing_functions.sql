-- 018: base de cobrança e funções do Painel Admin (dono do SaaS)
-- ATENÇÃO: migração PREPARADA, NÃO aplicada. Aguarda aprovação.
-- Aditiva: colunas, tabelas e funções novas. Não altera dados existentes.
-- Não usa as tabelas da 009 (invoices, subscriptions): elas não existem no banco.
-- Base do MRR: stores.monthly_value (valor mensal combinado da loja) + subscription_payments (razão de pagamentos).
-- Todas as funções: SECURITY DEFINER, search_path = '', checagem via public._require_platform_admin()
-- (que confere is_platform_admin), EXECUTE só para authenticated.

-- 1) Valor mensal combinado por loja (sem inventar preço: NULL até o dono definir)
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS monthly_value numeric(12,2);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_monthly_value_check' AND conrelid = 'public.stores'::regclass) THEN
    ALTER TABLE public.stores ADD CONSTRAINT stores_monthly_value_check CHECK (monthly_value IS NULL OR monthly_value >= 0);
  END IF;
END $$;

-- 2) Razão de pagamentos manuais. RESTRICT: a loja não pode ser apagada com pagamento registrado.
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'manual',
  period_days integer NOT NULL CHECK (period_days > 0),
  note text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS subscription_payments_store_idx ON public.subscription_payments (store_id, paid_at);
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_payments FROM PUBLIC, anon, authenticated;

-- 3) Log de auditoria: usa public.admin_audit_logs e public.admin_log_audit (migração 009) e a
--    retenção de 5 anos (migração 021). Nesta migração não há tabela de log nova.
--    Toda ação de escrita abaixo chama public.admin_log_audit na mesma transação.

-- 4) Listar lojas com plano, status, vencimento e valor
CREATE OR REPLACE FUNCTION public.admin_list_billing()
RETURNS TABLE (store_id uuid, name text, plan text, status text, effective_status text,
               valid_until timestamptz, trial_ends_at timestamptz, monthly_value numeric,
               owner_email text, last_payment_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $f$
BEGIN
  PERFORM public._require_platform_admin();
  RETURN QUERY
    SELECT s.id, s.name, s.plan, s.status,
           public.store_effective_status(s.status, s.trial_ends_at, s.valid_until),
           s.valid_until, s.trial_ends_at, s.monthly_value,
           (SELECT u.email::text FROM public.store_members m JOIN auth.users u ON u.id = m.user_id
             WHERE m.store_id = s.id AND m.role = 'OWNER' ORDER BY m.created_at LIMIT 1),
           (SELECT max(p.paid_at) FROM public.subscription_payments p WHERE p.store_id = s.id)
    FROM public.stores s
    WHERE s.is_active
    ORDER BY s.created_at DESC;
END $f$;

-- 5) Testes de 1 hora com tempo restante
CREATE OR REPLACE FUNCTION public.admin_list_trials()
RETURNS TABLE (store_id uuid, name text, owner_email text, trial_ends_at timestamptz, seconds_remaining bigint, is_trial boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $f$
BEGIN
  PERFORM public._require_platform_admin();
  RETURN QUERY
    SELECT s.id, s.name,
           (SELECT u.email::text FROM public.store_members m JOIN auth.users u ON u.id = m.user_id
             WHERE m.store_id = s.id AND m.role = 'OWNER' ORDER BY m.created_at LIMIT 1),
           s.trial_ends_at,
           GREATEST(0, EXTRACT(EPOCH FROM (s.trial_ends_at - now()))::bigint),
           s.is_trial
    FROM public.stores s
    WHERE s.is_active AND s.status = 'trial'
    ORDER BY s.trial_ends_at;
END $f$;

-- 6) Mudar plano e valor mensal
CREATE OR REPLACE FUNCTION public.admin_set_plan(p_store uuid, p_plan text, p_monthly_value numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $f$
BEGIN
  PERFORM public._require_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store) THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
  IF p_monthly_value IS NOT NULL AND p_monthly_value < 0 THEN RAISE EXCEPTION 'Valor mensal inválido.'; END IF;
  UPDATE public.stores SET plan = NULLIF(trim(COALESCE(p_plan, '')), ''), monthly_value = p_monthly_value WHERE id = p_store;
  PERFORM public.admin_log_audit(p_store, 'set_plan', jsonb_build_object('plan', p_plan, 'monthly_value', p_monthly_value));
END $f$;

-- 7) Converter teste em plano pago (período em dias, a partir de agora)
CREATE OR REPLACE FUNCTION public.admin_convert_trial(p_store uuid, p_plan text, p_monthly_value numeric, p_days integer)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $f$
DECLARE
  v_end timestamptz;
  v_status text;
BEGIN
  PERFORM public._require_platform_admin();
  IF COALESCE(p_days, 0) <= 0 THEN RAISE EXCEPTION 'Informe o período em dias.'; END IF;
  SELECT status INTO v_status FROM public.stores WHERE id = p_store;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
  IF v_status <> 'trial' THEN RAISE EXCEPTION 'A loja não está em teste.'; END IF;
  v_end := now() + make_interval(days => p_days);
  UPDATE public.stores SET status = 'active', plan = COALESCE(NULLIF(trim(COALESCE(p_plan, '')), ''), 'pago'),
    monthly_value = COALESCE(p_monthly_value, monthly_value), valid_until = v_end
  WHERE id = p_store;
  PERFORM public.admin_log_audit(p_store, 'convert_trial', jsonb_build_object('plan', p_plan, 'days', p_days));
  RETURN v_end;
END $f$;

-- 8) Registrar pagamento manual e estender o acesso
CREATE OR REPLACE FUNCTION public.admin_register_payment(p_store uuid, p_amount numeric, p_method text, p_days integer, p_note text DEFAULT NULL)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
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
  v_end := GREATEST(COALESCE(s.valid_until, now()), now()) + make_interval(days => p_days);
  INSERT INTO public.subscription_payments (store_id, amount, method, period_days, note, created_by)
  VALUES (p_store, p_amount, COALESCE(NULLIF(trim(COALESCE(p_method, '')), ''), 'manual'), p_days, p_note, auth.uid());
  UPDATE public.stores SET status = 'active', valid_until = v_end WHERE id = p_store;
  PERFORM public.admin_log_audit(p_store, 'register_payment', jsonb_build_object('amount', p_amount, 'days', p_days, 'method', p_method));
  RETURN v_end;
END $f$;

-- 9) Métricas do painel
CREATE OR REPLACE FUNCTION public.admin_metrics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $f$
BEGIN
  PERFORM public._require_platform_admin();
  RETURN jsonb_build_object(
    'ativas', (SELECT count(*) FROM public.stores s WHERE s.is_active AND s.status = 'active' AND (s.valid_until IS NULL OR s.valid_until >= now())),
    'em_teste', (SELECT count(*) FROM public.stores s WHERE s.is_active AND s.status = 'trial' AND s.trial_ends_at > now()),
    'atrasadas', (SELECT count(*) FROM public.stores s WHERE s.is_active AND s.status = 'active' AND s.valid_until < now()),
    'expiradas_sem_conversao', (SELECT count(*) FROM public.stores s WHERE s.is_active AND s.status = 'trial' AND s.trial_ends_at <= now()),
    'mrr', (SELECT COALESCE(sum(s.monthly_value), 0) FROM public.stores s WHERE s.is_active AND s.status = 'active' AND (s.valid_until IS NULL OR s.valid_until >= now())),
    'ativas_sem_valor', (SELECT count(*) FROM public.stores s WHERE s.is_active AND s.status = 'active' AND s.monthly_value IS NULL)
  );
END $f$;

-- Permissões: só authenticated; a checagem de platform admin fica dentro de cada função
REVOKE ALL ON FUNCTION public.admin_log_audit(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_billing() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_trials() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_plan(uuid, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_convert_trial(uuid, text, numeric, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_register_payment(uuid, numeric, text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_log_audit(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_billing() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_trials() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_plan(uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_convert_trial(uuid, text, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_register_payment(uuid, numeric, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_metrics() TO authenticated;

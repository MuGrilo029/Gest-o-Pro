-- 024-cobranca-apply.sql (Frente B: cobrança) — NÃO aplicar antes da revisão do SecOps
-- Aditiva. Não altera dados de lojas. Preços e limites: planos Início R$ 49 (1 vendedor), Crescimento R$ 99 (3),
-- Avançado R$ 199 (ilimitado); anual = 10 meses. Módulos por plano NÃO são semeados (decisão pendente do usuário):
-- apply_plan_modules recusa plano sem módulos cadastrados, para nunca desligar tudo por engano.

-- 1) Planos (tabela de referência, leitura pública dos preços)
CREATE TABLE IF NOT EXISTS public.plans (
  key                 text PRIMARY KEY,
  name                text NOT NULL,
  price_cents         integer NOT NULL CHECK (price_cents >= 0),
  annual_price_cents  integer NOT NULL CHECK (annual_price_cents >= 0),
  max_sellers         integer NULL CHECK (max_sellers IS NULL OR max_sellers >= 0),
  active              boolean NOT NULL DEFAULT true
);
INSERT INTO public.plans (key, name, price_cents, annual_price_cents, max_sellers, active) VALUES
  ('inicio',      'Início',      4900,  49000,  1, true),
  ('crescimento', 'Crescimento', 9900,  99000,  3, true),
  ('avancado',    'Avançado',   19900, 199000, NULL, true)
ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_public_read ON public.plans;
CREATE POLICY plans_public_read ON public.plans FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS plans_admin_write ON public.plans;
CREATE POLICY plans_admin_write ON public.plans FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- 2) Módulos por plano (só admin da plataforma lê e escreve)
CREATE TABLE IF NOT EXISTS public.plan_modules (
  plan_key    text NOT NULL REFERENCES public.plans(key),
  module_key  text NOT NULL,
  enabled     boolean NOT NULL,
  PRIMARY KEY (plan_key, module_key)
);
ALTER TABLE public.plan_modules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_modules_admin_all ON public.plan_modules;
CREATE POLICY plan_modules_admin_all ON public.plan_modules FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- 2b) Semente de módulos por plano: PROVISÓRIA (SecOps 1). Hoje os três planos liberam os 15 módulos.
-- A diferenciação por plano é decisão pendente do usuário; ajustar com UPDATE em plan_modules antes do go-live.
INSERT INTO public.plan_modules (plan_key, module_key, enabled)
SELECT p.key, m.module_key, true
FROM public.plans p
CROSS JOIN (VALUES ('dashboard'),('sales'),('customers'),('inventory'),('settings'),('reports'),('quotes'),
                    ('financial'),('boletos'),('suppliers'),('orders'),('production'),('custom_production'),
                    ('deliveries'),('push_notifications')) AS m(module_key)
ON CONFLICT (plan_key, module_key) DO NOTHING;

-- 3) Eventos de cobrança (idempotência pelo id do evento do gateway; retenção de 180 dias, payload mínimo)
CREATE TABLE IF NOT EXISTS public.billing_events (
  event_id               text PRIMARY KEY,
  received_at           timestamptz NOT NULL DEFAULT now(),
  event_type             text NOT NULL CHECK (event_type IN ('confirmed','late','canceled','refunded')),
  store_id               uuid NULL REFERENCES public.stores(id) ON DELETE SET NULL,
  gateway_subscription_id text NULL,
  outcome                text NOT NULL,
  payload_min            jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at             timestamptz NOT NULL DEFAULT (now() + interval '180 days')
);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_events_admin_read ON public.billing_events;
CREATE POLICY billing_events_admin_read ON public.billing_events FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- 4) Assinaturas (tabela da 009): colunas novas e leitura só do admin da plataforma
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS grace_until timestamptz NULL;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS last_event_id text NULL;

-- 4b) plan_id: AMPLIADA (D-8). Mantém os valores antigos (starter, pro, enterprise, custom) e aceita os novos.
-- Não remove valor existente. O mapeamento dos antigos para os novos fica para migração separada.
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_id_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_id_check
  CHECK (plan_id IN ('starter', 'pro', 'enterprise', 'custom', 'inicio', 'crescimento', 'avancado'));
-- status usa os valores já permitidos pela 009: active, past_due (atraso), cancelled (cancelado), unpaid, trialing, paused.
-- Retenção (D-6): subscription_payments (018) e invoices (009) ficam 5 anos — CONFIRMAR COM CONTADOR. Nada é apagado aqui.
-- Marca/cor (D-7): módulo do plano Avançado. Quando os módulos forem semeados, 'marca' só fica habilitado no avancado.

-- 4c) status de assinatura: AMPLIADO (aditivo). Mantém os valores da 009 e acrescenta 'suspended'.
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'past_due', 'unpaid', 'cancelled', 'trialing', 'paused', 'suspended'));
-- ATENÇÃO: remove a leitura do gerente (requisito SecOps 3). O dono e o gerente deixam de ver cobrança.
DROP POLICY IF EXISTS subscriptions_store_manager_select ON public.subscriptions;
DROP POLICY IF EXISTS invoices_store_manager_select ON public.invoices;

-- 5) Limite de vendedores pelo plano (trigger): só vale para assinatura ativa ou em atraso
CREATE OR REPLACE FUNCTION public.enforce_seller_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_max integer;
  v_count integer;
BEGIN
  IF NEW.role IS DISTINCT FROM 'SELLER' THEN
    RETURN NEW;
  END IF;
  SELECT p.max_sellers INTO v_max
  FROM public.subscriptions s JOIN public.plans p ON p.key = s.plan_id
  WHERE s.store_id = NEW.store_id AND s.status IN ('active', 'past_due')
  LIMIT 1;
  IF v_max IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count FROM public.store_members m
  WHERE m.store_id = NEW.store_id AND m.role = 'SELLER';
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Limite de vendedores do plano atingido (%).', v_max USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$f$;
DROP TRIGGER IF EXISTS store_members_seller_limit ON public.store_members;
CREATE TRIGGER store_members_seller_limit
  BEFORE INSERT OR UPDATE OF role ON public.store_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_seller_limit();

-- 6) Aplicação dos módulos do plano (interna: sem checagem de quem chama; não exposta)
CREATE OR REPLACE FUNCTION public.apply_plan_modules_internal(p_store uuid, p_plan text, p_actor uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.plan_modules WHERE plan_key = p_plan;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Plano % não tem módulos cadastrados. Nada foi alterado.', p_plan;
  END IF;

  INSERT INTO public.store_modules (store_id, module_key, enabled)
  SELECT p_store, pm.module_key, pm.enabled FROM public.plan_modules pm WHERE pm.plan_key = p_plan
  ON CONFLICT (store_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();

  -- Auditoria na mesma transação (sem log, sem troca)
  INSERT INTO public.admin_audit_logs (admin_id, store_id, action, details)
  VALUES (p_actor, p_store, 'apply_plan_modules', jsonb_build_object('plan', p_plan, 'modules', v_count));

  RETURN v_count;
END
$f$;
REVOKE ALL ON FUNCTION public.apply_plan_modules_internal(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- 7) Aplicação pelo admin da plataforma (ou servidor). Cliente comum não chama.
CREATE OR REPLACE FUNCTION public.apply_plan_modules(p_store uuid, p_plan text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
BEGIN
  IF NOT (public.is_platform_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma pode trocar o plano.' USING ERRCODE = '42501';
  END IF;
  RETURN public.apply_plan_modules_internal(p_store, p_plan, auth.uid());
END
$f$;
REVOKE ALL ON FUNCTION public.apply_plan_modules(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_plan_modules(uuid, text) TO authenticated, service_role;

-- 8) Processamento de evento do gateway (chamado SÓ pela Edge Function billing-webhook, com service_role)
CREATE OR REPLACE FUNCTION public.process_billing_event(
  p_event_id text, p_type text, p_store uuid, p_plan text, p_period_end timestamptz,
  p_grace_days integer DEFAULT 5, p_gateway_subscription text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_n integer;
  v_price integer;
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) = 0 THEN
    RAISE EXCEPTION 'Evento sem id.';
  END IF;
  IF p_type NOT IN ('confirmed', 'late', 'canceled', 'refunded') THEN
    RAISE EXCEPTION 'Tipo de evento inválido.';
  END IF;

  -- Idempotência: o mesmo id de evento nunca é aplicado duas vezes
  INSERT INTO public.billing_events (event_id, event_type, store_id, gateway_subscription_id, outcome)
  VALUES (p_event_id, p_type, p_store, p_gateway_subscription, 'recebido')
  ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN 'duplicado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores st WHERE st.id = p_store) THEN
    UPDATE public.billing_events SET outcome = 'ignorado: loja inexistente' WHERE event_id = p_event_id;
    RETURN 'ignorado';
  END IF;

  SELECT p.price_cents INTO v_price FROM public.plans p WHERE p.key = p_plan AND p.active;

  IF p_type = 'confirmed' THEN
    UPDATE public.subscriptions SET plan_id = p_plan, status = 'active', price_cents = COALESCE(v_price, price_cents),
           current_period_end = p_period_end, grace_until = NULL, last_event_id = p_event_id, updated_at = now()
     WHERE store_id = p_store;
    IF NOT FOUND THEN
      INSERT INTO public.subscriptions (store_id, plan_id, status, price_cents, billing_cycle,
                                        current_period_start, current_period_end, last_event_id)
      VALUES (p_store, p_plan, 'active', COALESCE(v_price, 0), 'monthly', now(), p_period_end, p_event_id);
    END IF;
    UPDATE public.stores SET status = 'active', valid_until = p_period_end WHERE id = p_store;
    PERFORM public.apply_plan_modules_internal(p_store, p_plan, NULL);

  ELSIF p_type = 'late' THEN
    IF NOT EXISTS (SELECT 1 FROM public.subscriptions sb WHERE sb.store_id = p_store) THEN
      UPDATE public.billing_events SET outcome = 'ignorado: sem assinatura' WHERE event_id = p_event_id;
      RETURN 'ignorado';
    END IF;
    -- Atraso: dentro da carência continua ativo; a suspensão após a carência é tarefa separada (pendente).
    UPDATE public.subscriptions SET status = 'past_due', grace_until = now() + make_interval(days => p_grace_days),
           last_event_id = p_event_id, updated_at = now()
     WHERE store_id = p_store;

  ELSE
    -- canceled / refunded: assinatura encerrada e loja suspensa
    IF NOT EXISTS (SELECT 1 FROM public.subscriptions sb WHERE sb.store_id = p_store) THEN
      UPDATE public.billing_events SET outcome = 'ignorado: sem assinatura' WHERE event_id = p_event_id;
      RETURN 'ignorado';
    END IF;
    UPDATE public.subscriptions SET status = 'cancelled', grace_until = NULL, last_event_id = p_event_id, updated_at = now()
     WHERE store_id = p_store;
    UPDATE public.stores SET status = 'suspended' WHERE id = p_store;
    INSERT INTO public.admin_audit_logs (admin_id, store_id, action, details)
    VALUES (NULL, p_store, 'billing_' || p_type, jsonb_build_object('event_id', p_event_id));
  END IF;

  UPDATE public.billing_events SET outcome = 'aplicado' WHERE event_id = p_event_id;
  RETURN 'aplicado';
END
$f$;
REVOKE ALL ON FUNCTION public.process_billing_event(text, text, uuid, text, timestamptz, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_billing_event(text, text, uuid, text, timestamptz, integer, text) TO service_role;

-- 9) Carência vencida: depois do último dia sem pagamento, a loja é suspensa (acesso só para regularizar).
-- Chamada pelo servidor (service_role) ou pelo admin. Agendamento diário: decisão pendente (pg_cron ou Edge Function).
CREATE OR REPLACE FUNCTION public.expire_billing_grace()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_n integer := 0;
  rec record;
BEGIN
  IF NOT (public.is_platform_admin() OR auth.role() = 'service_role' OR current_user = 'postgres') THEN
    RAISE EXCEPTION 'Apenas o servidor ou o administrador da plataforma executa a verificação de carência.' USING ERRCODE = '42501';
  END IF;
  FOR rec IN
    SELECT sb.store_id FROM public.subscriptions sb
    WHERE sb.status = 'past_due' AND sb.grace_until IS NOT NULL AND sb.grace_until < now()
  LOOP
    UPDATE public.stores SET status = 'suspended' WHERE id = rec.store_id AND status IS DISTINCT FROM 'suspended';
    IF FOUND THEN
      v_n := v_n + 1;
      INSERT INTO public.admin_audit_logs (admin_id, store_id, action, details)
      VALUES (auth.uid(), rec.store_id, 'billing_grace_expired', '{}'::jsonb);
    END IF;
  END LOOP;
  RETURN v_n;
END
$f$;
REVOKE ALL ON FUNCTION public.expire_billing_grace() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_billing_grace() TO authenticated, service_role;

-- 10) Aviso de cobrança do próprio dono/gerente: só status e data da carência (sem valor, sem ids do gateway)
CREATE OR REPLACE FUNCTION public.get_store_billing_status()
RETURNS TABLE (status text, grace_until timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $f$
  SELECT sb.status, sb.grace_until
  FROM public.subscriptions sb
  WHERE sb.store_id = public.current_store_id() AND public.is_store_manager(sb.store_id);
$f$;
REVOKE ALL ON FUNCTION public.get_store_billing_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_billing_status() TO authenticated;

-- Verificação pós-aplicação (esperado: tabelas e funções presentes; anon sem EXECUTE nas funções de cobrança)
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'execute') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('apply_plan_modules', 'process_billing_event', 'apply_plan_modules_internal', 'enforce_seller_limit', 'expire_billing_grace', 'get_store_billing_status');

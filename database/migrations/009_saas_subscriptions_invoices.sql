-- ============================================================================
-- 009_saas_subscriptions_invoices.sql
-- Dossiê SaaS Admin: Gestão de Assinaturas, Faturamento, Invoices e Auditoria
-- Baseado no dossiê técnico de engenharia (dossie-admin-assinaturas-saas.md).
-- ============================================================================

BEGIN;

-- 1. Tabela de Assinaturas (Subscriptions) vinculada às lojas/tenants
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE UNIQUE,
    plan_id TEXT NOT NULL DEFAULT 'starter' CHECK (plan_id IN ('starter', 'pro', 'enterprise', 'custom')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'unpaid', 'cancelled', 'trialing', 'paused')),
    price_cents INT NOT NULL DEFAULT 0,
    billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_period_end TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
    gateway_subscription_id TEXT,
    cancel_at_period_end BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabela de Faturas (Invoices)
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    amount_cents INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('paid', 'pending', 'failed', 'refunded', 'void')),
    due_date DATE NOT NULL DEFAULT CURRENT_DATE,
    paid_at TIMESTAMPTZ,
    payment_method TEXT CHECK (payment_method IN ('pix', 'credit_card', 'boleto', 'manual')),
    hosted_invoice_url TEXT,
    gateway_invoice_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Log de Auditoria do Admin (Impersonação e Operações Críticas)
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES auth.users(id),
    store_id UUID REFERENCES public.stores(id),
    action TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_subscriptions_store ON public.subscriptions(store_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_invoices_store ON public.invoices(store_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_admin_audit_store ON public.admin_audit_logs(store_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_logs(created_at DESC);

-- Habilita RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para Subscriptions
DROP POLICY IF EXISTS subscriptions_admin_all ON public.subscriptions;
CREATE POLICY subscriptions_admin_all ON public.subscriptions
    FOR ALL TO authenticated
    USING (public.is_platform_admin())
    WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS subscriptions_store_member_select ON public.subscriptions;
CREATE POLICY subscriptions_store_member_select ON public.subscriptions
    FOR SELECT TO authenticated
    USING (public.is_store_member(store_id));

-- Políticas de RLS para Invoices
DROP POLICY IF EXISTS invoices_admin_all ON public.invoices;
CREATE POLICY invoices_admin_all ON public.invoices
    FOR ALL TO authenticated
    USING (public.is_platform_admin())
    WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS invoices_store_member_select ON public.invoices;
CREATE POLICY invoices_store_member_select ON public.invoices
    FOR SELECT TO authenticated
    USING (public.is_store_member(store_id));

-- Políticas de RLS para Admin Audit Logs (Apenas Admin da Plataforma)
DROP POLICY IF EXISTS admin_audit_logs_admin_all ON public.admin_audit_logs;
CREATE POLICY admin_audit_logs_admin_all ON public.admin_audit_logs
    FOR ALL TO authenticated
    USING (public.is_platform_admin())
    WITH CHECK (public.is_platform_admin());

-- Sincronizar lojas existentes para a tabela de assinaturas (se ainda não existirem)
-- Preço conforme o plano informado na loja (Início R$ 49, Crescimento R$ 99, Avançado R$ 199).
-- Loja sem plano reconhecido vira plan_id 'custom' com preço 0: não entra no MRR até o plano ser definido.
INSERT INTO public.subscriptions (store_id, plan_id, status, price_cents, billing_cycle, current_period_end)
SELECT
    s.id,
    CASE
        WHEN lower(trim(COALESCE(s.plan, ''))) IN ('início', 'inicio') THEN 'starter'
        WHEN lower(trim(COALESCE(s.plan, ''))) = 'crescimento' THEN 'pro'
        WHEN lower(trim(COALESCE(s.plan, ''))) IN ('avançado', 'avancado') THEN 'enterprise'
        ELSE 'custom'
    END,
    CASE
        WHEN s.status = 'trial' THEN 'trialing'
        WHEN s.status = 'suspended' THEN 'paused'
        WHEN s.status = 'expired' THEN 'past_due'
        ELSE 'active'
    END,
    CASE
        WHEN lower(trim(COALESCE(s.plan, ''))) IN ('início', 'inicio') THEN 4900
        WHEN lower(trim(COALESCE(s.plan, ''))) = 'crescimento' THEN 9900
        WHEN lower(trim(COALESCE(s.plan, ''))) IN ('avançado', 'avancado') THEN 19900
        ELSE 0
    END,
    'monthly',
    COALESCE(s.valid_until, s.trial_ends_at, now() + interval '30 days')
FROM public.stores s
ON CONFLICT (store_id) DO NOTHING;

-- RPC: Obter Métricas Globais de SaaS para o Dashboard do Admin
CREATE OR REPLACE FUNCTION public.admin_get_saas_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_stores INT;
    v_active_stores INT;
    v_trial_stores INT;
    v_past_due_stores INT;
    v_suspended_stores INT;
    v_cancelled_stores INT;
    v_mrr_cents BIGINT;
    v_past_due_cents BIGINT;
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Acesso negado: apenas o administrador da plataforma pode ver métricas SaaS.';
    END IF;

    SELECT COUNT(*) INTO v_total_stores FROM public.stores;

    SELECT 
        COUNT(*) FILTER (WHERE status = 'active'),
        COUNT(*) FILTER (WHERE status = 'trialing'),
        COUNT(*) FILTER (WHERE status = 'past_due'),
        COUNT(*) FILTER (WHERE status = 'paused'),
        COUNT(*) FILTER (WHERE status = 'cancelled'),
        COALESCE(SUM(CASE WHEN status = 'active' THEN price_cents ELSE 0 END), 0)
    INTO 
        v_active_stores,
        v_trial_stores,
        v_past_due_stores,
        v_suspended_stores,
        v_cancelled_stores,
        v_mrr_cents
    FROM public.subscriptions;

    SELECT COALESCE(SUM(amount_cents), 0) INTO v_past_due_cents
    FROM public.invoices
    WHERE status IN ('pending', 'failed') AND due_date < CURRENT_DATE;

    RETURN jsonb_build_object(
        'total_stores', v_total_stores,
        'active_stores', v_active_stores,
        'trial_stores', v_trial_stores,
        'past_due_stores', v_past_due_stores,
        'suspended_stores', v_suspended_stores,
        'cancelled_stores', v_cancelled_stores,
        'mrr_cents', v_mrr_cents,
        'past_due_cents', v_past_due_cents
    );
END;
$$;

-- RPC: Registrar Log de Auditoria
CREATE OR REPLACE FUNCTION public.admin_log_audit(
    p_store_id UUID,
    p_action TEXT,
    p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Apenas administrador da plataforma pode registrar logs de auditoria.';
    END IF;

    INSERT INTO public.admin_audit_logs (admin_id, store_id, action, details)
    VALUES (auth.uid(), p_store_id, p_action, p_details)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

COMMIT;

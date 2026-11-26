-- 009b: correções de segurança da 009 (já aplicada no banco). RASCUNHO: NÃO aplicado.
-- Aguarda revisão do SecOps e aprovação do usuário. Não testado em ROLLBACK ainda.
--
-- 1) admin_audit_logs: a política FOR ALL permitia ao admin alterar e apagar o log. Só leitura e inserção.
-- 2) subscriptions e invoices: qualquer membro (inclusive vendedor) lia os dados de cobrança, com IDs do gateway.
--    Passa a ser só dono e gerente da loja (is_store_manager).
-- 3) admin_get_saas_metrics: a mensagem de erro foi gravada com codificação corrompida. Recriada com o texto correto.

-- 1) Log de auditoria: imutável para o admin (sem UPDATE e sem DELETE)
DROP POLICY IF EXISTS admin_audit_logs_admin_all ON public.admin_audit_logs;
-- Defesa extra: sem privilégio de UPDATE e DELETE para authenticated na tabela de log
REVOKE UPDATE, DELETE ON public.admin_audit_logs FROM authenticated, anon, PUBLIC;

CREATE POLICY admin_audit_logs_admin_select ON public.admin_audit_logs
    FOR SELECT TO authenticated
    USING (public.is_platform_admin());

CREATE POLICY admin_audit_logs_admin_insert ON public.admin_audit_logs
    FOR INSERT TO authenticated
    WITH CHECK (public.is_platform_admin());

-- 2) Dados de cobrança: só dono e gerente da loja
DROP POLICY IF EXISTS subscriptions_store_member_select ON public.subscriptions;
CREATE POLICY subscriptions_store_manager_select ON public.subscriptions
    FOR SELECT TO authenticated
    USING (public.is_store_manager(store_id));

DROP POLICY IF EXISTS invoices_store_member_select ON public.invoices;
CREATE POLICY invoices_store_manager_select ON public.invoices
    FOR SELECT TO authenticated
    USING (public.is_store_manager(store_id));

-- 3) Métricas do admin com mensagem correta
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

REVOKE ALL ON FUNCTION public.admin_get_saas_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_saas_metrics() TO authenticated;

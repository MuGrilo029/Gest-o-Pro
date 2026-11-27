-- 052: limpeza de trial não convertido (decisão 49): apaga os dados da loja e mantém só a conta (login) do dono.
-- SÓ A FUNÇÃO. Nada é agendado nem executado por esta migração. Execução real precisa de aprovação.
-- Guardas: recusa loja que não é trial vencido, loja com assinatura paga ou com pagamento registrado. Padrão: simulação (p_dry_run = true) devolve o que seria apagado.
-- Fica: a linha de stores (inativa, status expired) para o log de auditoria (FK e retenção de 5 anos),
-- o aceite dos Termos (registro legal), o log do admin e a conta do dono (auth.users + profiles).
-- Arquivos no Storage não são apagados por SQL: a função devolve os prefixos para um job com a API do Storage.

BEGIN;

-- Sem guarda por loja: decisão do dono (27/11) — todas as lojas do projeto são de teste. Continua sem agendamento.
DROP FUNCTION IF EXISTS public._is_protected_store(uuid);

CREATE OR REPLACE FUNCTION public.purge_unconverted_trial(p_store uuid, p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  st public.stores%ROWTYPE;
  v_owner uuid;
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  v_tab text;
  v_users uuid[];
  -- Ordem explícita (filhos antes dos pais); tabelas novas com store_id entram depois, pelo catálogo.
  v_order text[] := ARRAY['sale_items', 'quote_items', 'transaction_payments', 'transactions', 'deliveries',
                          'production_orders', 'orders', 'stock_movements', 'stock_balances', 'warehouses',
                          'sales', 'quotes', 'products', 'customers', 'suppliers', 'categories', 'category_groups',
                          'card_fees', 'simulations', 'company_settings', 'store_modules', 'store_module_overrides',
                          'invoices', 'subscriptions', 'store_members'];
  v_keep text[] := ARRAY['stores', 'admin_audit_logs', 'terms_acceptances', 'subscription_payments', 'billing_events',
                         'billing_gateway_requests', 'upgrade_payment_events'];
BEGIN
  IF NOT (auth.role() = 'service_role' OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Apenas o servidor executa a limpeza de trial.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO st FROM public.stores WHERE id = p_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
  IF NOT (st.is_trial OR st.status = 'trial') OR st.valid_until IS NOT NULL THEN
    RAISE EXCEPTION 'Só loja de trial (nunca paga) pode ser limpa.';
  END IF;
  IF st.trial_ends_at IS NULL OR st.trial_ends_at > now() THEN
    RAISE EXCEPTION 'O trial desta loja ainda não venceu.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscriptions sb WHERE sb.store_id = p_store AND sb.status <> 'trialing')
     OR EXISTS (SELECT 1 FROM public.subscription_payments sp WHERE sp.store_id = p_store) THEN
    RAISE EXCEPTION 'Loja com assinatura ou pagamento: não é trial não convertido.';
  END IF;

  SELECT m.user_id INTO v_owner FROM public.store_members m
   WHERE m.store_id = p_store AND m.role = 'OWNER' ORDER BY m.created_at LIMIT 1;

  -- Contas que saem: membros que não são o dono, não são admin e não estão em outra loja.
  SELECT COALESCE(array_agg(m.user_id), '{}') INTO v_users FROM public.store_members m
   WHERE m.store_id = p_store AND m.user_id IS DISTINCT FROM v_owner
     AND NOT COALESCE((SELECT p.is_platform_admin FROM public.profiles p WHERE p.id = m.user_id), false)
     AND NOT EXISTS (SELECT 1 FROM public.store_members o WHERE o.user_id = m.user_id AND o.store_id <> p_store);

  -- Tabelas do catálogo com store_id que não estão na ordem nem na lista de preservação
  v_order := v_order || ARRAY(
    SELECT c.table_name::text FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'store_id'
       AND c.table_name::text <> ALL (v_order) AND c.table_name::text <> ALL (v_keep)
     ORDER BY 1);

  FOREACH v_tab IN ARRAY v_order LOOP
    IF to_regclass('public.' || v_tab) IS NULL THEN CONTINUE; END IF;
    IF p_dry_run THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE store_id = $1', v_tab) INTO v_n USING p_store;
    ELSE
      EXECUTE format('DELETE FROM public.%I WHERE store_id = $1', v_tab) USING p_store;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    IF v_n > 0 THEN v_counts := v_counts || jsonb_build_object(v_tab, v_n); END IF;
  END LOOP;

  IF NOT p_dry_run THEN
    DELETE FROM auth.users WHERE id = ANY (v_users);
    UPDATE public.profiles SET active_store_id = NULL WHERE active_store_id = p_store;
    UPDATE public.stores SET is_active = false, status = 'expired' WHERE id = p_store;
    PERFORM public._audit_server(p_store, 'purge_unconverted_trial',
      jsonb_build_object('linhas', v_counts, 'contas_removidas', cardinality(v_users), 'dono_mantido', v_owner));
  END IF;

  RETURN jsonb_build_object('store_id', p_store, 'dry_run', p_dry_run, 'linhas', v_counts,
                            'contas_removidas', cardinality(v_users), 'dono_mantido', v_owner,
                            'storage_prefixos', jsonb_build_array('products/' || p_store || '/', 'producao-anexos/' || p_store || '/'));
END $$;
REVOKE ALL ON FUNCTION public.purge_unconverted_trial(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_unconverted_trial(uuid, boolean) TO service_role;

COMMIT;

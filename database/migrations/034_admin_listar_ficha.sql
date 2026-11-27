-- 034-admin-listar-ficha-apply.sql (revisão 2, após revisao-secops-034.md)
-- Migração aditiva. Listagem com filtros e cursor composto, e ficha da loja.
-- Base: admin-plano/02-arquitetura.md, seção 6.
-- Não altera tabelas. A ficha grava UMA linha de auditoria por leitura ('view_store_detail'), por pedido da SecOps.
-- Acesso: só admin da plataforma (_require_platform_admin). Sem GRANT a anon. Sem dado de cobrança do cliente (CPF/CNPJ, cartão).
-- Ordenação e cursor: chave K = COALESCE(vencimento, 'infinity') + id. Vencimento NULL fica por último de forma determinística.
--   Vencimento = COALESCE(subscriptions.current_period_end, stores.trial_ends_at, stores.valid_until).
-- PRÉ-REQUISITO: nenhum além das tabelas já existentes (stores, subscriptions, store_modules, subscription_payments, admin_audit_logs).
-- NÃO EXECUTAR em produção antes do teste verde em ROLLBACK, da revisão da SecOps e da autorização do usuário.

-- (1) Listagem com filtros e cursor composto (K, id). Máx. 100 por página.
CREATE OR REPLACE FUNCTION public.admin_list_stores(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50,
  p_after_key timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_items jsonb;
  v_count integer;
  v_last jsonb;
BEGIN
  PERFORM public._require_platform_admin();

  -- Cursor: ou ambos os campos, ou nenhum
  IF (p_after_key IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'Cursor incompleto.';
  END IF;

  WITH base AS (
    SELECT st.id, st.name, st.status,
           COALESCE(sb.plan_id, st.plan) AS plano,
           sb.status AS assinatura_status,
           COALESCE(sb.current_period_end, st.trial_ends_at, st.valid_until) AS fim,
           COALESCE(COALESCE(sb.current_period_end, st.trial_ends_at, st.valid_until), 'infinity'::timestamptz) AS chave,
           st.trial_ends_at, st.valid_until, st.created_at
      FROM public.stores st
      LEFT JOIN public.subscriptions sb ON sb.store_id = st.id
     WHERE (p_filters->>'status' IS NULL OR st.status = p_filters->>'status')
       AND (p_filters->>'plan' IS NULL OR COALESCE(sb.plan_id, st.plan) = p_filters->>'plan')
       AND (p_filters->>'em_teste' IS DISTINCT FROM 'true' OR st.status = 'trial')
       AND (p_filters->>'vencimento_ate' IS NULL
            OR COALESCE(sb.current_period_end, st.trial_ends_at, st.valid_until) <= (p_filters->>'vencimento_ate')::timestamptz)
  ),
  pagina AS (
    SELECT b.*
      FROM base b
     WHERE p_after_key IS NULL OR (b.chave, b.id) > (p_after_key, p_after_id)
     ORDER BY b.chave, b.id
     LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.chave, p.id), '[]'::jsonb), count(*)::integer
    INTO v_items, v_count
    FROM pagina p;

  -- Próximo cursor: último item da página (só quando a página veio cheia)
  v_last := CASE WHEN v_count > 0 THEN v_items -> (v_count - 1) ELSE NULL END;

  RETURN jsonb_build_object(
    'items', v_items,
    'count', v_count,
    'has_more', v_count = v_limit,
    'next_after_key', CASE WHEN v_count = v_limit THEN v_last ->> 'chave' ELSE NULL END,
    'next_after_id', CASE WHEN v_count = v_limit THEN v_last ->> 'id' ELSE NULL END
  );
END
$f$;

REVOKE ALL ON FUNCTION public.admin_list_stores(jsonb, integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_stores(jsonb, integer, timestamptz, uuid) TO authenticated, service_role;

-- (2) Ficha da loja. Registra a leitura na auditoria (mesma transação).
CREATE OR REPLACE FUNCTION public.admin_store_detail(p_store uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_store jsonb;
  v_sub jsonb;
  v_modules jsonb;
  v_payments integer;
BEGIN
  PERFORM public._require_platform_admin();

  SELECT jsonb_build_object('id', st.id, 'name', st.name, 'status', st.status, 'plan', st.plan,
                            'trial_ends_at', st.trial_ends_at, 'valid_until', st.valid_until,
                            'monthly_value', st.monthly_value, 'created_at', st.created_at)
    INTO v_store FROM public.stores st WHERE st.id = p_store;
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'Loja não encontrada.';
  END IF;

  SELECT jsonb_build_object('plan_id', sb.plan_id, 'status', sb.status, 'price_cents', sb.price_cents,
                            'billing_cycle', sb.billing_cycle, 'current_period_end', sb.current_period_end,
                            'cancel_at_period_end', sb.cancel_at_period_end)
    INTO v_sub FROM public.subscriptions sb WHERE sb.store_id = p_store;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('module_key', sm.module_key, 'enabled', sm.enabled) ORDER BY sm.module_key), '[]'::jsonb)
    INTO v_modules FROM public.store_modules sm WHERE sm.store_id = p_store;

  SELECT count(*)::integer INTO v_payments FROM public.subscription_payments sp WHERE sp.store_id = p_store;

  -- Rastro da leitura: a ficha mostra dado de cliente, então registra quem abriu (sem o conteúdo).
  PERFORM public.admin_log_audit(p_store, 'view_store_detail', '{}'::jsonb);

  RETURN jsonb_build_object(
    'loja', v_store,
    'assinatura', v_sub,
    'modulos', v_modules,
    'pagamentos_legado', v_payments
  );
END
$f$;

REVOKE ALL ON FUNCTION public.admin_store_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_store_detail(uuid) TO authenticated, service_role;

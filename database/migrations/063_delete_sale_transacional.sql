-- 063: excluir venda numa transação só (decisão 19). Antes (store.tsx deleteSale): o cliente devolvia o estoque
-- produto a produto, apagava lançamentos pela descrição e depois itens, OS, entregas, encomendas e a venda, em
-- chamadas separadas; uma falha no meio deixava estoque devolvido sem venda apagada (ou o contrário).
-- delete_sale(p_sale_id) faz o mesmo que o deleteSale, no servidor:
--   * devolve ao estoque cada item que saiu do estoque (by_order = false e com produto): products.quantity e a
--     variante (variants jsonb), com movimento RETURN 'Estorno de Venda EXCLUÍDA #xxxx'. Depósitos (056): a venda
--     sai do depósito padrão, cujo saldo é total − extras; devolver ao total devolve ao padrão. stock_balances não muda;
--   * apaga os lançamentos da venda: os com sale_id e, para vendas antigas sem sale_id, os com 'Venda #xxxx' na
--     descrição, só quando nenhuma outra venda da loja começa com o mesmo xxxx (o cliente apagava qualquer
--     lançamento com esse trecho, inclusive de outra venda com o mesmo prefixo);
--   * apaga sale_items, production_orders, deliveries e orders ligados à venda, e a venda;
--   * quotes.converted_sale_id vira NULL pela FK (ON DELETE SET NULL), como antes.
-- Não muda: anexos de OS no Storage (producao-anexos) continuam lá, como hoje.
-- Só dono ou gerente da loja da venda; admin da plataforma só na loja ativa (impersonada), como o edit_sale_items.
-- pg_advisory_xact_lock por venda contra exclusão dupla simultânea. Idempotente (CREATE OR REPLACE).
-- DELETE direto (antes: sales_delete e transactions_manage, criadas nos laços format() da 003; iguais em produção):
--   * sales: sai de vez. A policy sales_delete é removida e o privilégio DELETE é revogado de authenticated e anon.
--     Apagar direto pulava a devolução de estoque e deixava itens e lançamentos soltos; só o delete_sale exclui venda;
--   * transactions: continua só para dono e gerente (transactions_manage), para a tela do financeiro;
--   * sale_items: continua só para dono e gerente (sale_items_write, 059).
-- Aplicar junto com o front usando delete_sale. Com o deleteSale antigo, a exclusão falha depois de devolver estoque.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_sale(p_sale_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_store uuid;
  v_short text;
  it record;
  n_stock int := 0; n_tx int := 0; n_items int := 0; n_po int := 0; n_deliv int := 0; n_orders int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login para excluir a venda.' USING ERRCODE = '42501'; END IF;
  IF p_sale_id IS NULL THEN RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('delete_sale:' || p_sale_id::text, 0));

  SELECT s.store_id INTO v_store FROM public.sales s WHERE s.id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.is_store_manager(v_store) THEN
    RAISE EXCEPTION 'Apenas dono ou gerente pode excluir vendas.' USING ERRCODE = '42501';
  END IF;
  IF public.current_store_id() IS DISTINCT FROM v_store THEN
    RAISE EXCEPTION 'Esta venda pertence a outra loja.' USING ERRCODE = '42501';
  END IF;
  v_short := left(p_sale_id::text, 4);

  -- 1. Estoque: devolve o que saiu do estoque (mesma regra do cliente: by_order = false e com produto).
  FOR it IN
    SELECT si.product_id, si.product_name, si.quantity, si.variant_id, si.variant_name
      FROM public.sale_items si
     WHERE si.sale_id = p_sale_id AND NOT COALESCE(si.by_order, false) AND si.product_id IS NOT NULL
       AND COALESCE(si.quantity, 0) > 0
     ORDER BY si.product_id
  LOOP
    UPDATE public.products p
       SET quantity = COALESCE(p.quantity, 0) + it.quantity,
           variants = CASE WHEN it.variant_id IS NULL OR jsonb_typeof(p.variants) IS DISTINCT FROM 'array' THEN p.variants
                           ELSE (SELECT jsonb_agg(CASE WHEN v->>'id' = it.variant_id::text
                                                       THEN jsonb_set(v, '{quantity}', to_jsonb(COALESCE((v->>'quantity')::int, 0) + it.quantity))
                                                       ELSE v END ORDER BY ord)
                                   FROM jsonb_array_elements(p.variants) WITH ORDINALITY AS x(v, ord)) END
     WHERE p.id = it.product_id AND p.store_id = v_store;
    IF FOUND THEN
      INSERT INTO public.stock_movements (store_id, product_id, product_name, quantity, type, date, observations, user_id, variant_id, variant_name)
      VALUES (v_store, it.product_id, it.product_name, it.quantity, 'RETURN', now(),
              'Estorno de Venda EXCLUÍDA #' || v_short || COALESCE(' - ' || NULLIF(it.variant_name, ''), ''),
              v_uid, it.variant_id, NULLIF(it.variant_name, ''));
      n_stock := n_stock + 1;
    END IF;
  END LOOP;

  -- 2. Lançamentos da venda (receita, taxa, restante e parciais).
  DELETE FROM public.transactions t
   WHERE t.store_id = v_store
     AND (t.sale_id = p_sale_id
          OR (t.sale_id IS NULL
              AND t.description ILIKE '%Venda #' || v_short || '%'
              AND NOT EXISTS (SELECT 1 FROM public.sales o
                               WHERE o.store_id = v_store AND o.id <> p_sale_id AND left(o.id::text, 4) = v_short)));
  GET DIAGNOSTICS n_tx = ROW_COUNT;

  -- 3. Itens, OS, entregas, encomendas e a venda.
  DELETE FROM public.sale_items WHERE sale_id = p_sale_id;
  GET DIAGNOSTICS n_items = ROW_COUNT;
  DELETE FROM public.production_orders WHERE sale_id = p_sale_id;
  GET DIAGNOSTICS n_po = ROW_COUNT;
  DELETE FROM public.deliveries WHERE sale_id = p_sale_id;
  GET DIAGNOSTICS n_deliv = ROW_COUNT;
  DELETE FROM public.orders WHERE sale_id = p_sale_id;
  GET DIAGNOSTICS n_orders = ROW_COUNT;
  DELETE FROM public.sales WHERE id = p_sale_id;

  RETURN jsonb_build_object('sale_id', p_sale_id, 'estoque_devolvido', n_stock, 'lancamentos', n_tx, 'itens', n_items,
                            'ordens_producao', n_po, 'entregas', n_deliv, 'encomendas', n_orders);
END $$;
DROP POLICY IF EXISTS sales_delete ON public.sales;
REVOKE DELETE ON public.sales FROM authenticated, anon;

REVOKE ALL ON FUNCTION public.delete_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_sale(uuid) TO authenticated;

COMMIT;

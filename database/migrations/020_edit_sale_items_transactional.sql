-- 020: edição transacional dos itens de uma venda, com ajuste de estoque pela diferença
-- Tudo numa única transação (a função inteira é atômica): valida, bloqueia as linhas, ajusta
-- o estoque pela diferença por produto, grava o movimento e troca os itens.
-- Não altera o total da venda: o total continua sendo gravado pelo app (updateSale), como hoje.
-- Itens com variante não ajustam estoque aqui: a função recusa e pede ajuste manual.
-- Movimento: 'saida' quando a venda ganha quantidade; 'entrada' quando perde (padrão já usado em stock_movements).

CREATE OR REPLACE FUNCTION public.edit_sale_items(p_sale uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_uid   uuid := auth.uid();
  v_store uuid;
  v_count int;
  v_adj   int := 0;
  v_stock int;
  v_name  text;
  rec     record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Faça login para editar a venda.' USING ERRCODE = '42501';
  END IF;

  SELECT s.store_id INTO v_store FROM public.sales s WHERE s.id = p_sale FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.';
  END IF;

  IF NOT public.is_store_manager(v_store) THEN
    RAISE EXCEPTION 'Apenas dono ou gerente pode editar os itens da venda.' USING ERRCODE = '42501';
  END IF;

  IF public.current_store_id() IS DISTINCT FROM v_store AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Esta venda pertence a outra loja.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item.';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE COALESCE((e->>'quantity')::int, 0) <= 0) THEN
    RAISE EXCEPTION 'A quantidade de cada item deve ser maior que zero.';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE e->>'variant_id' IS NOT NULL) THEN
    RAISE EXCEPTION 'Itens com variante precisam de ajuste manual de estoque.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    WHERE e->>'product_id' IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = (e->>'product_id')::uuid AND p.store_id = v_store)
  ) THEN
    RAISE EXCEPTION 'Produto não pertence a esta loja.';
  END IF;

  -- Diferença por produto: quantidade nova menos a quantidade já registrada na venda.
  FOR rec IN
    WITH oldq AS (
      SELECT si.product_id AS pid, sum(si.quantity)::int AS q
      FROM public.sale_items si
      WHERE si.sale_id = p_sale AND si.product_id IS NOT NULL
      GROUP BY si.product_id
    ),
    newq AS (
      SELECT (e->>'product_id')::uuid AS pid, sum((e->>'quantity')::int)::int AS q
      FROM jsonb_array_elements(p_items) e
      WHERE e->>'product_id' IS NOT NULL
      GROUP BY 1
    ),
    d AS (
      SELECT COALESCE(n.pid, o.pid) AS pid, COALESCE(n.q, 0) - COALESCE(o.q, 0) AS delta
      FROM newq n FULL JOIN oldq o ON o.pid = n.pid
    )
    SELECT d.pid, d.delta FROM d WHERE d.delta <> 0 ORDER BY d.pid
  LOOP
    SELECT p.quantity, p.name INTO v_stock, v_name FROM public.products p WHERE p.id = rec.pid FOR UPDATE;

    -- delta > 0: a venda ganhou quantidade, então sai mais do estoque.
    IF v_stock - rec.delta < 0 THEN
      RAISE EXCEPTION 'Estoque insuficiente para %: disponível %, necessário %.', v_name, v_stock, rec.delta;
    END IF;

    UPDATE public.products SET quantity = quantity - rec.delta WHERE id = rec.pid;

    INSERT INTO public.stock_movements (product_id, product_name, quantity, type, date, observations, user_id, store_id)
    VALUES (
      rec.pid, v_name, abs(rec.delta),
      CASE WHEN rec.delta > 0 THEN 'saida' ELSE 'entrada' END,
      now(), 'Edição da venda ' || p_sale::text, v_uid, v_store
    );
    v_adj := v_adj + 1;
  END LOOP;

  DELETE FROM public.sale_items WHERE sale_id = p_sale;

  INSERT INTO public.sale_items (sale_id, store_id, product_id, product_name, description, quantity, unit_price, category, service_type, service_specs, color, by_order)
  SELECT
    p_sale, v_store,
    NULLIF(e->>'product_id', '')::uuid,
    COALESCE(e->>'product_name', 'Item sem nome'),
    e->>'description',
    (e->>'quantity')::int,
    COALESCE((e->>'unit_price')::numeric, 0),
    COALESCE(e->>'category', 'Geral'),
    e->>'service_type',
    e->>'service_specs',
    e->>'color',
    COALESCE((e->>'by_order')::boolean, false)
  FROM jsonb_array_elements(p_items) e;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('itens', v_count, 'produtos_ajustados', v_adj);
END
$f$;

REVOKE ALL ON FUNCTION public.edit_sale_items(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_sale_items(uuid, jsonb) TO authenticated;

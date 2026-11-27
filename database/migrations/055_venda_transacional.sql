-- 055: venda numa única transação (decisão 19: serviço sob medida gera OS, entrega e lançamento financeiro).
-- Antes (store.tsx addSale): o app gravava venda, itens, estoque, encomendas, lançamentos, OS e entrega em
-- chamadas separadas; uma falha no meio deixava a venda pela metade. A entrega do serviço só nascia ao concluir a OS.
-- Agora: create_sale(p_sale, p_items) faz tudo no banco, de uma vez, com as mesmas regras do app:
--   * produto com estoque: baixa estoque (e variante), movimento SALE;
--   * produto sem estoque e módulo Encomendas: vira encomenda (orders), sem baixa;
--   * serviço (categoria 'Serviços' ou service_type 'INTERNAL') com módulo Produção: gera OS;
--     se a venda é com entrega e o módulo Entregas está ligado, gera também a entrega ligada à OS
--     (o app não cria outra ao concluir a OS, porque já existe entrega com production_order_id);
--   * módulo Financeiro: entrada/total/restante (INCOME 'Vendas') e taxa de cartão (EXPENSE), todos com sale_id;
--   * itens prontos com entrega: uma entrega 'SALES' com a lista.
-- Módulos lidos no servidor (_store_module_on). Qualquer membro da loja ativa pode vender (como hoje).
-- Idempotente (CREATE OR REPLACE). Não altera dados existentes.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_sale(p_sale jsonb, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_store uuid := public.current_store_id();
  v_sale uuid := COALESCE(NULLIF(p_sale->>'id', '')::uuid, gen_random_uuid());
  v_short text;
  v_date timestamptz := COALESCE(NULLIF(p_sale->>'date', '')::timestamptz, now());
  v_customer text := COALESCE(NULLIF(btrim(p_sale->>'customer_name'), ''), 'Cliente Final');
  v_delivery_type text := COALESCE(p_sale->>'delivery_type', 'PICKUP');
  v_delivery_date date := NULLIF(p_sale->>'delivery_date', '')::date;
  v_total numeric := COALESCE((p_sale->>'total')::numeric, 0);
  v_down numeric := COALESCE((p_sale->>'down_payment')::numeric, 0);
  v_remaining numeric := COALESCE((p_sale->>'remaining_amount')::numeric, 0);
  v_fee numeric := COALESCE((p_sale->>'card_fee_amount')::numeric, 0);
  v_payment_type text := COALESCE(p_sale->>'payment_type', 'FULL');
  v_pm text := p_sale->>'payment_method';
  m_orders boolean; m_financial boolean; m_production boolean; m_deliveries boolean;
  it jsonb;
  v_qty int;
  v_service boolean;
  v_by_order boolean;
  v_prod record;
  v_pid uuid;
  v_po uuid;
  v_ready text[] := '{}';
  n_items int := 0; n_orders int := 0; n_po int := 0; n_deliv int := 0; n_tx int := 0; n_mov int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login para registrar a venda.' USING ERRCODE = '42501'; END IF;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Sem loja ativa ou acesso bloqueado.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Não é possível salvar uma venda sem itens.';
  END IF;
  IF v_total < 0 OR v_down < 0 OR v_remaining < 0 OR v_fee < 0 THEN RAISE EXCEPTION 'Valores da venda inválidos.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE COALESCE((e->>'quantity')::int, 0) <= 0) THEN
    RAISE EXCEPTION 'A quantidade de cada item deve ser maior que zero.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
              WHERE NULLIF(e->>'product_id', '') IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = (e->>'product_id')::uuid AND p.store_id = v_store)) THEN
    RAISE EXCEPTION 'Produto não pertence a esta loja.';
  END IF;

  m_orders := public._store_module_on(v_store, 'orders');
  m_financial := public._store_module_on(v_store, 'financial');
  m_production := public._store_module_on(v_store, 'production');
  m_deliveries := public._store_module_on(v_store, 'deliveries');
  IF NOT m_deliveries THEN v_delivery_type := 'PICKUP'; END IF;
  v_short := left(v_sale::text, 4);

  INSERT INTO public.sales (id, store_id, created_by, customer_name, customer_phone, customer_address, delivery_type, date,
    total, discount, payment_method, down_payment_method, remaining_payment_method, payment_type, down_payment,
    remaining_amount, remaining_status, status, observations, delivery_date, card_fee_amount, card_fee_percentage, card_installments)
  VALUES (v_sale, v_store, v_uid, v_customer, p_sale->>'customer_phone', p_sale->>'customer_address', v_delivery_type, v_date,
    v_total, COALESCE((p_sale->>'discount')::numeric, 0), v_pm, p_sale->>'down_payment_method', p_sale->>'remaining_payment_method',
    v_payment_type, v_down, v_remaining, COALESCE(p_sale->>'remaining_status', 'PAID'), COALESCE(p_sale->>'status', 'COMPLETED'),
    p_sale->>'observations', v_delivery_date, v_fee, COALESCE((p_sale->>'card_fee_percentage')::numeric, 0),
    COALESCE((p_sale->>'card_installments')::int, 0));

  FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := (it->>'quantity')::int;
    v_service := COALESCE(it->>'category', '') = 'Serviços' OR COALESCE(it->>'service_type', '') = 'INTERNAL';
    v_by_order := COALESCE((it->>'by_order')::boolean, false);
    v_pid := NULL;

    IF NOT v_service AND NULLIF(it->>'product_id', '') IS NOT NULL THEN
      SELECT p.id, p.name, p.quantity, p.variants INTO v_prod FROM public.products p
       WHERE p.id = (it->>'product_id')::uuid FOR UPDATE;
      v_pid := v_prod.id;
      IF NOT m_orders THEN v_by_order := false;
      ELSIF COALESCE(v_prod.quantity, 0) <= 0 THEN v_by_order := true;
      END IF;

      IF v_by_order THEN
        INSERT INTO public.orders (store_id, sale_id, product_id, customer_name, product_name, quantity, date, status, notes)
        VALUES (v_store, v_sale, v_prod.id, v_customer, it->>'product_name', v_qty, v_date, 'PENDING', 'Encomenda de Venda #' || v_short);
        n_orders := n_orders + 1;
      ELSE
        UPDATE public.products p
           SET quantity = COALESCE(p.quantity, 0) - v_qty,
               variants = CASE WHEN NULLIF(it->>'variant_id', '') IS NULL OR jsonb_typeof(p.variants) IS DISTINCT FROM 'array' THEN p.variants
                               ELSE (SELECT jsonb_agg(CASE WHEN v->>'id' = it->>'variant_id'
                                                           THEN jsonb_set(v, '{quantity}', to_jsonb(GREATEST(0, COALESCE((v->>'quantity')::int, 0) - v_qty)))
                                                           ELSE v END ORDER BY ord)
                                       FROM jsonb_array_elements(p.variants) WITH ORDINALITY AS x(v, ord)) END
         WHERE p.id = v_prod.id;
        INSERT INTO public.stock_movements (store_id, product_id, product_name, quantity, type, date, observations, user_id, variant_id, variant_name)
        VALUES (v_store, v_prod.id,
                COALESCE(it->>'product_name', v_prod.name) || COALESCE(' (' || NULLIF(it->>'variant_name', '') || ')', ''),
                -v_qty, 'SALE', v_date, 'Venda #' || v_short, v_uid, NULLIF(it->>'variant_id', '')::uuid, NULLIF(it->>'variant_name', ''));
        n_mov := n_mov + 1;
      END IF;
    END IF;

    INSERT INTO public.sale_items (sale_id, store_id, product_id, product_name, description, quantity, unit_price, category,
      service_type, service_specs, color, variant_id, variant_name, by_order)
    VALUES (v_sale, v_store, v_pid, COALESCE(NULLIF(it->>'product_name', ''), 'Item sem nome'), it->>'description', v_qty,
      COALESCE((it->>'unit_price')::numeric, 0), COALESCE(NULLIF(it->>'category', ''), 'Geral'), it->>'service_type',
      it->>'service_specs', it->>'color', NULLIF(it->>'variant_id', '')::uuid, NULLIF(it->>'variant_name', ''), v_by_order);
    n_items := n_items + 1;

    IF v_service AND m_production THEN
      INSERT INTO public.production_orders (store_id, sale_id, customer_name, customer_phone, customer_address, item_name, specs, quantity, date, status)
      VALUES (v_store, v_sale, v_customer, p_sale->>'customer_phone', p_sale->>'customer_address', it->>'product_name',
              COALESCE(it->>'service_specs', ''), v_qty, now(), 'PENDING')
      RETURNING id INTO v_po;
      n_po := n_po + 1;
      IF v_delivery_type = 'DELIVERY' THEN
        INSERT INTO public.deliveries (store_id, sale_id, production_order_id, customer_name, address, date, status, notes, origin)
        VALUES (v_store, v_sale, v_po, v_customer, COALESCE(NULLIF(p_sale->>'customer_address', ''), 'Endereço não informado'),
                COALESCE(v_delivery_date, v_date::date), 'PENDING',
                'Aguardando produção: ' || v_qty || 'x ' || COALESCE(it->>'product_name', 'Serviço'), 'PRODUCTION');
        n_deliv := n_deliv + 1;
      END IF;
    ELSIF NOT v_by_order THEN
      v_ready := v_ready || (v_qty || 'x ' || COALESCE(it->>'product_name', 'Item'));
    END IF;
  END LOOP;

  IF v_delivery_type = 'DELIVERY' AND cardinality(v_ready) > 0 THEN
    INSERT INTO public.deliveries (store_id, sale_id, customer_name, address, date, status, notes, origin)
    VALUES (v_store, v_sale, v_customer, COALESCE(NULLIF(p_sale->>'customer_address', ''), 'Endereço não informado'),
            COALESCE(v_delivery_date, v_date::date), 'PENDING', array_to_string(v_ready, E'\n'), 'SALES');
    n_deliv := n_deliv + 1;
  END IF;

  IF m_financial THEN
    IF v_fee > 0 THEN
      INSERT INTO public.transactions (store_id, sale_id, description, amount, type, category, date, due_date, status, payment_method)
      VALUES (v_store, v_sale, 'Taxa de Cartão Venda #' || v_short, v_fee, 'EXPENSE', 'Taxas e Impostos', v_date::date, v_date::date, 'PAID', v_pm);
      n_tx := n_tx + 1;
    END IF;
    IF v_down > 0 THEN
      INSERT INTO public.transactions (store_id, sale_id, description, amount, type, category, date, due_date, status, payment_method)
      VALUES (v_store, v_sale, 'Entrada Venda #' || v_short || ' - ' || v_customer, v_down, 'INCOME', 'Vendas', v_date::date, v_date::date, 'PAID',
              COALESCE(p_sale->>'down_payment_method', v_pm));
      n_tx := n_tx + 1;
    ELSIF v_payment_type = 'FULL' THEN
      INSERT INTO public.transactions (store_id, sale_id, description, amount, type, category, date, due_date, status, payment_method)
      VALUES (v_store, v_sale, 'Venda #' || v_short || ' - ' || v_customer, v_total, 'INCOME', 'Vendas', v_date::date, v_date::date, 'PAID', v_pm);
      n_tx := n_tx + 1;
    END IF;
    IF v_payment_type = 'PARTIAL' AND v_remaining > 0 THEN
      INSERT INTO public.transactions (store_id, sale_id, description, amount, type, category, date, due_date, status, payment_method)
      VALUES (v_store, v_sale, 'Restante Venda #' || v_short || ' - ' || v_customer, v_remaining, 'INCOME', 'Vendas', v_date::date,
              COALESCE(v_delivery_date, v_date::date),
              CASE WHEN p_sale->>'remaining_status' = 'PAID' THEN 'PAID' ELSE 'PENDING' END,
              COALESCE(p_sale->>'remaining_payment_method', v_pm));
      n_tx := n_tx + 1;
    END IF;
  END IF;

  RETURN jsonb_build_object('sale_id', v_sale, 'itens', n_items, 'encomendas', n_orders, 'ordens_producao', n_po,
                            'entregas', n_deliv, 'lancamentos', n_tx, 'movimentos_estoque', n_mov);
END $$;
REVOKE ALL ON FUNCTION public.create_sale(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(jsonb, jsonb) TO authenticated;

COMMIT;

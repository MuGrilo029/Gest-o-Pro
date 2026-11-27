-- 064: limite de desconto do vendedor por loja (D4, opção A aprovada pelo dono em 27/11).
--   * stores.seller_max_discount_percent: 0 a 100, NOT NULL, padrão 10 (NaN e Infinity ficam fora da faixa);
--   * leitura: quem é membro da loja já lê a linha de stores (stores_read);
--   * escrita: só o dono da loja ativa, por set_seller_discount_limit(p_percent); o admin da plataforma, só na loja
--     impersonada. UPDATE direto: a RLS já barra quem não é admin (stores_update) e o gatilho abaixo barra o admin
--     fora da loja ativa;
--   * create_sale (060, redefinida aqui): quem não é dono nem gerente tem o desconto limitado a
--     round(subtotal × percentual / 100, 2), com tolerância de 1 centavo.
-- Outros caminhos de desconto já fechados ao vendedor: INSERT direto em sales (059), UPDATE de sales.discount e
-- sales.total (gatilho da 059), edit_sale_items (só dono e gerente, 058). Orçamento vira venda pelo create_sale.
-- Não muda: preço unitário continua livre (preço de tabela obrigatório e teto por venda reprovados pelo dono).
-- Idempotente.

BEGIN;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS seller_max_discount_percent numeric NOT NULL DEFAULT 10
  CONSTRAINT stores_seller_max_discount_faixa
    CHECK (seller_max_discount_percent >= 0 AND seller_max_discount_percent <= 100);

CREATE OR REPLACE FUNCTION public.tg_stores_discount_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  -- Servidor (service_role, cron) não tem auth.uid().
  IF auth.uid() IS NULL OR NEW.seller_max_discount_percent IS NOT DISTINCT FROM OLD.seller_max_discount_percent THEN
    RETURN NEW;
  END IF;
  IF public.current_store_id() IS DISTINCT FROM OLD.id
     OR NOT (public.is_platform_admin() OR COALESCE(public.store_role(OLD.id) = 'OWNER', false)) THEN
    RAISE EXCEPTION 'Só o dono da loja altera o limite de desconto.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_stores_discount_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_stores_discount_guard ON public.stores;
CREATE TRIGGER tg_stores_discount_guard BEFORE UPDATE OF seller_max_discount_percent ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.tg_stores_discount_guard();

CREATE OR REPLACE FUNCTION public.set_seller_discount_limit(p_percent numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_store uuid := public.current_store_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para alterar o limite de desconto.' USING ERRCODE = '42501'; END IF;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Sem loja ativa ou acesso bloqueado.' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_platform_admin() OR COALESCE(public.store_role(v_store) = 'OWNER', false)) THEN
    RAISE EXCEPTION 'Só o dono da loja altera o limite de desconto.' USING ERRCODE = '42501';
  END IF;
  IF p_percent IS NULL OR NOT (p_percent >= 0 AND p_percent <= 100) THEN
    RAISE EXCEPTION 'O limite de desconto deve ficar entre 0 e 100.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.stores SET seller_max_discount_percent = p_percent WHERE id = v_store;
  RETURN p_percent;
END $$;
REVOKE ALL ON FUNCTION public.set_seller_discount_limit(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_seller_discount_limit(numeric) TO authenticated;

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
  v_discount numeric := COALESCE((p_sale->>'discount')::numeric, 0);
  v_subtotal numeric;
  v_calc numeric;
  v_card_amount numeric := 0;
  v_inst int := COALESCE((p_sale->>'card_installments')::int, 0);
  v_fee_pct numeric := 0;
  v_max_pct numeric;
  v_expected numeric;
  v_limit_pct numeric;
  v_max_discount numeric;
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
  -- NaN e ±Infinity: NaN é maior que tudo no Postgres e passaria pelas checagens de faixa (achado da Segurança).
  IF NOT (public._is_finite(v_total) AND public._is_finite(v_down) AND public._is_finite(v_remaining)
          AND public._is_finite(v_fee) AND public._is_finite(v_discount)) THEN
    RAISE EXCEPTION 'Valores da venda inválidos.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
              WHERE NOT public._is_finite(COALESCE((e->>'unit_price')::numeric, 0))) THEN
    RAISE EXCEPTION 'Valores dos itens inválidos.';
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

  -- 060: valores recalculados no servidor; os enviados só são aceitos se baterem (tolerância de 1 centavo).
  -- D4: limite de desconto do vendedor (064). Preço de tabela obrigatório e teto por venda: reprovados pelo dono.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE COALESCE((e->>'unit_price')::numeric, 0) < 0) THEN
    RAISE EXCEPTION 'O preço unitário não pode ser negativo.';
  END IF;
  SELECT COALESCE(sum((e->>'quantity')::int * COALESCE((e->>'unit_price')::numeric, 0)), 0) INTO v_subtotal
    FROM jsonb_array_elements(p_items) e;
  IF v_discount < 0 OR v_discount > v_subtotal + 0.005 THEN
    RAISE EXCEPTION 'O desconto deve ficar entre 0 e o subtotal (%).', round(v_subtotal, 2);
  END IF;
  -- Quem não é dono nem gerente (admin da plataforma passa) fica no limite da loja, sobre o subtotal dos itens.
  IF v_discount > 0 AND NOT public.is_store_manager(v_store) THEN
    SELECT st.seller_max_discount_percent INTO v_limit_pct FROM public.stores st WHERE st.id = v_store;
    v_max_discount := round(v_subtotal * v_limit_pct / 100, 2);
    IF v_discount > v_max_discount + 0.01 THEN
      RAISE EXCEPTION 'Desconto acima do limite do vendedor (% por cento): máximo %. Peça ao gerente ou ao dono.',
        trim_scale(v_limit_pct), v_max_discount USING ERRCODE = '42501';
    END IF;
  END IF;
  v_calc := round(v_subtotal - v_discount, 2);
  IF p_sale ? 'total' AND abs(v_total - v_calc) > 0.01 THEN
    RAISE EXCEPTION 'O total da venda não confere com os itens (calculado: %).', v_calc;
  END IF;
  v_total := v_calc;

  IF v_payment_type NOT IN ('FULL', 'PARTIAL') THEN RAISE EXCEPTION 'Tipo de pagamento inválido.'; END IF;
  IF v_payment_type = 'FULL' THEN
    -- À vista: a entrada é 0 (desktop) ou o total (celular); não há restante.
    IF v_down > 0.005 AND abs(v_down - v_total) > 0.01 THEN
      RAISE EXCEPTION 'A entrada deve ficar entre 0 e o total.';
    END IF;
    v_down := CASE WHEN v_down > 0.005 THEN v_total ELSE 0 END;
    v_remaining := 0;
    v_card_amount := CASE WHEN public._is_card_method(v_pm) THEN v_total ELSE 0 END;
  ELSE
    IF v_down < 0 OR v_down > v_total + 0.005 THEN RAISE EXCEPTION 'A entrada deve ficar entre 0 e o total.'; END IF;
    v_down := LEAST(round(v_down, 2), v_total);
    IF p_sale ? 'remaining_amount' AND abs(v_remaining - (v_total - v_down)) > 0.01 THEN
      RAISE EXCEPTION 'O restante deve ser o total menos a entrada (%).', v_total - v_down;
    END IF;
    v_remaining := v_total - v_down;
    v_card_amount := CASE WHEN public._is_card_method(p_sale->>'down_payment_method') THEN v_down ELSE 0 END
                   + CASE WHEN public._is_card_method(p_sale->>'remaining_payment_method') THEN v_remaining ELSE 0 END;
  END IF;

  IF v_fee < 0 OR v_fee > v_total + 0.005 THEN RAISE EXCEPTION 'A taxa de cartão deve ficar entre 0 e o total.'; END IF;
  IF v_fee > 0.005 AND v_card_amount = 0 THEN RAISE EXCEPTION 'Taxa de cartão só em pagamento com cartão.'; END IF;
  IF v_card_amount > 0 AND EXISTS (SELECT 1 FROM public.card_fees cf WHERE cf.store_id = v_store) THEN
    IF v_payment_type = 'FULL' THEN
      -- Mesma regra do PDV: débito usa a linha de 0 parcelas; sem linha para o parcelamento, taxa 0.
      IF public._is_debit_method(v_pm) THEN v_inst := 0; END IF;
      SELECT cf.percentage INTO v_fee_pct FROM public.card_fees cf
       WHERE cf.store_id = v_store AND cf.installments = v_inst ORDER BY cf.created_at DESC LIMIT 1;
      v_fee_pct := COALESCE(v_fee_pct, 0);
      v_expected := round(v_total * v_fee_pct / 100, 2);
      IF abs(v_fee - v_expected) > 0.01 THEN
        RAISE EXCEPTION 'A taxa de cartão não confere com a taxa da loja (esperado: %).', v_expected;
      END IF;
      v_fee := v_expected;
    ELSE
      -- Pagamento dividido: o PDV não envia as parcelas da entrada; limite pela maior taxa da loja.
      SELECT max(cf.percentage) INTO v_max_pct FROM public.card_fees cf WHERE cf.store_id = v_store;
      IF v_fee > round(v_card_amount * v_max_pct / 100, 2) + 0.01 THEN
        RAISE EXCEPTION 'A taxa de cartão passa da taxa configurada da loja.';
      END IF;
      v_fee := round(v_fee, 2);
    END IF;
  ELSE
    -- Sem pagamento em cartão (já recusado acima se taxa > 0) ou loja sem card_fees: taxa só 0 (decisão do SeniorDev).
    IF v_fee > 0.005 THEN
      RAISE EXCEPTION 'Loja sem taxa de cartão cadastrada: a taxa da venda deve ser 0.';
    END IF;
    v_fee := 0;
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
    v_total, v_discount, v_pm, p_sale->>'down_payment_method', p_sale->>'remaining_payment_method',
    v_payment_type, v_down, v_remaining, COALESCE(p_sale->>'remaining_status', 'PAID'), COALESCE(p_sale->>'status', 'COMPLETED'),
    p_sale->>'observations', v_delivery_date, v_fee, v_fee_pct,
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

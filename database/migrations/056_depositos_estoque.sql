-- 056: estoque com depósitos separados (decisão 20a): depósito × loja, saldo por local e transferência.
-- Modelo compatível com o que já existe, sem backfill nem alteração de dados:
--   * products.quantity continua sendo o TOTAL da loja (vendas, edição e telas atuais seguem iguais);
--   * cada loja tem um depósito padrão (a própria loja), criado na primeira chamada de ensure_default_warehouse;
--   * stock_balances guarda o saldo só dos depósitos extras; o saldo da loja (padrão) = total − soma dos extras;
--   * transferência move entre locais sem mudar o total; vendas saem sempre do depósito padrão.
-- Sem variantes por depósito nesta versão (variante continua só no total). CMV não muda (bloqueado pelo dono).
-- Criar/renomear depósito e transferir: dono ou gerente. Ler: membros da loja. Idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL DEFAULT public.current_store_id() REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_one_default ON public.warehouses (store_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS public.stock_balances (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, product_id)
);

ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS to_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL;

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouses, public.stock_balances FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.warehouses, public.stock_balances FROM authenticated;
GRANT SELECT ON public.warehouses, public.stock_balances TO authenticated;

DROP POLICY IF EXISTS warehouses_select ON public.warehouses;
CREATE POLICY warehouses_select ON public.warehouses FOR SELECT TO authenticated
  USING (store_id = (SELECT public.current_store_id()));
DROP POLICY IF EXISTS stock_balances_select ON public.stock_balances;
CREATE POLICY stock_balances_select ON public.stock_balances FOR SELECT TO authenticated
  USING (store_id = (SELECT public.current_store_id()));

-- Depósito padrão da loja ativa (cria se faltar).
CREATE OR REPLACE FUNCTION public.ensure_default_warehouse()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_store uuid := public.current_store_id();
  v_id uuid;
BEGIN
  IF v_store IS NULL THEN RAISE EXCEPTION 'Sem loja ativa ou acesso bloqueado.' USING ERRCODE = '42501'; END IF;
  SELECT w.id INTO v_id FROM public.warehouses w WHERE w.store_id = v_store AND w.is_default;
  IF v_id IS NULL THEN
    INSERT INTO public.warehouses (store_id, name, is_default) VALUES (v_store, 'Loja', true)
    ON CONFLICT (store_id, name) DO UPDATE SET is_default = true
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- Cria ou renomeia/ativa/desativa um depósito extra.
CREATE OR REPLACE FUNCTION public.upsert_warehouse(p_name text, p_id uuid DEFAULT NULL, p_active boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_store uuid := public.current_store_id();
  v_id uuid;
BEGIN
  IF v_store IS NULL OR NOT public.is_store_manager(v_store) THEN
    RAISE EXCEPTION 'Apenas dono ou gerente gerencia depósitos.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.ensure_default_warehouse();
  IF p_id IS NULL THEN
    INSERT INTO public.warehouses (store_id, name, active) VALUES (v_store, btrim(p_name), COALESCE(p_active, true)) RETURNING id INTO v_id;
  ELSE
    UPDATE public.warehouses SET name = btrim(p_name), active = CASE WHEN is_default THEN true ELSE COALESCE(p_active, true) END
     WHERE id = p_id AND store_id = v_store RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Depósito não encontrado.'; END IF;
    IF NOT COALESCE(p_active, true) AND EXISTS (SELECT 1 FROM public.stock_balances b WHERE b.warehouse_id = v_id AND b.quantity > 0) THEN
      RAISE EXCEPTION 'Depósito com saldo não pode ser desativado: transfira o estoque antes.';
    END IF;
  END IF;
  RETURN v_id;
END $$;

-- Saldo por local de um produto (ou de todos, com p_product NULL) na loja ativa.
CREATE OR REPLACE FUNCTION public.stock_by_location(p_product uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid, warehouse_id uuid, warehouse_name text, is_default boolean, quantity integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_store uuid := public.current_store_id();
BEGIN
  IF v_store IS NULL THEN RAISE EXCEPTION 'Sem loja ativa ou acesso bloqueado.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT p.id, w.id, w.name, w.is_default,
           CASE WHEN w.is_default
                THEN COALESCE(p.quantity, 0) - COALESCE((SELECT sum(b.quantity)::int FROM public.stock_balances b
                                                          JOIN public.warehouses x ON x.id = b.warehouse_id AND NOT x.is_default
                                                         WHERE b.product_id = p.id), 0)
                ELSE COALESCE((SELECT b.quantity FROM public.stock_balances b WHERE b.product_id = p.id AND b.warehouse_id = w.id), 0)
           END
      FROM public.products p
      JOIN public.warehouses w ON w.store_id = p.store_id AND w.active
     WHERE p.store_id = v_store AND (p_product IS NULL OR p.id = p_product)
     ORDER BY p.id, w.is_default DESC, w.name;
END $$;

-- Transferência entre locais da mesma loja. Não muda o total (products.quantity).
CREATE OR REPLACE FUNCTION public.stock_transfer(p_product uuid, p_from uuid, p_to uuid, p_quantity integer, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_store uuid := public.current_store_id();
  w_from public.warehouses%ROWTYPE;
  w_to public.warehouses%ROWTYPE;
  v_name text;
  v_avail integer;
BEGIN
  IF v_store IS NULL OR NOT public.is_store_manager(v_store) THEN
    RAISE EXCEPTION 'Apenas dono ou gerente transfere estoque.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_quantity, 0) <= 0 THEN RAISE EXCEPTION 'Informe uma quantidade maior que zero.'; END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'Origem e destino são o mesmo depósito.'; END IF;
  SELECT * INTO w_from FROM public.warehouses WHERE id = p_from AND store_id = v_store AND active;
  SELECT * INTO w_to FROM public.warehouses WHERE id = p_to AND store_id = v_store AND active;
  IF w_from.id IS NULL OR w_to.id IS NULL THEN RAISE EXCEPTION 'Depósito não encontrado nesta loja.'; END IF;
  SELECT p.name INTO v_name FROM public.products p WHERE p.id = p_product AND p.store_id = v_store FOR UPDATE;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Produto não pertence a esta loja.'; END IF;

  SELECT s.quantity INTO v_avail FROM public.stock_by_location(p_product) s WHERE s.warehouse_id = p_from;
  IF COALESCE(v_avail, 0) < p_quantity THEN
    RAISE EXCEPTION 'Saldo insuficiente em %: disponível %, pedido %.', w_from.name, COALESCE(v_avail, 0), p_quantity;
  END IF;

  IF NOT w_from.is_default THEN
    UPDATE public.stock_balances SET quantity = quantity - p_quantity, updated_at = now()
     WHERE warehouse_id = p_from AND product_id = p_product;
  END IF;
  IF NOT w_to.is_default THEN
    INSERT INTO public.stock_balances (store_id, warehouse_id, product_id, quantity) VALUES (v_store, p_to, p_product, p_quantity)
    ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = public.stock_balances.quantity + EXCLUDED.quantity, updated_at = now();
  END IF;

  INSERT INTO public.stock_movements (store_id, product_id, product_name, quantity, type, date, observations, user_id, warehouse_id, to_warehouse_id)
  VALUES (v_store, p_product, v_name, p_quantity, 'TRANSFER', now(),
          COALESCE(NULLIF(btrim(p_note), ''), 'Transferência ' || w_from.name || ' → ' || w_to.name), auth.uid(), p_from, p_to);

  RETURN jsonb_build_object('product_id', p_product, 'from', p_from, 'to', p_to, 'quantity', p_quantity);
END $$;

-- Saída do total (venda, ajuste) nunca pode deixar o depósito padrão negativo por causa de saldo nos extras:
-- se o total ficar abaixo da soma dos extras, a operação é recusada.
CREATE OR REPLACE FUNCTION public._stock_total_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_extra integer;
BEGIN
  IF COALESCE(NEW.quantity, 0) >= COALESCE(OLD.quantity, 0) THEN RETURN NEW; END IF;
  SELECT COALESCE(sum(b.quantity), 0)::int INTO v_extra FROM public.stock_balances b
    JOIN public.warehouses w ON w.id = b.warehouse_id AND NOT w.is_default
   WHERE b.product_id = NEW.id;
  IF v_extra > 0 AND COALESCE(NEW.quantity, 0) < v_extra THEN
    RAISE EXCEPTION 'ESTOQUE_DEPOSITO: % unidade(s) de % estão em outros depósitos; transfira para a loja antes da saída.', v_extra, NEW.name
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS products_stock_total_guard ON public.products;
CREATE TRIGGER products_stock_total_guard BEFORE UPDATE OF quantity ON public.products
  FOR EACH ROW EXECUTE FUNCTION public._stock_total_guard();

REVOKE ALL ON FUNCTION public.ensure_default_warehouse() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_warehouse(text, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_by_location(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_transfer(uuid, uuid, uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._stock_total_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_default_warehouse() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_warehouse(text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_by_location(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_transfer(uuid, uuid, uuid, integer, text) TO authenticated;

COMMIT;

-- 059: venda e lançamentos do vendedor só pelo servidor (A13; corrige a 057, reprovada pela Segurança).
-- Achados no PGlite contra a 057:
--   * INSERT de várias linhas (bulk do PostgREST) e duas requisições simultâneas passavam do limite, porque
--     _seller_sale_tx_ok é STABLE e não vê as linhas do mesmo comando nem as de outra transação;
--   * sales_update deixava o vendedor mudar total e card_fee_amount da própria venda, anulando o limite.
-- Decisão do SeniorDev:
--   * transactions: INSERT direto só dono e gerente. Receita e taxa da venda do vendedor vêm só do create_sale (055,
--     SECURITY DEFINER). O vendedor não tem outro fluxo que grave em transactions (o financeiro é de dono/gerente).
--   * _seller_sale_tx_ok: nenhuma policy chama mais; a função é apagada (fecha o oráculo de leitura).
--   * sales: INSERT direto só dono e gerente (o vendedor vende pelo create_sale). No UPDATE, o vendedor não muda
--     valores, dono (created_by) nem loja da venda: trigger BEFORE UPDATE.
--   * sale_items: leitura igual; escrita direta só dono e gerente (create_sale e edit_sale_items gravam no servidor).
-- Requer o front com addSale → create_sale antes de aplicar em produção; sem isso, o vendedor não consegue vender.
-- Idempotente.

BEGIN;

-- 1. Lançamentos: só dono e gerente inserem direto.
DROP POLICY IF EXISTS transactions_insert ON public.transactions;
CREATE POLICY transactions_insert ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id));

DROP FUNCTION IF EXISTS public._seller_sale_tx_ok(uuid, uuid, text, text, numeric);

-- 2. Vendas: INSERT direto só dono e gerente.
DROP POLICY IF EXISTS sales_insert ON public.sales;
CREATE POLICY sales_insert ON public.sales
  FOR INSERT TO authenticated
  WITH CHECK (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id));

-- 3. Vendas: o vendedor não altera valores, dono nem loja da venda.
CREATE OR REPLACE FUNCTION public.tg_sales_seller_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  -- Servidor (service_role, cron) não tem auth.uid(); dono, gerente e admin da plataforma passam.
  IF auth.uid() IS NULL OR public.is_store_manager(OLD.store_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.total IS DISTINCT FROM OLD.total
     OR NEW.discount IS DISTINCT FROM OLD.discount
     OR NEW.card_fee_amount IS DISTINCT FROM OLD.card_fee_amount
     OR NEW.card_fee_percentage IS DISTINCT FROM OLD.card_fee_percentage
     OR NEW.card_installments IS DISTINCT FROM OLD.card_installments
     OR NEW.down_payment IS DISTINCT FROM OLD.down_payment
     OR NEW.remaining_amount IS DISTINCT FROM OLD.remaining_amount
     OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'Só o dono ou o gerente altera valores da venda.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_sales_seller_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_sales_seller_guard ON public.sales;
CREATE TRIGGER tg_sales_seller_guard BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.tg_sales_seller_guard();

-- 4. Itens da venda: leitura como antes; escrita direta só dono e gerente.
DROP POLICY IF EXISTS sale_items_access ON public.sale_items;
DROP POLICY IF EXISTS sale_items_read ON public.sale_items;
DROP POLICY IF EXISTS sale_items_write ON public.sale_items;
CREATE POLICY sale_items_read ON public.sale_items FOR SELECT TO authenticated
  USING (store_id = (SELECT public.current_store_id())
         AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id));
CREATE POLICY sale_items_write ON public.sale_items FOR ALL TO authenticated
  USING (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id)
         AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id))
  WITH CHECK (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id)
         AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id));

COMMIT;

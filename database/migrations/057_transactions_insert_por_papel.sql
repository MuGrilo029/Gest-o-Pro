-- 057: lançamento financeiro por papel (era a 028, nunca aplicada; risco A10 em docs/riscos-seguranca.md).
-- Dono e gerente: inserem qualquer lançamento da loja (transactions_manage continua igual).
-- Vendedor: só o que a própria venda gera, ligado a uma venda da loja (sale_id):
--   * receita da venda (INCOME, categoria 'Vendas');
--   * taxa de cartão da venda (EXPENSE, 'Taxas e Impostos'), exceção explícita: só com valor igual ao
--     card_fee_amount gravado na venda e só em venda criada por ele. Resolve a pendência da 028 sem mudar o app.
-- A venda pelo create_sale (055, SECURITY DEFINER) grava os mesmos lançamentos no servidor.
-- Update e delete continuam só com dono e gerente. Idempotente.

BEGIN;

DROP POLICY IF EXISTS transactions_insert ON public.transactions;
CREATE POLICY transactions_insert ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = (SELECT public.current_store_id())
    AND (
      public.is_store_manager(store_id)
      OR (
        type = 'INCOME' AND category = 'Vendas' AND sale_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = transactions.sale_id AND s.store_id = transactions.store_id)
      )
      OR (
        type = 'EXPENSE' AND category = 'Taxas e Impostos' AND sale_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.sales s
                     WHERE s.id = transactions.sale_id AND s.store_id = transactions.store_id
                       AND s.created_by = (SELECT auth.uid())
                       AND COALESCE(s.card_fee_amount, 0) > 0 AND s.card_fee_amount = transactions.amount)
      )
    )
  );

COMMIT;

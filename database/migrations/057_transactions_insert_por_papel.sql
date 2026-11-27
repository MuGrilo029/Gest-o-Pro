-- 057: lançamento financeiro por papel (era a 028, nunca aplicada; risco A10 em docs/riscos-seguranca.md).
-- Dono e gerente: inserem qualquer lançamento da loja (transactions_manage continua igual).
-- Vendedor: só o que a própria venda gera, ligado a uma venda dele na loja ativa (sale_id):
--   * receita da venda (INCOME, 'Vendas'), desde que a soma das receitas da venda, com a nova, não passe de sales.total;
--   * taxa de cartão (EXPENSE, 'Taxas e Impostos'), exceção explícita: valor igual a sales.card_fee_amount e
--     no máximo uma taxa por venda.
-- O vendedor não lê transactions (SELECT só dono/gerente), por isso a checagem de soma e duplicidade fica numa
-- função SECURITY DEFINER de leitura (_seller_sale_tx_ok). A venda pelo create_sale (055) grava no servidor.
-- Update e delete continuam só com dono e gerente. Idempotente.

BEGIN;

CREATE OR REPLACE FUNCTION public._seller_sale_tx_ok(p_sale uuid, p_store uuid, p_type text, p_category text, p_amount numeric)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  s record;
BEGIN
  IF p_sale IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN RETURN false; END IF;
  SELECT sa.total, sa.card_fee_amount, sa.created_by INTO s
    FROM public.sales sa WHERE sa.id = p_sale AND sa.store_id = p_store;
  IF NOT FOUND OR s.created_by IS DISTINCT FROM auth.uid() THEN RETURN false; END IF;

  IF p_type = 'INCOME' AND p_category = 'Vendas' THEN
    RETURN COALESCE((SELECT sum(t.amount) FROM public.transactions t
                      WHERE t.sale_id = p_sale AND t.type = 'INCOME'), 0) + p_amount <= COALESCE(s.total, 0);
  END IF;

  IF p_type = 'EXPENSE' AND p_category = 'Taxas e Impostos' THEN
    RETURN COALESCE(s.card_fee_amount, 0) > 0 AND p_amount = s.card_fee_amount
       AND NOT EXISTS (SELECT 1 FROM public.transactions t
                        WHERE t.sale_id = p_sale AND t.type = 'EXPENSE' AND t.category = 'Taxas e Impostos');
  END IF;

  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public._seller_sale_tx_ok(uuid, uuid, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._seller_sale_tx_ok(uuid, uuid, text, text, numeric) TO authenticated;

DROP POLICY IF EXISTS transactions_insert ON public.transactions;
CREATE POLICY transactions_insert ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = (SELECT public.current_store_id())
    AND (
      public.is_store_manager(store_id)
      OR public._seller_sale_tx_ok(sale_id, store_id, type, category, amount)
    )
  );

COMMIT;

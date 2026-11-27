-- 061: defesa extra contra NaN e ±Infinity nos valores da venda e do financeiro (achado da Segurança na 060).
-- NaN é maior que qualquer número no Postgres: uma linha assim deixa a SUM do financeiro da loja em NaN.
-- CHECK NOT VALID: vale para toda linha nova ou alterada e não lê nem mexe nos dados existentes.
-- Em produção, a leitura de 27/11 não achou linhas não finitas; dá para rodar VALIDATE CONSTRAINT depois.
-- Idempotente.

BEGIN;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('sales', 'total'), ('sales', 'discount'), ('sales', 'card_fee_amount'),
      ('sales', 'down_payment'), ('sales', 'remaining_amount'),
      ('sale_items', 'unit_price'), ('transactions', 'amount')
    ) AS v(tbl, col)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = format('public.%I', c.tbl)::regclass
                      AND conname = format('%s_%s_finito', c.tbl, c.col)) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IS NULL OR (%I > ''-Infinity''::numeric AND %I < ''Infinity''::numeric)) NOT VALID',
        c.tbl, format('%s_%s_finito', c.tbl, c.col), c.col, c.col, c.col);
    END IF;
  END LOOP;
END $$;

COMMIT;

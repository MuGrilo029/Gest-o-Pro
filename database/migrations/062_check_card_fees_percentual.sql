-- 062: porcentagem da taxa de cartão entre 0 e 100 (baixo da Segurança na revisão da 060/061).
-- Um percentage NaN ou fora da faixa, gravado pelo dono ou gerente, fazia toda venda com cartão daquela loja
-- ser recusada pelo create_sale (060). CHECK NOT VALID: vale para linhas novas e alteradas e não lê os dados
-- existentes. Na leitura de produção de 27/11, card_fees não tinha nenhuma linha.
-- Idempotente.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.card_fees'::regclass AND conname = 'card_fees_percentage_faixa') THEN
    ALTER TABLE public.card_fees ADD CONSTRAINT card_fees_percentage_faixa
      CHECK (percentage >= 0 AND percentage <= 100) NOT VALID;  -- NaN > 100 no Postgres: recusado
  END IF;
END $$;

COMMIT;

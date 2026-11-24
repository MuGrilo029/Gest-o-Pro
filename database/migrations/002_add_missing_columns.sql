-- 002_add_missing_columns.sql
-- Colunas que o código (store.tsx) grava, mas que não existem no banco
-- criado a partir do MASTER_SCHEMA.sql. Sem elas, salvar uma venda falha com
-- "Could not find the 'card_fee_amount' column of 'sales' in the schema cache".
-- Seguro para rodar mais de uma vez: só adiciona o que estiver faltando.

-- Vendas: data de entrega e taxa de cartão
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS delivery_date DATE;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS card_fee_amount NUMERIC DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS card_fee_percentage NUMERIC DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS card_installments INTEGER DEFAULT 0;

-- Itens da venda: descrição do produto
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS description TEXT;

-- Lançamentos financeiros: forma de pagamento e venda de origem
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL;

-- Categorias: marca categorias de custo de mercadoria (CMV)
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS is_cmv BOOLEAN DEFAULT false;

-- Atualiza o cache de schema do PostgREST para a API enxergar as colunas novas
NOTIFY pgrst, 'reload schema';

-- 010: campos para Cotações (status, venda gerada) e Produção personalizada
-- Aditiva: somente ADD COLUMN IF NOT EXISTS. Sem DROP, sem ALTER de tipo.
-- Idempotente: pode ser reexecutada.

-- Cotações
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'rascunho';
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS converted_sale_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotes_status_check' AND conrelid = 'public.quotes'::regclass
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_status_check
      CHECK (status IN ('rascunho', 'enviado', 'aprovado', 'recusado'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotes_converted_sale_fk' AND conrelid = 'public.quotes'::regclass
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_converted_sale_fk
      FOREIGN KEY (converted_sale_id) REFERENCES public.sales(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Produção personalizada
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS deadline date NULL;
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS total_value numeric NULL;
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS down_payment numeric NOT NULL DEFAULT 0;
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS attachments text[] NOT NULL DEFAULT '{}';

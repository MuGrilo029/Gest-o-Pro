-- 047b: registro de objetos que já existem em produção e não tinham migração no repositório.
-- Conferido em produção (só leitura, 27/11/2026): tabelas card_fees e simulations, com as políticas abaixo.
-- Idempotente e sem efeito em produção (IF NOT EXISTS; políticas recriadas com o mesmo texto).
-- Serve para o banco local de teste (PGlite) ficar igual a produção.

CREATE TABLE IF NOT EXISTS public.card_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installments integer NOT NULL,
  percentage numeric NOT NULL,
  created_at timestamptz DEFAULT now(),
  store_id uuid NOT NULL DEFAULT public.current_store_id() REFERENCES public.stores(id) ON DELETE CASCADE
);
ALTER TABLE public.card_fees ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description text,
  amount numeric NOT NULL DEFAULT 0,
  due_date date NOT NULL,
  group_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  store_id uuid NOT NULL DEFAULT public.current_store_id() REFERENCES public.stores(id) ON DELETE CASCADE
);
ALTER TABLE public.simulations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'card_fees' AND policyname = 'store_isolation') THEN
    CREATE POLICY store_isolation ON public.card_fees FOR ALL TO authenticated
      USING (store_id = (SELECT public.current_store_id()))
      WITH CHECK (store_id = (SELECT public.current_store_id()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'simulations' AND policyname = 'simulations_insert') THEN
    CREATE POLICY simulations_insert ON public.simulations FOR INSERT TO authenticated
      WITH CHECK (store_id = (SELECT public.current_store_id()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'simulations' AND policyname = 'simulations_manage') THEN
    CREATE POLICY simulations_manage ON public.simulations FOR ALL TO authenticated
      USING (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id))
      WITH CHECK (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id));
  END IF;
END $$;

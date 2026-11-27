-- 053: RLS por papel, reproduzindo o que o front já restringe hoje (sem decisão nova; matriz do Produto pendente).
-- Antes: products, customers, suppliers, orders, deliveries, production_orders, stock_movements, categories,
-- category_groups e card_fees tinham só "store_isolation" FOR ALL (vendedor apagava tudo).
-- Depois: ler, criar e editar continuam por loja; EXCLUIR só dono/gerente (is_store_manager, que inclui o admin
-- da plataforma). card_fees e categories são configuração: criar, editar e excluir só dono/gerente (risco A9).
-- Anexos de produção (bucket producao-anexos): excluir só dono/gerente.
-- Lançamento financeiro por papel (a antiga 028) está na 057.
-- Idempotente.

BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'customers', 'suppliers', 'orders', 'deliveries', 'production_orders',
                           'stock_movements', 'categories', 'category_groups', 'card_fees'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS store_isolation ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (store_id = (SELECT public.current_store_id()))',
                   t || '_select', t);
    IF t IN ('card_fees', 'categories') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id))', t || '_insert', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id)) WITH CHECK (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id))', t || '_update', t);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (store_id = (SELECT public.current_store_id()))', t || '_insert', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (store_id = (SELECT public.current_store_id())) WITH CHECK (store_id = (SELECT public.current_store_id()))', t || '_update', t);
    END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id))', t || '_delete', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS producao_anexos_delete ON storage.objects;
CREATE POLICY producao_anexos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'producao-anexos'
         AND (storage.foldername(name))[1] = (SELECT public.current_store_id())::text
         AND public.is_store_manager(public.current_store_id()));

COMMIT;

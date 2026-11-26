-- 019: escrita do bucket 'products' restrita por loja, sem quebrar uploads existentes
-- Estado atual (verificado): bucket com 0 objetos; uploads do app gravam em caminhos SEM pasta de loja
-- (ex.: 'producao-personalizada/<uuid>-<nome>'), então INSERT não pode exigir prefixo de loja agora.
-- Regras:
--  - INSERT: liberado para authenticated, exceto se o primeiro segmento do caminho for o id de OUTRA loja.
--  - UPDATE / DELETE: só em objetos cujo dono (owner_id) é membro da loja ativa (ou platform admin).
--  - SELECT: mantido público (Public Read), como hoje.
-- Não altera dados. Só troca as políticas de storage.objects do bucket 'products'.

DROP POLICY IF EXISTS "Auth Insert" ON storage.objects;
DROP POLICY IF EXISTS "Auth Update" ON storage.objects;
DROP POLICY IF EXISTS "Auth Delete" ON storage.objects;

-- Verifica se o primeiro segmento do caminho é o id de OUTRA loja.
-- SECURITY DEFINER: a tabela stores tem RLS, e o usuário não enxerga as outras lojas.
CREATE OR REPLACE FUNCTION public.storage_prefix_is_other_store(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $f$
  SELECT EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id::text = split_part(p_path, '/', 1)
      AND s.id IS DISTINCT FROM public.current_store_id()
  );
$f$;
REVOKE ALL ON FUNCTION public.storage_prefix_is_other_store(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_prefix_is_other_store(text) TO authenticated;

CREATE POLICY products_insert_loja ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'products'
    AND NOT public.storage_prefix_is_other_store(name)
  );

CREATE POLICY products_update_loja ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'products'
    AND (
      public.is_platform_admin()
      OR EXISTS (
        SELECT 1 FROM public.store_members m
        WHERE m.store_id = public.current_store_id() AND m.user_id::text = storage.objects.owner_id
      )
    )
  )
  WITH CHECK (bucket_id = 'products');

CREATE POLICY products_delete_loja ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'products'
    AND (
      public.is_platform_admin()
      OR EXISTS (
        SELECT 1 FROM public.store_members m
        WHERE m.store_id = public.current_store_id() AND m.user_id::text = storage.objects.owner_id
      )
    )
  );

-- 011: bucket privado para anexos de Produção sob medida (fotos de clientes)
-- Aditiva: cria bucket novo e políticas próprias. Não altera o bucket 'products'
-- nem as políticas de storage.objects usadas por outras telas.
-- Caminho obrigatório: <store_id>/<arquivo>. Só usuários autenticados da loja
-- cujo store_id (primeiro segmento) for current_store_id() acessam.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'producao-anexos',
  'producao-anexos',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS producao_anexos_select ON storage.objects;
DROP POLICY IF EXISTS producao_anexos_insert ON storage.objects;
DROP POLICY IF EXISTS producao_anexos_update ON storage.objects;
DROP POLICY IF EXISTS producao_anexos_delete ON storage.objects;

CREATE POLICY producao_anexos_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'producao-anexos'
    AND (storage.foldername(name))[1] = public.current_store_id()::text
  );

CREATE POLICY producao_anexos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'producao-anexos'
    AND (storage.foldername(name))[1] = public.current_store_id()::text
  );

CREATE POLICY producao_anexos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'producao-anexos'
    AND (storage.foldername(name))[1] = public.current_store_id()::text
  )
  WITH CHECK (
    bucket_id = 'producao-anexos'
    AND (storage.foldername(name))[1] = public.current_store_id()::text
  );

CREATE POLICY producao_anexos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'producao-anexos'
    AND (storage.foldername(name))[1] = public.current_store_id()::text
  );

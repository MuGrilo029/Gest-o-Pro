-- 068: bucket privado "boletos" (decisão do SeniorDev: consertar o anexo de boletos; o bucket não existia).
--   * privado; no máximo 10 MB; só PDF e imagem (sem SVG, que executa script);
--   * caminho sempre {store_id}/arquivo, na loja ativa;
--   * ler, enviar, trocar e excluir: dono ou gerente da loja ativa, com os módulos financial E boletos ligados.
--     O admin da plataforma segue o mesmo padrão: só a loja impersonada (current_store_id);
--   * o app grava o caminho em transactions.attachment_url e abre por URL assinada (não há URL pública).
-- Com o módulo desligado (downgrade), os arquivos continuam guardados e ficam sem acesso até religar.
-- A exclusão de loja (066 e manage-users) também apaga este bucket. Limite e tipos são aplicados pela Storage API.
-- Idempotente.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('boletos', 'boletos', false, 10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Quem pode mexer nos boletos da loja ativa. SECURITY DEFINER porque _store_module_on é interna.
CREATE OR REPLACE FUNCTION public.can_access_boletos()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE((
    SELECT public.is_store_manager(s.id)
           AND public._store_module_on(s.id, 'financial')
           AND public._store_module_on(s.id, 'boletos')
      FROM (SELECT public.current_store_id() AS id) s
     WHERE s.id IS NOT NULL), false)
$$;
REVOKE ALL ON FUNCTION public.can_access_boletos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_boletos() TO authenticated;

DROP POLICY IF EXISTS boletos_select ON storage.objects;
DROP POLICY IF EXISTS boletos_insert ON storage.objects;
DROP POLICY IF EXISTS boletos_update ON storage.objects;
DROP POLICY IF EXISTS boletos_delete ON storage.objects;

CREATE POLICY boletos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'boletos' AND (storage.foldername(name))[1] = (SELECT public.current_store_id())::text
         AND (SELECT public.can_access_boletos()));
CREATE POLICY boletos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'boletos' AND (storage.foldername(name))[1] = (SELECT public.current_store_id())::text
         AND (SELECT public.can_access_boletos()));
CREATE POLICY boletos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'boletos' AND (storage.foldername(name))[1] = (SELECT public.current_store_id())::text
         AND (SELECT public.can_access_boletos()))
  WITH CHECK (bucket_id = 'boletos' AND (storage.foldername(name))[1] = (SELECT public.current_store_id())::text
         AND (SELECT public.can_access_boletos()));
CREATE POLICY boletos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'boletos' AND (storage.foldername(name))[1] = (SELECT public.current_store_id())::text
         AND (SELECT public.can_access_boletos()));

COMMIT;

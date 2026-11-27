-- 051: imagens de produto por loja (bucket products) e aceite dos Termos.
-- Decisões do dono: 46a (cada loja vê só as suas imagens), 46b pendente (público × link temporário), 47 (aceite no banco).
-- Storage: leitura e escrita só no caminho {store_id}/... da loja ativa. Funciona nos dois modos da 46b:
--   * bucket público (hoje): a URL pública não passa pelo RLS; listagem, upload, troca e exclusão passam;
--   * link temporário (createSignedUrl): precisa do SELECT, que esta política já limita à pasta da loja.
-- A troca de público para privado (storage.buckets.public) NÃO é feita aqui: depende do dono.
-- Em produção não há objetos no bucket products (conferido em 27/11/2026, só leitura).

BEGIN;

DROP POLICY IF EXISTS "Public Read" ON storage.objects;
DROP POLICY IF EXISTS products_select_loja ON storage.objects;
DROP POLICY IF EXISTS products_insert_loja ON storage.objects;
DROP POLICY IF EXISTS products_update_loja ON storage.objects;
DROP POLICY IF EXISTS products_delete_loja ON storage.objects;

CREATE POLICY products_select_loja ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'products' AND (storage.foldername(name))[1] = (SELECT public.current_store_id())::text);

CREATE POLICY products_insert_loja ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'products' AND (storage.foldername(name))[1] = (SELECT public.current_store_id())::text);

-- USING e WITH CHECK: não dá para mover um objeto para a pasta de outra loja nem para fora de pasta.
CREATE POLICY products_update_loja ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'products' AND (storage.foldername(name))[1] = (SELECT public.current_store_id())::text)
  WITH CHECK (bucket_id = 'products' AND (storage.foldername(name))[1] = (SELECT public.current_store_id())::text);

CREATE POLICY products_delete_loja ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'products' AND (storage.foldername(name))[1] = (SELECT public.current_store_id())::text);

-- Aceite dos Termos: usuário, loja, versão e data. Uma linha por usuário e versão.
CREATE TABLE IF NOT EXISTS public.terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  version text NOT NULL CHECK (length(btrim(version)) BETWEEN 1 AND 50),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version)
);
ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.terms_acceptances FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.terms_acceptances FROM authenticated;
GRANT SELECT ON public.terms_acceptances TO authenticated;

DROP POLICY IF EXISTS terms_acceptances_read ON public.terms_acceptances;
CREATE POLICY terms_acceptances_read ON public.terms_acceptances FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_platform_admin()));

-- Registro pelo próprio usuário logado. Idempotente: a mesma versão aceita de novo não duplica.
CREATE OR REPLACE FUNCTION public.record_terms_acceptance(p_version text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_version text := btrim(COALESCE(p_version, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login para aceitar os Termos.' USING ERRCODE = '42501'; END IF;
  IF length(v_version) < 1 OR length(v_version) > 50 THEN RAISE EXCEPTION 'Versão dos Termos inválida.'; END IF;
  INSERT INTO public.terms_acceptances (user_id, store_id, version)
  VALUES (v_uid, public.current_store_id(), v_version)
  ON CONFLICT (user_id, version) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.record_terms_acceptance(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_terms_acceptance(text) TO authenticated;

COMMIT;

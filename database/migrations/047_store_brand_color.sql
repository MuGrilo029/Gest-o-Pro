-- 047-store-brand-color-apply.sql
-- Migração aditiva. Getter da cor da marca para o Front-end.
-- A cor fica em store_modules.config->>'color' (módulo 'brand', gravada pela set_store_brand da 008).
-- store_brand_color(p_store) devolve a cor SOMENTE se store_module_enabled(p_store, 'brand') for true.
-- Quem pode ler: admin da plataforma ou membro da loja (store_members). Outros: 42501. Sem membro/loja: NULL quando desligado.
-- Não altera dados. Sem GRANT a anon.
-- PRÉ-REQUISITOS: 036/046 (store_module_enabled), 008 (set_store_brand, formato da cor).
-- NÃO EXECUTAR antes do rollback-test verde e da revisão da SecOps.

DO $pre$
BEGIN
  IF to_regprocedure('public.store_module_enabled(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: store_module_enabled (036/046).';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.store_brand_color(p_store uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_color text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login novamente.' USING ERRCODE = '42501';
  END IF;
  IF p_store IS NULL THEN
    RAISE EXCEPTION 'Loja não informada.';
  END IF;
  -- Só admin da plataforma ou membro da loja. Mesma resposta para loja inexistente e sem permissão.
  IF NOT (public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.store_members m WHERE m.store_id = p_store AND m.user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Sem permissão para ver a cor desta loja.' USING ERRCODE = '42501';
  END IF;

  -- Cor só existe com o módulo brand habilitado (plano ou override vigente)
  IF NOT public.store_module_enabled(p_store, 'brand') THEN
    RETURN NULL;
  END IF;

  SELECT sm.config->>'color' INTO v_color
    FROM public.store_modules sm
   WHERE sm.store_id = p_store AND sm.module_key = 'brand';
  RETURN v_color;
END
$f$;

REVOKE ALL ON FUNCTION public.store_brand_color(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_brand_color(uuid) TO authenticated, service_role;

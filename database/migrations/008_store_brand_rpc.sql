-- ============================================================================
-- 008_store_brand_rpc.sql
-- Cor da marca da loja pelo dono/gerente.
-- A policy store_modules_write só deixa o administrador da plataforma gravar,
-- então dono/gerente tomavam erro de RLS ao salvar a cor. Esta RPC grava só a
-- linha especial module_key = 'brand' (enabled = false; a cor fica em config.color,
-- que é o que o front lê) depois de validar o acesso. Nada mais em store_modules
-- fica liberado.
--   set_store_brand(p_store_id, '#rrggbb')  -> grava a cor
--   set_store_brand(p_store_id, NULL)       -> volta à cor padrão (config = {})
-- Seguro para rodar mais de uma vez.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.set_store_brand(p_store_id UUID, p_color TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_color TEXT := lower(trim(p_color));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login novamente.';
  END IF;
  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'Loja não informada.';
  END IF;

  -- Mesma resposta para loja inexistente e sem permissão (sem enumeração).
  IF NOT (public.store_access_ok(p_store_id)
          AND (public.is_store_manager(p_store_id) OR public.is_platform_admin())) THEN
    RAISE EXCEPTION 'Sem permissão para alterar a cor desta loja.';
  END IF;

  IF p_color IS NOT NULL AND v_color !~ '^#[0-9a-f]{6}$' THEN
    RAISE EXCEPTION 'Cor inválida. Use o formato #rrggbb.';
  END IF;

  INSERT INTO public.store_modules (store_id, module_key, enabled, config)
  VALUES (
    p_store_id, 'brand', false,
    CASE WHEN p_color IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('color', v_color) END
  )
  ON CONFLICT (store_id, module_key) DO UPDATE
    SET enabled = false, config = EXCLUDED.config, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_store_brand(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_store_brand(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_store_brand(UUID, TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

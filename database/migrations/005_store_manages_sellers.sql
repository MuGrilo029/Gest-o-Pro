-- ============================================================================
-- 005_store_manages_sellers.sql
-- Dono e gerente da loja gerenciam os VENDEDORES da própria loja.
-- Donos, gerentes, lojas e módulos continuam só com o administrador.
--
-- A criação de contas (e-mail + senha) é feita pela Edge Function
-- manage-users; o cadastro público fica desligado no Supabase Auth.
-- Seguro para rodar mais de uma vez.
-- ============================================================================

BEGIN;

-- Ver a equipe: administrador, ou dono/gerente da loja.
CREATE OR REPLACE FUNCTION public.list_store_members(p_store UUID)
RETURNS TABLE (user_id UUID, email TEXT, name TEXT, role TEXT, permissions TEXT[], created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_store_manager(p_store) THEN
    RAISE EXCEPTION 'Apenas o dono, o gerente ou o administrador vê a equipe.';
  END IF;
  RETURN QUERY
    SELECT m.user_id, u.email::TEXT, COALESCE(p.name, u.email)::TEXT, m.role, m.permissions, m.created_at
    FROM store_members m
    JOIN auth.users u ON u.id = m.user_id
    LEFT JOIN profiles p ON p.id = m.user_id
    WHERE m.store_id = p_store
    ORDER BY CASE m.role WHEN 'OWNER' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END, u.email;
END;
$$;

-- Adicionar conta já existente: administrador (qualquer papel) ou
-- dono/gerente (só vendedor).
CREATE OR REPLACE FUNCTION public.add_store_member(p_store UUID, p_email TEXT, p_role TEXT, p_permissions TEXT[] DEFAULT '{}')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user    UUID;
  v_current TEXT;
BEGIN
  IF p_role NOT IN ('OWNER', 'MANAGER', 'SELLER') THEN
    RAISE EXCEPTION 'Papel inválido.';
  END IF;
  IF NOT public.is_platform_admin() THEN
    IF NOT public.is_store_manager(p_store) OR p_role <> 'SELLER' THEN
      RAISE EXCEPTION 'Dono e gerente só podem adicionar vendedores.';
    END IF;
  END IF;

  SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Nenhuma conta com o e-mail %.', p_email;
  END IF;

  SELECT role INTO v_current FROM store_members WHERE store_id = p_store AND user_id = v_user;
  IF v_current IS NOT NULL AND v_current <> 'SELLER' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Essa pessoa já é dona ou gerente desta loja.';
  END IF;

  INSERT INTO store_members (store_id, user_id, role, permissions)
  VALUES (p_store, v_user, p_role, COALESCE(p_permissions, '{}'))
  ON CONFLICT (store_id, user_id) DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions;

  UPDATE profiles SET active_store_id = p_store WHERE id = v_user AND active_store_id IS NULL;
  RETURN v_user;
END;
$$;

-- Alterar: administrador (tudo) ou dono/gerente (só vendedor continuando vendedor).
CREATE OR REPLACE FUNCTION public.update_store_member(p_store UUID, p_user UUID, p_role TEXT, p_permissions TEXT[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current TEXT;
BEGIN
  IF p_role NOT IN ('OWNER', 'MANAGER', 'SELLER') THEN
    RAISE EXCEPTION 'Papel inválido.';
  END IF;

  SELECT role INTO v_current FROM store_members WHERE store_id = p_store AND user_id = p_user;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Pessoa não encontrada nesta loja.';
  END IF;

  IF NOT public.is_platform_admin() THEN
    IF NOT public.is_store_manager(p_store) OR v_current <> 'SELLER' OR p_role <> 'SELLER' THEN
      RAISE EXCEPTION 'Dono e gerente só alteram vendedores.';
    END IF;
  END IF;

  UPDATE store_members SET role = p_role, permissions = COALESCE(p_permissions, '{}')
  WHERE store_id = p_store AND user_id = p_user;
END;
$$;

-- Remover: administrador (qualquer um) ou dono/gerente (só vendedor).
CREATE OR REPLACE FUNCTION public.remove_store_member(p_store UUID, p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current TEXT;
BEGIN
  SELECT role INTO v_current FROM store_members WHERE store_id = p_store AND user_id = p_user;
  IF v_current IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.is_platform_admin() THEN
    IF NOT public.is_store_manager(p_store) OR v_current <> 'SELLER' THEN
      RAISE EXCEPTION 'Dono e gerente só removem vendedores.';
    END IF;
  END IF;

  DELETE FROM store_members WHERE store_id = p_store AND user_id = p_user;
  UPDATE profiles SET active_store_id = NULL WHERE id = p_user AND active_store_id = p_store;
END;
$$;

-- Leitura direta da tabela de membros: a própria linha, o administrador,
-- ou dono/gerente daquela loja.
DROP POLICY IF EXISTS store_members_read ON public.store_members;
CREATE POLICY store_members_read ON public.store_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_store_manager(store_id));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- 004_platform_admin_only.sql
-- A administração das lojas passa a ser exclusiva do administrador da
-- plataforma (o desenvolvedor). Donos e gerentes de loja usam o sistema da
-- loja deles, mas não criam lojas, não veem outras lojas, não ligam/desligam
-- módulos e não montam equipe.
--
--   * Criar loja, editar loja, módulos e equipe: só is_platform_admin.
--   * O administrador entra em qualquer loja ativa sem precisar ser membro.
--   * Lojas novas não colocam o administrador na equipe.
--   * Ninguém consegue se tornar administrador pelo app (trigger de proteção).
--
-- Seguro para rodar mais de uma vez.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Acesso do administrador a qualquer loja
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_role(p_store UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT role FROM store_members WHERE store_id = p_store AND user_id = auth.uid()),
    CASE WHEN public.is_platform_admin() THEN 'OWNER' END
  );
$$;

CREATE OR REPLACE FUNCTION public.is_store_member(p_store UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin()
      OR EXISTS (SELECT 1 FROM store_members WHERE store_id = p_store AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_store_manager(p_store UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin()
      OR EXISTS (
        SELECT 1 FROM store_members
        WHERE store_id = p_store AND user_id = auth.uid() AND role IN ('OWNER', 'MANAGER')
      );
$$;

CREATE OR REPLACE FUNCTION public.current_store_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.active_store_id
  FROM profiles p
  JOIN stores s ON s.id = p.active_store_id AND s.is_active
  WHERE p.id = auth.uid()
    AND (
      p.is_platform_admin
      OR EXISTS (SELECT 1 FROM store_members m WHERE m.store_id = p.active_store_id AND m.user_id = p.id)
    );
$$;

-- O administrador vê todas as lojas ativas; os demais, só as suas.
CREATE OR REPLACE FUNCTION public.my_stores()
RETURNS TABLE (id UUID, name TEXT, role TEXT, permissions TEXT[], is_active_store BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name,
         COALESCE(m.role, 'OWNER'),
         COALESCE(m.permissions, '{}'),
         s.id = (SELECT active_store_id FROM profiles WHERE profiles.id = auth.uid())
  FROM stores s
  LEFT JOIN store_members m ON m.store_id = s.id AND m.user_id = auth.uid()
  WHERE s.is_active
    AND (m.user_id IS NOT NULL OR public.is_platform_admin())
  ORDER BY s.name;
$$;

-- ---------------------------------------------------------------------------
-- 2. Gestão de lojas, módulos e equipe: só administrador
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_store(p_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store UUID;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma pode criar lojas.';
  END IF;
  IF COALESCE(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome da loja.';
  END IF;

  INSERT INTO stores (name, created_by) VALUES (trim(p_name), auth.uid()) RETURNING id INTO v_store;
  INSERT INTO company_settings (store_id, name) VALUES (v_store, trim(p_name));
  UPDATE profiles SET active_store_id = v_store WHERE id = auth.uid();
  RETURN v_store;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_store_members(p_store UUID)
RETURNS TABLE (user_id UUID, email TEXT, name TEXT, role TEXT, permissions TEXT[], created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma gerencia a equipe.';
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

CREATE OR REPLACE FUNCTION public.add_store_member(p_store UUID, p_email TEXT, p_role TEXT, p_permissions TEXT[] DEFAULT '{}')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma gerencia a equipe.';
  END IF;
  IF p_role NOT IN ('OWNER', 'MANAGER', 'SELLER') THEN
    RAISE EXCEPTION 'Papel inválido.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stores WHERE id = p_store) THEN
    RAISE EXCEPTION 'Loja não encontrada.';
  END IF;

  SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Nenhuma conta com o e-mail %. Peça para a pessoa se cadastrar primeiro.', p_email;
  END IF;

  INSERT INTO store_members (store_id, user_id, role, permissions)
  VALUES (p_store, v_user, p_role, COALESCE(p_permissions, '{}'))
  ON CONFLICT (store_id, user_id) DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions;

  UPDATE profiles SET active_store_id = p_store WHERE id = v_user AND active_store_id IS NULL;
  RETURN v_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_store_member(p_store UUID, p_user UUID, p_role TEXT, p_permissions TEXT[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma gerencia a equipe.';
  END IF;
  IF p_role NOT IN ('OWNER', 'MANAGER', 'SELLER') THEN
    RAISE EXCEPTION 'Papel inválido.';
  END IF;
  UPDATE store_members SET role = p_role, permissions = COALESCE(p_permissions, '{}')
  WHERE store_id = p_store AND user_id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pessoa não encontrada nesta loja.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_store_member(p_store UUID, p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma gerencia a equipe.';
  END IF;
  DELETE FROM store_members WHERE store_id = p_store AND user_id = p_user;
  UPDATE profiles SET active_store_id = NULL WHERE id = p_user AND active_store_id = p_store;
END;
$$;

DROP POLICY IF EXISTS stores_update ON public.stores;
CREATE POLICY stores_update ON public.stores FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS store_modules_write ON public.store_modules;
CREATE POLICY store_modules_write ON public.store_modules FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Membros só leem a própria linha; o administrador lê todas.
DROP POLICY IF EXISTS store_members_read ON public.store_members;
CREATE POLICY store_members_read ON public.store_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. Ninguém vira administrador pelo app
-- ---------------------------------------------------------------------------
-- Hoje só o administrador pode editar perfis (política "Admins can update
-- profiles"). Esta trava garante que, mesmo se alguém abrir uma política de
-- edição no futuro, is_platform_admin só muda pelo SQL Editor do Supabase
-- (auth.uid() nulo) ou por outro administrador.
CREATE OR REPLACE FUNCTION public.protect_platform_admin_flag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_platform_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.is_platform_admin := false;
  ELSIF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin THEN
    RAISE EXCEPTION 'Sem permissão para alterar administradores.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_platform_admin_flag ON public.profiles;
CREATE TRIGGER protect_platform_admin_flag
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_platform_admin_flag();

COMMIT;

NOTIFY pgrst, 'reload schema';

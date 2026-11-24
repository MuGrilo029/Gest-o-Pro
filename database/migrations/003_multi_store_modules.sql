-- ============================================================================
-- 003_multi_store_modules.sql
-- Transforma o Gestão Pro em multi-loja e modular.
--
--   stores          -> cada loja (cliente) do sistema
--   store_members   -> quem acessa cada loja e com qual papel
--                      OWNER (dono), MANAGER (gerente), SELLER (vendedor)
--   store_modules   -> quais módulos estão ligados em cada loja
--   profiles.active_store_id -> loja que o usuário está usando agora
--
-- Todas as tabelas de negócio ganham store_id. O valor padrão é a loja ativa
-- do usuário (public.current_store_id()), então o app não precisa enviar
-- store_id em cada insert. O RLS garante que cada usuário só lê e grava
-- dados da loja ativa, e só se for membro dela.
--
-- Dados existentes vão para uma loja "Loja Principal" criada aqui.
-- Seguro para rodar mais de uma vez.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tabelas de lojas, equipe e módulos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_members (
  store_id    UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'SELLER' CHECK (role IN ('OWNER', 'MANAGER', 'SELLER')),
  -- Telas liberadas para SELLER (ex.: {SALES,CUSTOMERS}). Vazio = padrão do papel.
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_store_members_user ON public.store_members(user_id);

CREATE TABLE IF NOT EXISTS public.store_modules (
  store_id    UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  module_key  TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, module_key)
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active_store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;
-- profiles.roles não define mais permissão; novos cadastros não ganham ADMIN.
ALTER TABLE public.profiles ALTER COLUMN roles SET DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- 2. Funções auxiliares (SECURITY DEFINER evita recursão nas políticas)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_platform_admin FROM profiles WHERE id = auth.uid()), false);
$$;

CREATE OR REPLACE FUNCTION public.store_role(p_store UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM store_members WHERE store_id = p_store AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_store_member(p_store UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM store_members WHERE store_id = p_store AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_store_manager(p_store UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM store_members
    WHERE store_id = p_store AND user_id = auth.uid() AND role IN ('OWNER', 'MANAGER')
  );
$$;

-- Loja ativa do usuário, só se ele ainda for membro dela.
CREATE OR REPLACE FUNCTION public.current_store_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.active_store_id
  FROM profiles p
  JOIN store_members m ON m.store_id = p.active_store_id AND m.user_id = p.id
  JOIN stores s ON s.id = p.active_store_id AND s.is_active
  WHERE p.id = auth.uid();
$$;

-- is_admin() passa a significar "administrador da plataforma".
-- Antes ele valia para qualquer usuário com roles = {ADMIN}, que era o padrão
-- de todo cadastro novo, então qualquer conta via todos os perfis.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin();
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, roles)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'name', '{}')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Loja inicial com os dados existentes
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_store UUID;
  v_name  TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stores) THEN
    IF to_regclass('public.company_settings') IS NOT NULL THEN
      EXECUTE 'SELECT name FROM public.company_settings LIMIT 1' INTO v_name;
    END IF;

    INSERT INTO public.stores (name, slug)
    VALUES (COALESCE(NULLIF(v_name, ''), 'Loja Principal'), 'loja-principal')
    RETURNING id INTO v_store;

    -- Usuários existentes: quem era ADMIN vira dono; os demais viram vendedores
    -- e mantêm as telas que já tinham liberadas.
    INSERT INTO public.store_members (store_id, user_id, role, permissions)
    SELECT
      v_store,
      p.id,
      CASE WHEN 'ADMIN' = ANY(COALESCE(p.roles, '{}')) THEN 'OWNER' ELSE 'SELLER' END,
      CASE WHEN 'ADMIN' = ANY(COALESCE(p.roles, '{}')) THEN '{}'::TEXT[] ELSE COALESCE(p.roles, '{}') END
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    ON CONFLICT DO NOTHING;

    UPDATE public.profiles
    SET active_store_id = v_store
    WHERE active_store_id IS NULL
      AND id IN (SELECT user_id FROM public.store_members WHERE store_id = v_store);

    UPDATE public.profiles
    SET is_platform_admin = true
    WHERE 'ADMIN' = ANY(COALESCE(roles, '{}'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. store_id em todas as tabelas de negócio + RLS por loja
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t       TEXT;
  pol     TEXT;
  v_store UUID := (SELECT id FROM public.stores ORDER BY created_at LIMIT 1);
  tables  TEXT[] := ARRAY[
    'category_groups', 'categories', 'company_settings', 'customers', 'suppliers',
    'products', 'sales', 'sale_items', 'transactions', 'transaction_payments',
    'stock_movements', 'production_orders', 'deliveries', 'quotes', 'quote_items',
    'orders', 'card_fees', 'simulations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE', t);
    EXECUTE format('UPDATE public.%I SET store_id = $1 WHERE store_id IS NULL', t) USING v_store;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN store_id SET DEFAULT public.current_store_id()', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN store_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(store_id)', 'idx_' || t || '_store', t);

    -- Remove as políticas antigas ("qualquer usuário logado vê tudo").
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY store_isolation ON public.%I FOR ALL TO authenticated '
      'USING (store_id = (SELECT public.current_store_id())) '
      'WITH CHECK (store_id = (SELECT public.current_store_id()))', t);
  END LOOP;
END $$;

-- 4.1 Configurações da empresa: uma linha por loja; só dono/gerente altera.
DELETE FROM public.company_settings a
USING public.company_settings b
WHERE a.store_id = b.store_id AND a.ctid > b.ctid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_settings_store ON public.company_settings(store_id);

DROP POLICY IF EXISTS store_isolation ON public.company_settings;
CREATE POLICY company_settings_read ON public.company_settings FOR SELECT TO authenticated
  USING (store_id = (SELECT public.current_store_id()));
CREATE POLICY company_settings_write ON public.company_settings FOR ALL TO authenticated
  USING (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id))
  WITH CHECK (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id));

-- 4.2 Vendas e orçamentos: vendedor só vê os próprios; só dono/gerente exclui.
ALTER TABLE public.sales  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid();
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales', 'quotes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS store_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ('
      ' store_id = (SELECT public.current_store_id())'
      ' AND (public.store_role(store_id) <> ''SELLER'' OR created_by = auth.uid()))', t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ('
      ' store_id = (SELECT public.current_store_id()))', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ('
      ' store_id = (SELECT public.current_store_id())'
      ' AND (public.store_role(store_id) <> ''SELLER'' OR created_by = auth.uid()))'
      ' WITH CHECK (store_id = (SELECT public.current_store_id()))', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ('
      ' store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id))', t || '_delete', t);
  END LOOP;
END $$;

-- Itens seguem a visibilidade do documento-pai (vendedor só vê itens das próprias vendas).
DROP POLICY IF EXISTS store_isolation ON public.sale_items;
CREATE POLICY sale_items_access ON public.sale_items FOR ALL TO authenticated
  USING (store_id = (SELECT public.current_store_id())
         AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id))
  WITH CHECK (store_id = (SELECT public.current_store_id())
         AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id));

DROP POLICY IF EXISTS store_isolation ON public.quote_items;
CREATE POLICY quote_items_access ON public.quote_items FOR ALL TO authenticated
  USING (store_id = (SELECT public.current_store_id())
         AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_items.quote_id))
  WITH CHECK (store_id = (SELECT public.current_store_id())
         AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_items.quote_id));

-- 4.3 Financeiro: qualquer membro registra (a venda gera lançamentos),
--     mas só dono/gerente vê, altera ou exclui.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['transactions', 'transaction_payments', 'simulations'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS store_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ('
      ' store_id = (SELECT public.current_store_id()))', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING ('
      ' store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id))'
      ' WITH CHECK (store_id = (SELECT public.current_store_id()) AND public.is_store_manager(store_id))',
      t || '_manage', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. RLS das tabelas de lojas e perfis
-- ---------------------------------------------------------------------------
ALTER TABLE public.stores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stores_read   ON public.stores;
DROP POLICY IF EXISTS stores_update ON public.stores;
CREATE POLICY stores_read ON public.stores FOR SELECT TO authenticated
  USING (public.is_store_member(id) OR public.is_platform_admin());
CREATE POLICY stores_update ON public.stores FOR UPDATE TO authenticated
  USING (public.store_role(id) = 'OWNER' OR public.is_platform_admin())
  WITH CHECK (public.store_role(id) = 'OWNER' OR public.is_platform_admin());

-- Membros: leitura para quem é da loja. Alterações só pelas funções abaixo.
DROP POLICY IF EXISTS store_members_read ON public.store_members;
CREATE POLICY store_members_read ON public.store_members FOR SELECT TO authenticated
  USING (public.is_store_member(store_id) OR public.is_platform_admin());

DROP POLICY IF EXISTS store_modules_read  ON public.store_modules;
DROP POLICY IF EXISTS store_modules_write ON public.store_modules;
CREATE POLICY store_modules_read ON public.store_modules FOR SELECT TO authenticated
  USING (public.is_store_member(store_id));
CREATE POLICY store_modules_write ON public.store_modules FOR ALL TO authenticated
  USING (public.is_store_manager(store_id))
  WITH CHECK (public.is_store_manager(store_id));

-- Perfis: cada um vê o próprio e os colegas de loja.
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles"     ON public.profiles;
DROP POLICY IF EXISTS profiles_read ON public.profiles;
CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated USING (
  id = auth.uid()
  OR public.is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM public.store_members a
    JOIN public.store_members b ON b.store_id = a.store_id
    WHERE a.user_id = auth.uid() AND b.user_id = profiles.id
  )
);

-- ---------------------------------------------------------------------------
-- 6. Funções usadas pelo app
-- ---------------------------------------------------------------------------

-- Lojas do usuário logado.
CREATE OR REPLACE FUNCTION public.my_stores()
RETURNS TABLE (id UUID, name TEXT, role TEXT, permissions TEXT[], is_active_store BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, m.role, m.permissions,
         s.id = (SELECT active_store_id FROM profiles WHERE profiles.id = auth.uid())
  FROM store_members m
  JOIN stores s ON s.id = m.store_id AND s.is_active
  WHERE m.user_id = auth.uid()
  ORDER BY s.name;
$$;

CREATE OR REPLACE FUNCTION public.set_active_store(p_store UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_store_member(p_store) THEN
    RAISE EXCEPTION 'Você não faz parte desta loja.';
  END IF;
  UPDATE profiles SET active_store_id = p_store WHERE id = auth.uid();
END;
$$;

-- Cria uma loja nova. Só administrador da plataforma.
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
  INSERT INTO store_members (store_id, user_id, role) VALUES (v_store, auth.uid(), 'OWNER');
  INSERT INTO company_settings (store_id, name) VALUES (v_store, trim(p_name));
  UPDATE profiles SET active_store_id = v_store WHERE id = auth.uid();
  RETURN v_store;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_store_members(p_store UUID)
RETURNS TABLE (user_id UUID, email TEXT, name TEXT, role TEXT, permissions TEXT[], created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.is_store_member(p_store) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Você não faz parte desta loja.';
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

-- Adiciona (ou atualiza) um membro pelo e-mail. A pessoa precisa ter conta.
CREATE OR REPLACE FUNCTION public.add_store_member(p_store UUID, p_email TEXT, p_role TEXT, p_permissions TEXT[] DEFAULT '{}')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID;
BEGIN
  IF NOT public.is_store_manager(p_store) THEN
    RAISE EXCEPTION 'Apenas dono ou gerente pode adicionar pessoas.';
  END IF;
  IF p_role NOT IN ('OWNER', 'MANAGER', 'SELLER') THEN
    RAISE EXCEPTION 'Papel inválido.';
  END IF;
  IF p_role = 'OWNER' AND public.store_role(p_store) <> 'OWNER' THEN
    RAISE EXCEPTION 'Apenas o dono pode adicionar outro dono.';
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
DECLARE
  v_current TEXT;
BEGIN
  IF NOT public.is_store_manager(p_store) THEN
    RAISE EXCEPTION 'Apenas dono ou gerente pode alterar a equipe.';
  END IF;
  IF p_role NOT IN ('OWNER', 'MANAGER', 'SELLER') THEN
    RAISE EXCEPTION 'Papel inválido.';
  END IF;

  SELECT role INTO v_current FROM store_members WHERE store_id = p_store AND user_id = p_user;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Pessoa não encontrada nesta loja.';
  END IF;
  IF (v_current = 'OWNER' OR p_role = 'OWNER') AND public.store_role(p_store) <> 'OWNER' THEN
    RAISE EXCEPTION 'Apenas o dono pode alterar outro dono.';
  END IF;
  IF v_current = 'OWNER' AND p_role <> 'OWNER'
     AND (SELECT count(*) FROM store_members WHERE store_id = p_store AND role = 'OWNER') <= 1 THEN
    RAISE EXCEPTION 'A loja precisa de pelo menos um dono.';
  END IF;

  UPDATE store_members SET role = p_role, permissions = COALESCE(p_permissions, '{}')
  WHERE store_id = p_store AND user_id = p_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_store_member(p_store UUID, p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current TEXT;
BEGIN
  IF NOT public.is_store_manager(p_store) THEN
    RAISE EXCEPTION 'Apenas dono ou gerente pode remover pessoas.';
  END IF;

  SELECT role INTO v_current FROM store_members WHERE store_id = p_store AND user_id = p_user;
  IF v_current IS NULL THEN
    RETURN;
  END IF;
  IF v_current = 'OWNER' AND public.store_role(p_store) <> 'OWNER' THEN
    RAISE EXCEPTION 'Apenas o dono pode remover outro dono.';
  END IF;
  IF v_current = 'OWNER'
     AND (SELECT count(*) FROM store_members WHERE store_id = p_store AND role = 'OWNER') <= 1 THEN
    RAISE EXCEPTION 'A loja precisa de pelo menos um dono.';
  END IF;

  DELETE FROM store_members WHERE store_id = p_store AND user_id = p_user;
  UPDATE profiles SET active_store_id = NULL WHERE id = p_user AND active_store_id = p_store;
END;
$$;

REVOKE ALL ON FUNCTION public.my_stores()                                      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_active_store(UUID)                           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_store(TEXT)                               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_store_members(UUID)                         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_store_member(UUID, TEXT, TEXT, TEXT[])       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_store_member(UUID, UUID, TEXT, TEXT[])    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_store_member(UUID, UUID)                  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.my_stores()                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_store(UUID)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_store(TEXT)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_store_members(UUID)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_store_member(UUID, TEXT, TEXT, TEXT[])    TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_store_member(UUID, UUID, TEXT, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_store_member(UUID, UUID)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_store_id()                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_store_member(UUID)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_store_manager(UUID)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_role(UUID)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin()                           TO authenticated;

GRANT SELECT, UPDATE ON public.stores TO authenticated;
GRANT SELECT ON public.store_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_modules TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

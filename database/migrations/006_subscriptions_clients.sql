-- ============================================================================
-- 006_subscriptions_clients.sql
-- Assinatura por loja (teste grátis de horas / tempo de uso pago) e painel de
-- clientes do administrador da plataforma.
--
--   * stores: plan, status (trial|active|suspended|expired), trial_ends_at,
--     valid_until, contact_email, notes. Lojas existentes viram 'active' sem prazo.
--   * store_access_ok(loja): loja suspensa/expirada é bloqueada NO BANCO.
--     current_store_id(), is_store_member() e is_store_manager() usam essa regra,
--     então toda tabela de negócio (RLS por loja) deixa de responder.
--     O administrador da plataforma nunca é bloqueado.
--   * RPCs só do administrador: admin_create_client, admin_extend,
--     admin_set_status, admin_list_clients.
--   * my_store_access(): o app lê o status/tempo restante das lojas do usuário.
--   * Somente techflowia@gmail.com fica com is_platform_admin = true.
--
-- A expiração é calculada na hora (trial_ends_at / valid_until < now()); não
-- depende de job agendado. Seguro para rodar mais de uma vez.
-- Rodar depois de 003, 004 e 005, no Supabase de produção (yfyck...).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Colunas de assinatura em stores
-- ---------------------------------------------------------------------------
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS plan           TEXT;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS trial_ends_at  TIMESTAMPTZ;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS valid_until    TIMESTAMPTZ;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS contact_email  TEXT;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS notes          TEXT;

ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_status_check;
ALTER TABLE public.stores ADD CONSTRAINT stores_status_check
  CHECK (status IN ('trial', 'active', 'suspended', 'expired'));

-- Módulo novo "Produção sob medida" (ficha técnica de estofados/sob medida):
-- as lojas que já existem continuam com ele ligado; lojas novas escolhem.
INSERT INTO public.store_modules (store_id, module_key, enabled)
SELECT id, 'custom_production', true FROM public.stores
ON CONFLICT (store_id, module_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Regra de acesso da loja
-- ---------------------------------------------------------------------------
-- Status efetivo: considera o relógio, sem precisar de job.
CREATE OR REPLACE FUNCTION public.store_effective_status(p_status TEXT, p_trial TIMESTAMPTZ, p_valid TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_status = 'suspended' THEN 'suspended'
    WHEN p_status = 'expired'   THEN 'expired'
    WHEN p_status = 'trial'  AND (p_trial IS NULL OR p_trial <= now()) THEN 'expired'
    WHEN p_status = 'active' AND p_valid IS NOT NULL AND p_valid <= now() THEN 'expired'
    ELSE p_status
  END;
$$;

CREATE OR REPLACE FUNCTION public.store_access_ok(p_store UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin()
      OR COALESCE((
        SELECT s.is_active
           AND public.store_effective_status(s.status, s.trial_ends_at, s.valid_until) IN ('trial', 'active')
        FROM stores s WHERE s.id = p_store
      ), false);
$$;

CREATE OR REPLACE FUNCTION public.is_store_member(p_store UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin()
      OR (
        public.store_access_ok(p_store)
        AND EXISTS (SELECT 1 FROM store_members WHERE store_id = p_store AND user_id = auth.uid())
      );
$$;

CREATE OR REPLACE FUNCTION public.is_store_manager(p_store UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin()
      OR (
        public.store_access_ok(p_store)
        AND EXISTS (
          SELECT 1 FROM store_members
          WHERE store_id = p_store AND user_id = auth.uid() AND role IN ('OWNER', 'MANAGER')
        )
      );
$$;

CREATE OR REPLACE FUNCTION public.current_store_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.active_store_id
  FROM profiles p
  JOIN stores s ON s.id = p.active_store_id AND s.is_active
  WHERE p.id = auth.uid()
    AND public.store_access_ok(p.active_store_id)
    AND (
      p.is_platform_admin
      OR EXISTS (SELECT 1 FROM store_members m WHERE m.store_id = p.active_store_id AND m.user_id = p.id)
    );
$$;

-- Status das lojas do usuário logado (o app mostra tempo restante / acesso expirado).
CREATE OR REPLACE FUNCTION public.my_store_access()
RETURNS TABLE (
  store_id UUID, status TEXT, effective_status TEXT, plan TEXT,
  trial_ends_at TIMESTAMPTZ, valid_until TIMESTAMPTZ, seconds_remaining BIGINT, access_ok BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.status,
         public.store_effective_status(s.status, s.trial_ends_at, s.valid_until),
         s.plan, s.trial_ends_at, s.valid_until,
         CASE
           WHEN s.status = 'trial'  THEN GREATEST(0, EXTRACT(EPOCH FROM (s.trial_ends_at - now()))::BIGINT)
           WHEN s.status = 'active' AND s.valid_until IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (s.valid_until - now()))::BIGINT)
           ELSE NULL
         END,
         public.store_access_ok(s.id)
  FROM stores s
  WHERE s.is_active
    AND (
      public.is_platform_admin()
      OR EXISTS (SELECT 1 FROM store_members m WHERE m.store_id = s.id AND m.user_id = auth.uid())
    );
$$;

-- ---------------------------------------------------------------------------
-- 3. Administrador da plataforma: somente techflowia@gmail.com
-- ---------------------------------------------------------------------------
-- A trava protect_platform_admin_flag deixa passar quando auth.uid() é nulo
-- (SQL Editor do Supabase), que é o caso aqui.
INSERT INTO public.profiles (id, email, name, roles)
SELECT u.id, u.email, COALESCE(u.raw_user_meta_data->>'name', 'Administrador'), '{}'
FROM auth.users u
WHERE lower(u.email) = 'techflowia@gmail.com'
ON CONFLICT (id) DO NOTHING;

UPDATE public.profiles p
SET is_platform_admin = (lower(u.email) = 'techflowia@gmail.com')
FROM auth.users u
WHERE u.id = p.id
  AND p.is_platform_admin IS DISTINCT FROM (lower(u.email) = 'techflowia@gmail.com');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id = p.id
    WHERE lower(u.email) = 'techflowia@gmail.com' AND p.is_platform_admin
  ) THEN
    RAISE WARNING 'techflowia@gmail.com não encontrado em auth.users: crie a conta e rode esta migration de novo.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. RPCs do administrador
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._require_platform_admin()
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma pode fazer isso.';
  END IF;
END;
$$;

-- Cria loja cliente: loja + módulos contratados + assinatura (+ dono, se a conta já existir).
--   p_mode 'trial' (padrão): teste grátis; p_hours (padrão 3) ou p_days.
--   p_mode 'paid': tempo de uso pago; p_days (padrão 30) ou p_hours.
--   p_modules NULL = todos os módulos; senão só os listados (os "core" sempre ligam).
-- Se o e-mail ainda não tem conta, account_exists = false e o app cria a conta
-- pela Edge Function manage-users, já na loja devolvida.
CREATE OR REPLACE FUNCTION public.admin_create_client(
  p_email      TEXT,
  p_store_name TEXT,
  p_modules    TEXT[]  DEFAULT NULL,
  p_mode       TEXT    DEFAULT 'trial',
  p_hours      INTEGER DEFAULT NULL,
  p_days       INTEGER DEFAULT NULL,
  p_plan       TEXT    DEFAULT NULL,
  p_notes      TEXT    DEFAULT NULL
)
RETURNS TABLE (store_id UUID, account_exists BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_store   UUID;
  v_user    UUID;
  v_email   TEXT := lower(trim(COALESCE(p_email, '')));
  v_end     TIMESTAMPTZ;
  v_all     TEXT[] := ARRAY['dashboard','sales','customers','inventory','settings','reports','quotes',
                            'financial','boletos','suppliers','orders','production','custom_production',
                            'deliveries','push_notifications'];
  k         TEXT;
BEGIN
  PERFORM public._require_platform_admin();
  IF v_email = '' OR v_email NOT LIKE '%_@_%._%' THEN
    RAISE EXCEPTION 'Informe um e-mail válido.';
  END IF;
  IF COALESCE(trim(p_store_name), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome da loja.';
  END IF;
  IF p_mode NOT IN ('trial', 'paid') THEN
    RAISE EXCEPTION 'Modo inválido (use trial ou paid).';
  END IF;

  IF p_mode = 'trial' THEN
    v_end := now() + CASE
      WHEN p_days  IS NOT NULL THEN make_interval(days  => p_days)
      WHEN p_hours IS NOT NULL THEN make_interval(hours => p_hours)
      ELSE interval '3 hours' END;
  ELSE
    v_end := now() + CASE
      WHEN p_hours IS NOT NULL AND p_days IS NULL THEN make_interval(hours => p_hours)
      ELSE make_interval(days => COALESCE(p_days, 30)) END;
  END IF;

  INSERT INTO stores (name, created_by, status, plan, trial_ends_at, valid_until, contact_email, notes)
  VALUES (
    trim(p_store_name), auth.uid(),
    CASE WHEN p_mode = 'trial' THEN 'trial' ELSE 'active' END,
    COALESCE(p_plan, CASE WHEN p_mode = 'trial' THEN 'trial' ELSE 'pago' END),
    CASE WHEN p_mode = 'trial' THEN v_end END,
    CASE WHEN p_mode = 'paid'  THEN v_end END,
    v_email, p_notes
  ) RETURNING id INTO v_store;

  INSERT INTO company_settings (store_id, name) VALUES (v_store, trim(p_store_name));

  FOREACH k IN ARRAY v_all LOOP
    INSERT INTO store_modules (store_id, module_key, enabled)
    VALUES (v_store, k, p_modules IS NULL OR k = ANY(p_modules))
    ON CONFLICT (store_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
  END LOOP;

  SELECT id INTO v_user FROM auth.users WHERE lower(email) = v_email;
  IF v_user IS NOT NULL THEN
    INSERT INTO store_members (store_id, user_id, role) VALUES (v_store, v_user, 'OWNER')
    ON CONFLICT (store_id, user_id) DO UPDATE SET role = 'OWNER';
    UPDATE profiles SET active_store_id = v_store WHERE id = v_user AND active_store_id IS NULL;
  END IF;

  RETURN QUERY SELECT v_store, v_user IS NOT NULL;
END;
$$;

-- Estende o tempo de uso: soma ao que sobrou (ou a partir de agora, se já venceu).
-- Loja 'expired' volta a funcionar; 'suspended' continua suspensa (use admin_set_status).
CREATE OR REPLACE FUNCTION public.admin_extend(p_store UUID, p_hours INTEGER DEFAULT NULL, p_days INTEGER DEFAULT NULL)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  s       stores%ROWTYPE;
  v_add   INTERVAL;
  v_base  TIMESTAMPTZ;
  v_end   TIMESTAMPTZ;
BEGIN
  PERFORM public._require_platform_admin();
  IF COALESCE(p_hours, 0) <= 0 AND COALESCE(p_days, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe horas ou dias maiores que zero.';
  END IF;
  SELECT * INTO s FROM stores WHERE id = p_store;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;

  v_add := make_interval(days => COALESCE(p_days, 0), hours => COALESCE(p_hours, 0));

  IF s.status = 'trial' OR (s.status = 'expired' AND s.valid_until IS NULL AND s.trial_ends_at IS NOT NULL) THEN
    v_base := GREATEST(COALESCE(s.trial_ends_at, now()), now());
    v_end  := v_base + v_add;
    UPDATE stores SET trial_ends_at = v_end, status = 'trial' WHERE id = p_store;
  ELSE
    v_base := GREATEST(COALESCE(s.valid_until, now()), now());
    v_end  := v_base + v_add;
    UPDATE stores SET valid_until = v_end,
                      status = CASE WHEN s.status = 'suspended' THEN 'suspended' ELSE 'active' END
    WHERE id = p_store;
  END IF;
  RETURN v_end;
END;
$$;

-- Suspender, reativar ou encerrar.
--   'suspended': bloqueia agora, mantém o tempo.
--   'active': reativa pago (se não há validade futura, passa p_days/p_hours; sem prazo = ilimitado só se p_unlimited).
--   'trial': volta ao teste (p_hours padrão 3).
--   'expired': encerra agora.
CREATE OR REPLACE FUNCTION public.admin_set_status(
  p_store UUID, p_status TEXT,
  p_hours INTEGER DEFAULT NULL, p_days INTEGER DEFAULT NULL, p_unlimited BOOLEAN DEFAULT false
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  s stores%ROWTYPE;
BEGIN
  PERFORM public._require_platform_admin();
  IF p_status NOT IN ('trial', 'active', 'suspended', 'expired') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;
  SELECT * INTO s FROM stores WHERE id = p_store;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;

  IF p_status = 'trial' THEN
    UPDATE stores SET status = 'trial', valid_until = NULL,
      trial_ends_at = now() + CASE
        WHEN p_days IS NOT NULL THEN make_interval(days => p_days)
        ELSE make_interval(hours => COALESCE(p_hours, 3)) END
    WHERE id = p_store;
  ELSIF p_status = 'active' THEN
    IF p_unlimited THEN
      UPDATE stores SET status = 'active', valid_until = NULL WHERE id = p_store;
    ELSIF p_days IS NOT NULL OR p_hours IS NOT NULL THEN
      UPDATE stores SET status = 'active',
        valid_until = now() + make_interval(days => COALESCE(p_days, 0), hours => COALESCE(p_hours, 0))
      WHERE id = p_store;
    ELSIF s.valid_until IS NOT NULL AND s.valid_until > now() THEN
      UPDATE stores SET status = 'active' WHERE id = p_store;
    ELSIF s.valid_until IS NULL AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now() THEN
      -- Era teste e ainda tem tempo: volta ao teste.
      UPDATE stores SET status = 'trial' WHERE id = p_store;
    ELSIF s.valid_until IS NULL AND s.trial_ends_at IS NULL THEN
      UPDATE stores SET status = 'active' WHERE id = p_store;
    ELSE
      RAISE EXCEPTION 'Sem validade futura: informe dias/horas ou marque sem prazo.';
    END IF;
  ELSIF p_status = 'expired' THEN
    UPDATE stores SET status = 'expired' WHERE id = p_store;
  ELSE
    UPDATE stores SET status = 'suspended' WHERE id = p_store;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_clients()
RETURNS TABLE (
  store_id UUID, name TEXT, contact_email TEXT, owner_email TEXT, plan TEXT, notes TEXT,
  status TEXT, effective_status TEXT, trial_ends_at TIMESTAMPTZ, valid_until TIMESTAMPTZ,
  seconds_remaining BIGINT, modules TEXT[], created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM public._require_platform_admin();
  RETURN QUERY
    SELECT s.id, s.name, s.contact_email,
           (SELECT u.email::TEXT FROM store_members m JOIN auth.users u ON u.id = m.user_id
             WHERE m.store_id = s.id AND m.role = 'OWNER' ORDER BY m.created_at LIMIT 1),
           s.plan, s.notes, s.status,
           public.store_effective_status(s.status, s.trial_ends_at, s.valid_until),
           s.trial_ends_at, s.valid_until,
           CASE
             WHEN s.status = 'trial'  THEN GREATEST(0, EXTRACT(EPOCH FROM (s.trial_ends_at - now()))::BIGINT)
             WHEN s.status = 'active' AND s.valid_until IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (s.valid_until - now()))::BIGINT)
             ELSE NULL
           END,
           COALESCE((SELECT array_agg(sm.module_key ORDER BY sm.module_key) FROM store_modules sm
                      WHERE sm.store_id = s.id AND sm.enabled), '{}'::TEXT[]),
           s.created_at
    FROM stores s
    WHERE s.is_active
    ORDER BY s.created_at DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4b. add_store_member endurecida
-- Antes (005), dono/gerente podia vincular QUALQUER e-mail com conta à sua
-- loja, inclusive o do administrador da plataforma. Agora:
--   * administrador da plataforma: qualquer papel, qualquer conta;
--   * dono/gerente: só reaplica permissões de um VENDEDOR que já pertence a
--     esta loja. Vínculo novo de conta existente exige o administrador (contas
--     novas nascem pela Edge Function manage-users). Mensagem única de recusa,
--     para não revelar quais e-mails têm conta.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_store_member(p_store UUID, p_email TEXT, p_role TEXT, p_permissions TEXT[] DEFAULT '{}')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user    UUID;
  v_current TEXT;
  v_refused CONSTANT TEXT := 'Não foi possível adicionar este e-mail. Solicite ao administrador da plataforma.';
BEGIN
  IF p_role NOT IN ('OWNER', 'MANAGER', 'SELLER') THEN
    RAISE EXCEPTION 'Papel inválido.';
  END IF;

  SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(trim(p_email));

  IF NOT public.is_platform_admin() THEN
    IF NOT public.is_store_manager(p_store) OR p_role <> 'SELLER' THEN
      RAISE EXCEPTION 'Dono e gerente só podem adicionar vendedores.';
    END IF;
    IF v_user IS NULL THEN
      RAISE EXCEPTION '%', v_refused;
    END IF;
    SELECT role INTO v_current FROM store_members WHERE store_id = p_store AND user_id = v_user;
    IF v_current IS DISTINCT FROM 'SELLER'
       OR COALESCE((SELECT is_platform_admin FROM profiles WHERE id = v_user), false) THEN
      RAISE EXCEPTION '%', v_refused;
    END IF;
  ELSIF v_user IS NULL THEN
    RAISE EXCEPTION 'Nenhuma conta com o e-mail %.', p_email;
  END IF;

  INSERT INTO store_members (store_id, user_id, role, permissions)
  VALUES (p_store, v_user, p_role, CASE WHEN p_role = 'SELLER' THEN COALESCE(p_permissions, '{}') ELSE '{}' END)
  ON CONFLICT (store_id, user_id) DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions;

  UPDATE profiles SET active_store_id = p_store WHERE id = v_user AND active_store_id IS NULL;
  RETURN v_user;
END;
$$;

REVOKE ALL ON FUNCTION public.add_store_member(UUID, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_store_member(UUID, TEXT, TEXT, TEXT[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Permissões
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._require_platform_admin()                                         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_client(TEXT, TEXT, TEXT[], TEXT, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_extend(UUID, INTEGER, INTEGER)                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_status(UUID, TEXT, INTEGER, INTEGER, BOOLEAN)           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_clients()                                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_store_access()                                                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_access_ok(UUID)                                             FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_create_client(TEXT, TEXT, TEXT[], TEXT, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend(UUID, INTEGER, INTEGER)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_status(UUID, TEXT, INTEGER, INTEGER, BOOLEAN)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_clients()                                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_store_access()                                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_access_ok(UUID)                                          TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

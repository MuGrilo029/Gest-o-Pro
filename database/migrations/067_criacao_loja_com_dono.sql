-- 067: criar loja sem sobra (pedido do dono de 27/11).
-- Antes: o painel criava a loja (admin_create_client) e depois o login (manage-users). Se o login falhava,
-- ficava uma loja sem dono. Agora a manage-users (ação create_store) cria o login primeiro e chama
-- admin_create_store_with_owner, que cria a loja e o vínculo do dono numa transação; se falhar, a função apaga o
-- login que ela mesma criou. request_id torna a repetição segura (stores.creation_request_id, único).
-- admin_create_client passa a recusar e-mail sem login (nunca mais cria loja órfã, nem pelo front antigo).
-- Nenhuma senha de conta existente é alterada.
-- Idempotente.

BEGIN;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS creation_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS stores_creation_request_uk ON public.stores (creation_request_id)
  WHERE creation_request_id IS NOT NULL;

-- Situação de um e-mail, para a função decidir antes de criar qualquer coisa. Só admin.
CREATE OR REPLACE FUNCTION public.admin_lookup_login(p_email text, p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_user uuid;
  v_marker text;
  v_signed boolean;
BEGIN
  PERFORM public._require_platform_admin();
  SELECT u.id, u.raw_app_meta_data->>'gp_store_request', u.last_sign_in_at IS NOT NULL
    INTO v_user, v_marker, v_signed FROM auth.users u WHERE lower(u.email) = v_email;
  RETURN jsonb_build_object(
    'user_id', v_user,
    'memberships', (SELECT count(*) FROM public.store_members m WHERE m.user_id = v_user),
    'owns_other_store', EXISTS (SELECT 1 FROM public.store_members m JOIN public.stores s ON s.id = m.store_id
                                 WHERE m.user_id = v_user AND m.role = 'OWNER'
                                   AND (p_request_id IS NULL OR s.creation_request_id IS DISTINCT FROM p_request_id)),
    'request_store_id', (SELECT s.id FROM public.stores s WHERE s.creation_request_id = p_request_id),
    'marker', v_marker,
    'signed_in', COALESCE(v_signed, false));
END $$;

CREATE OR REPLACE FUNCTION public.admin_create_store_with_owner(p_request_id uuid, p_owner uuid, p_store_name text,
  p_plan text, p_mode text DEFAULT 'trial', p_days integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_email text;
  v_store uuid;
  s public.stores%ROWTYPE;
BEGIN
  PERFORM public._require_platform_admin();
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Informe o identificador da requisição.'; END IF;
  IF p_plan IS NULL OR public._plan_rank(p_plan) IS NULL THEN
    RAISE EXCEPTION 'Plano inválido: %. Use inicio, crescimento ou avancado.', p_plan;
  END IF;
  IF p_days IS NOT NULL AND (p_days < 1 OR p_days > 3650) THEN RAISE EXCEPTION 'Prazo inválido (1 a 3650 dias).'; END IF;
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('create_store_request:' || p_request_id::text, 0));
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_owner;
  IF v_email IS NULL THEN RAISE EXCEPTION 'CONTA_INEXISTENTE: o login do dono não existe.' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO s FROM public.stores WHERE creation_request_id = p_request_id;
  IF FOUND THEN
    IF to_jsonb(s)->>'deleted_at' IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM public.store_members m WHERE m.store_id = s.id AND m.user_id = p_owner AND m.role = 'OWNER') THEN
      RAISE EXCEPTION 'REQUISICAO_REUTILIZADA: este pedido já foi usado em outra criação. Abra o formulário de novo.' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('store_id', s.id, 'already_created', true);
  END IF;

  -- Perfil ausente deixaria o dono sem entrar (login criado fora do gatilho).
  INSERT INTO public.profiles (id, email, name, roles) VALUES (p_owner, v_email, v_email, '{}') ON CONFLICT (id) DO NOTHING;

  SELECT c.store_id INTO v_store FROM public.admin_create_client(v_email, p_store_name, NULL, p_mode, NULL,
    CASE WHEN p_mode = 'paid' THEN COALESCE(p_days, 30) ELSE p_days END, p_plan, NULL) c;
  UPDATE public.stores SET creation_request_id = p_request_id, is_active = true WHERE id = v_store;
  -- Loja ativa: se o dono não tem nenhuma utilizável, passa a ser a nova.
  UPDATE public.profiles p SET active_store_id = v_store
   WHERE p.id = p_owner
     AND (p.active_store_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.store_members m JOIN public.stores x ON x.id = m.store_id AND x.is_active
             WHERE m.user_id = p_owner AND m.store_id = p.active_store_id));
  RETURN jsonb_build_object('store_id', v_store, 'already_created', false);
END $$;

CREATE OR REPLACE FUNCTION public.admin_create_client(p_email text, p_store_name text, p_modules text[] DEFAULT NULL::text[],
  p_mode text DEFAULT 'trial'::text, p_hours integer DEFAULT NULL::integer, p_days integer DEFAULT NULL::integer,
  p_plan text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
RETURNS TABLE(store_id uuid, account_exists boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
DECLARE
  v_store uuid;
  v_user  uuid;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_name  text := btrim(COALESCE(p_store_name, ''));
  v_end   timestamptz;
  v_plan  text := NULLIF(btrim(COALESCE(p_plan, '')), '');
  v_price integer;
BEGIN
  PERFORM public._require_platform_admin();
  IF v_email = '' OR v_email NOT LIKE '%_@_%._%' THEN RAISE EXCEPTION 'Informe um e-mail válido.'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'Informe o nome da loja.'; END IF;
  IF p_mode NOT IN ('trial', 'paid') THEN RAISE EXCEPTION 'Modo inválido (use trial ou paid).'; END IF;
  IF v_plan IS NOT NULL AND public._plan_rank(v_plan) IS NULL THEN
    RAISE EXCEPTION 'Plano inválido: %. Use inicio, crescimento ou avancado.', v_plan;
  END IF;
  IF p_mode = 'paid' AND v_plan IS NULL THEN RAISE EXCEPTION 'Loja paga precisa do plano (inicio, crescimento ou avancado).'; END IF;

  PERFORM pg_advisory_xact_lock(pg_catalog.hashtext('create_client:' || v_email));
  SELECT u.id INTO v_user FROM auth.users u WHERE lower(u.email) = v_email;
  -- 067: nunca cria loja sem dono. O login é criado antes, pela função manage-users (ação create_store).
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'CONTA_INEXISTENTE: este e-mail ainda não tem login. Crie a loja pelo painel, que cria o login junto.' USING ERRCODE = 'P0001';
  END IF;
  IF v_user IS NOT NULL AND EXISTS (SELECT 1 FROM public.store_members m WHERE m.user_id = v_user AND m.role = 'OWNER') THEN
    RAISE EXCEPTION 'UMA_LOJA_POR_DONO: esta conta já é dona de outra loja.' USING ERRCODE = 'P0001';
  END IF;

  -- Duração do trial segue a regra atual (bloqueada pelo dono): informada pelo admin ou 1 hora.
  IF p_mode = 'trial' THEN
    v_end := now() + CASE WHEN p_days IS NOT NULL THEN make_interval(days => p_days)
                          WHEN p_hours IS NOT NULL THEN make_interval(hours => p_hours)
                          ELSE interval '1 hour' END;
  ELSE
    v_end := now() + make_interval(days => COALESCE(p_days, 30));
  END IF;

  INSERT INTO public.stores (name, created_by, status, plan, is_trial, trial_ends_at, valid_until, contact_email, notes, billing_mode)
  VALUES (v_name, auth.uid(),
          CASE WHEN p_mode = 'trial' THEN 'trial' ELSE 'active' END,
          COALESCE(v_plan, 'trial'), p_mode = 'trial',
          CASE WHEN p_mode = 'trial' THEN v_end END,
          CASE WHEN p_mode = 'paid' THEN v_end END,
          v_email, p_notes, 'manual_contract')
  RETURNING id INTO v_store;

  INSERT INTO public.company_settings (store_id, name) VALUES (v_store, v_name);

  IF v_plan IS NOT NULL THEN
    SELECT pl.price_cents INTO v_price FROM public.plans pl WHERE pl.key = v_plan;
    INSERT INTO public.subscriptions (store_id, plan_id, status, price_cents, billing_cycle, current_period_start, current_period_end)
    VALUES (v_store, v_plan, CASE WHEN p_mode = 'trial' THEN 'trialing' ELSE 'active' END, COALESCE(v_price, 0), 'monthly', now(), v_end);
  END IF;

  PERFORM public.apply_plan_modules_internal(v_store, COALESCE(v_plan, 'trial'), auth.uid());

  IF v_user IS NOT NULL THEN
    INSERT INTO public.store_members (store_id, user_id, role) VALUES (v_store, v_user, 'OWNER')
    ON CONFLICT ON CONSTRAINT store_members_pkey DO UPDATE SET role = 'OWNER';
    UPDATE public.profiles SET active_store_id = v_store WHERE id = v_user AND active_store_id IS NULL;
  END IF;

  PERFORM public.admin_log_audit(v_store, 'create_store',
    jsonb_build_object('name', v_name, 'mode', p_mode, 'owner_email', v_email, 'owner_linked', v_user IS NOT NULL, 'plan', v_plan));

  RETURN QUERY SELECT v_store, v_user IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION public.admin_lookup_login(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_store_with_owner(uuid, uuid, text, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_client(text, text, text[], text, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_lookup_login(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_store_with_owner(uuid, uuid, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_client(text, text, text[], text, integer, integer, text, text) TO authenticated;

COMMIT;

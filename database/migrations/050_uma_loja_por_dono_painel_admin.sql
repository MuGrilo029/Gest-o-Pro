-- 050: um dono = uma loja; RPCs do painel admin (só o dono do SaaS: is_platform_admin).
-- Decisões do dono: 29, 30, 33 (sem papel de suporte), 34, 35, 37 (sem motivo e sem 2 etapas).
-- Cobrança adiada: loja paga criada pelo admin fica em billing_mode = 'manual_contract'
-- (o pagamento manual da 038 registra; nada vai ao Asaas).
-- Idempotente. Não altera linhas existentes: os donos que já têm duas lojas continuam com elas.

BEGIN;

-- 1) Um dono = uma loja (cadastro, admin e Edge Function passam por aqui).
CREATE OR REPLACE FUNCTION public.enforce_one_store_per_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM 'OWNER' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.role = 'OWNER' AND OLD.user_id = NEW.user_id AND OLD.store_id = NEW.store_id THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtext('owner:' || NEW.user_id::text));
  IF EXISTS (SELECT 1 FROM public.store_members m
              WHERE m.user_id = NEW.user_id AND m.role = 'OWNER' AND m.store_id <> NEW.store_id) THEN
    RAISE EXCEPTION 'UMA_LOJA_POR_DONO: esta conta já é dona de outra loja.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS store_members_one_store_per_owner ON public.store_members;
CREATE TRIGGER store_members_one_store_per_owner BEFORE INSERT OR UPDATE OF role, user_id, store_id ON public.store_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_one_store_per_owner();
REVOKE ALL ON FUNCTION public.enforce_one_store_per_owner() FROM PUBLIC, anon, authenticated;

-- 2) Criar loja (trial ou paga). Módulos vêm do plano (apply_plan_modules_internal), não de lista manual.
--    p_modules fica na assinatura por compatibilidade e é ignorado.
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

-- 3) Encerrar: com a cobrança adiada, loja de contrato manual (ou sem vínculo no gateway) encerra direto.
--    Loja com assinatura no Asaas segue o caminho da 032 (pedido de cancelamento no gateway).
CREATE OR REPLACE FUNCTION public.admin_close_store(p_store uuid, p_note text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  s public.stores%ROWTYPE;
  v_gw text;
  v_has_sub boolean;
  v_req uuid;
  v_enabled text;
BEGIN
  PERFORM public._require_platform_admin();
  SELECT * INTO s FROM public.stores WHERE id = p_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;

  SELECT sb.gateway_subscription_id INTO v_gw FROM public.subscriptions sb WHERE sb.store_id = p_store;
  v_has_sub := FOUND;

  IF NOT v_has_sub OR s.billing_mode = 'manual_contract' OR v_gw IS NULL THEN
    UPDATE public.stores SET status = 'expired' WHERE id = p_store;
    UPDATE public.subscriptions SET status = 'cancelled', updated_at = now() WHERE store_id = p_store;
    PERFORM public.admin_log_audit(p_store, 'close_store',
      jsonb_build_object('status_before', s.status, 'note', p_note,
                         'gateway_cancel', CASE WHEN v_has_sub THEN 'contrato_manual' ELSE 'sem_assinatura' END));
    RETURN jsonb_build_object('status', 'expired', 'gateway_request', NULL);
  END IF;

  SELECT bc.value INTO v_enabled FROM public.billing_config bc WHERE bc.key = 'billing_cancel_enabled';
  IF COALESCE(v_enabled, 'false') <> 'true' THEN
    RAISE EXCEPTION 'Encerramento de loja com assinatura no Asaas indisponível: o cancelamento no gateway ainda não está ativo. A loja continua ativa.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.billing_gateway_requests (store_id, kind, gateway_subscription_id, requested_by)
  VALUES (p_store, 'cancel_subscription', v_gw, auth.uid()) RETURNING id INTO v_req;
  PERFORM public.admin_log_audit(p_store, 'close_store_requested',
    jsonb_build_object('status_before', s.status, 'note', p_note, 'gateway_request', v_req, 'gateway_subscription_id', v_gw));
  RETURN jsonb_build_object('status', 'pendente_gateway', 'gateway_request', v_req);
END $$;

-- 4) Módulos da loja para a tela de override: estado efetivo, core e override vigente.
CREATE OR REPLACE FUNCTION public.admin_store_modules(p_store uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_plan text;
BEGIN
  PERFORM public._require_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store) THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
  v_plan := public._store_plan_for_modules(p_store);
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'module_key', mc.key, 'label', mc.label, 'core', mc.core,
             'plan_enabled', mc.core OR COALESCE(pm.enabled, false),
             'override', CASE WHEN mc.core THEN NULL ELSE ov.action END,
             'enabled', CASE WHEN mc.core THEN true WHEN ov.action = 'grant' THEN true WHEN ov.action = 'revoke' THEN false
                             ELSE COALESCE(pm.enabled, false) END)
           ORDER BY mc.core DESC, mc.label), '[]'::jsonb)
      FROM public.module_catalog mc
      LEFT JOIN public.plan_modules pm ON pm.plan_key = v_plan AND pm.module_key = mc.key
      LEFT JOIN LATERAL (
        SELECT o.action FROM public.store_module_overrides o
         WHERE o.store_id = p_store AND o.module_key = mc.key AND o.revoked_at IS NULL
           AND (o.expires_at IS NULL OR o.expires_at > now())
         ORDER BY o.created_at DESC LIMIT 1) ov ON true
     WHERE mc.active);
END $$;

-- 5) Ficha da loja (ações do painel): loja, assinatura, módulos e equipe.
CREATE OR REPLACE FUNCTION public.admin_store_detail(p_store uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_store jsonb;
  v_sub jsonb;
  v_members jsonb;
  v_payments integer;
BEGIN
  PERFORM public._require_platform_admin();
  SELECT jsonb_build_object('id', st.id, 'name', st.name, 'status', st.status, 'plan', st.plan,
                            'effective_status', public.store_effective_status(st.status, st.trial_ends_at, st.valid_until),
                            'trial_ends_at', st.trial_ends_at, 'valid_until', st.valid_until, 'billing_mode', st.billing_mode,
                            'monthly_value', st.monthly_value, 'contact_email', st.contact_email, 'created_at', st.created_at)
    INTO v_store FROM public.stores st WHERE st.id = p_store;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;

  SELECT jsonb_build_object('plan_id', sb.plan_id, 'status', sb.status, 'price_cents', sb.price_cents,
                            'billing_cycle', sb.billing_cycle, 'current_period_end', sb.current_period_end,
                            'cancel_at_period_end', sb.cancel_at_period_end, 'max_sellers', pl.max_sellers)
    INTO v_sub FROM public.subscriptions sb LEFT JOIN public.plans pl ON pl.key = sb.plan_id WHERE sb.store_id = p_store;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'name', COALESCE(p.name, u.email), 'role', m.role)
                            ORDER BY CASE m.role WHEN 'OWNER' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END, u.email), '[]'::jsonb)
    INTO v_members
    FROM public.store_members m JOIN auth.users u ON u.id = m.user_id LEFT JOIN public.profiles p ON p.id = m.user_id
   WHERE m.store_id = p_store;

  SELECT count(*)::integer INTO v_payments FROM public.subscription_payments sp WHERE sp.store_id = p_store;
  PERFORM public.admin_log_audit(p_store, 'view_store_detail', '{}'::jsonb);

  RETURN jsonb_build_object('loja', v_store, 'assinatura', v_sub, 'modulos', public.admin_store_modules(p_store),
                            'membros', v_members, 'limite_vendedores', public.store_seller_limit(p_store),
                            'pagamentos_legado', v_payments);
END $$;

-- 6) Lista de assinaturas: plano só de subscriptions.plan_id; dono, vendedores, limite, preço e ciclo; filtro q.
CREATE OR REPLACE FUNCTION public.admin_list_stores(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50,
  p_after_key timestamptz DEFAULT NULL::timestamptz, p_after_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_q text := NULLIF(lower(btrim(COALESCE(p_filters->>'q', ''))), '');
  v_items jsonb;
  v_count integer;
  v_last jsonb;
BEGIN
  PERFORM public._require_platform_admin();
  IF (p_after_key IS NULL) <> (p_after_id IS NULL) THEN RAISE EXCEPTION 'Cursor incompleto.'; END IF;

  WITH base AS (
    SELECT st.id, st.name, st.status,
           public.store_effective_status(st.status, st.trial_ends_at, st.valid_until) AS effective_status,
           sb.plan_id AS plano, sb.status AS assinatura_status, sb.price_cents, sb.billing_cycle,
           pl.max_sellers,
           (SELECT count(*)::integer FROM public.store_members m WHERE m.store_id = st.id AND m.role = 'SELLER') AS sellers_count,
           (SELECT u.email::text FROM public.store_members m JOIN auth.users u ON u.id = m.user_id
             WHERE m.store_id = st.id AND m.role = 'OWNER' ORDER BY m.created_at LIMIT 1) AS owner_email,
           COALESCE(sb.current_period_end, st.trial_ends_at, st.valid_until) AS fim,
           COALESCE(sb.current_period_end, st.trial_ends_at, st.valid_until, 'infinity'::timestamptz) AS chave,
           st.trial_ends_at, st.valid_until, st.billing_mode, st.created_at
      FROM public.stores st
      LEFT JOIN public.subscriptions sb ON sb.store_id = st.id
      LEFT JOIN public.plans pl ON pl.key = sb.plan_id
     WHERE (p_filters->>'status' IS NULL OR st.status = p_filters->>'status')
       AND (p_filters->>'plan' IS NULL OR sb.plan_id = p_filters->>'plan')
       AND (p_filters->>'em_teste' IS DISTINCT FROM 'true' OR st.status = 'trial')
       AND (p_filters->>'vencimento_ate' IS NULL
            OR COALESCE(sb.current_period_end, st.trial_ends_at, st.valid_until) <= (p_filters->>'vencimento_ate')::timestamptz)
  ),
  filtrada AS (
    SELECT b.* FROM base b
     WHERE v_q IS NULL OR position(v_q IN lower(b.name)) > 0 OR position(v_q IN lower(COALESCE(b.owner_email, ''))) > 0
  ),
  pagina AS (
    SELECT f.* FROM filtrada f
     WHERE p_after_key IS NULL OR (f.chave, f.id) > (p_after_key, p_after_id)
     ORDER BY f.chave, f.id
     LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.chave, p.id), '[]'::jsonb), count(*)::integer
    INTO v_items, v_count FROM pagina p;

  v_last := CASE WHEN v_count > 0 THEN v_items -> (v_count - 1) ELSE NULL END;
  RETURN jsonb_build_object('items', v_items, 'count', v_count, 'has_more', v_count = v_limit,
    'next_after_key', CASE WHEN v_count = v_limit THEN v_last ->> 'chave' ELSE NULL END,
    'next_after_id', CASE WHEN v_count = v_limit THEN v_last ->> 'id' ELSE NULL END);
END $$;

REVOKE ALL ON FUNCTION public.admin_create_client(text, text, text[], text, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_client(text, text, text[], text, integer, integer, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_close_store(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_store(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_store_modules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_store_modules(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_store_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_store_detail(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_list_stores(jsonb, integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_stores(jsonb, integer, timestamptz, uuid) TO authenticated;

COMMIT;

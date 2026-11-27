-- 049: limite de vendedores no banco e troca de plano pelo admin.
-- Decisões do dono: 4 (excesso bloqueia; downgrade obriga excluir) e 34 (trocar plano).
-- Cobrança adiada (5–12): a troca de plano feita pelo admin vale na hora (upgrade e downgrade),
-- sem pró-rata nem checkout. O caminho de upgrade pago da 037 (pending + webhook) fica no banco, sem uso.
-- Idempotente. Não altera linhas existentes: vendedores já acima do limite continuam; só bloqueia novos.

BEGIN;

-- Limite efetivo da loja: plano da assinatura (qualquer status) ou o do trial (Avançado). NULL = sem limite.
CREATE OR REPLACE FUNCTION public.store_seller_limit(p_store uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT pl.max_sellers FROM public.plans pl WHERE pl.key = public._store_plan_for_modules(p_store)
$$;

CREATE OR REPLACE FUNCTION public.enforce_seller_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_max integer;
  v_count integer;
BEGIN
  IF NEW.role IS DISTINCT FROM 'SELLER' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.role = 'SELLER' AND OLD.store_id = NEW.store_id THEN RETURN NEW; END IF;

  -- Serializa inclusões na mesma loja (duas abas não passam do limite juntas).
  PERFORM 1 FROM public.stores st WHERE st.id = NEW.store_id FOR UPDATE;

  v_max := public.store_seller_limit(NEW.store_id);
  IF v_max IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM public.store_members m
   WHERE m.store_id = NEW.store_id AND m.role = 'SELLER' AND m.user_id <> NEW.user_id;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'LIMITE_VENDEDORES: o plano da loja permite % vendedor(es) e a loja já tem %.', v_max, v_count
      USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('limite', v_max, 'atuais', v_count, 'excedentes', 0)::text;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS store_members_seller_limit ON public.store_members;
CREATE TRIGGER store_members_seller_limit BEFORE INSERT OR UPDATE OF role, store_id ON public.store_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_seller_limit();

-- Prévia da troca: quantos vendedores precisam sair para caber no plano de destino.
CREATE OR REPLACE FUNCTION public.admin_plan_change_preview(p_store uuid, p_plan text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_limit integer;
  v_sellers integer;
BEGIN
  PERFORM public._require_platform_admin();
  IF public._plan_rank(p_plan) IS NULL THEN RAISE EXCEPTION 'Plano inválido: %. Use inicio, crescimento ou avancado.', p_plan; END IF;
  SELECT pl.max_sellers INTO v_limit FROM public.plans pl WHERE pl.key = p_plan;
  SELECT count(*)::integer INTO v_sellers FROM public.store_members m WHERE m.store_id = p_store AND m.role = 'SELLER';
  RETURN jsonb_build_object('plan', p_plan, 'limite', v_limit, 'atuais', v_sellers,
                            'excedentes', CASE WHEN v_limit IS NULL THEN 0 ELSE GREATEST(v_sellers - v_limit, 0) END);
END $$;

-- Troca de plano pelo admin: vale na hora. Downgrade recusado enquanto houver vendedores acima do limite.
-- Loja sem assinatura (trial ou legado) ganha a linha em subscriptions aqui.
CREATE OR REPLACE FUNCTION public.admin_request_plan_change(p_store uuid, p_plan text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  st public.stores%ROWTYPE;
  v_cur text;
  v_price integer;
  v_limit integer;
  v_sellers integer;
  v_kind text;
BEGIN
  PERFORM public._require_platform_admin();
  IF public._plan_rank(p_plan) IS NULL THEN RAISE EXCEPTION 'Plano inválido: %. Use inicio, crescimento ou avancado.', p_plan; END IF;
  SELECT * INTO st FROM public.stores WHERE id = p_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
  IF st.status = 'expired' THEN RAISE EXCEPTION 'Loja encerrada: não há troca de plano.'; END IF;

  SELECT sb.plan_id INTO v_cur FROM public.subscriptions sb WHERE sb.store_id = p_store;
  IF v_cur = p_plan THEN RAISE EXCEPTION 'A loja já está no plano %.', p_plan; END IF;

  SELECT pl.max_sellers, pl.price_cents INTO v_limit, v_price FROM public.plans pl WHERE pl.key = p_plan;
  SELECT count(*)::integer INTO v_sellers FROM public.store_members m WHERE m.store_id = p_store AND m.role = 'SELLER';
  IF v_limit IS NOT NULL AND v_sellers > v_limit THEN
    RAISE EXCEPTION 'LIMITE_VENDEDORES: remova % vendedor(es) antes de mudar para o plano % (limite %, a loja tem %).',
      v_sellers - v_limit, p_plan, v_limit, v_sellers
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('limite', v_limit, 'atuais', v_sellers, 'excedentes', v_sellers - v_limit)::text;
  END IF;

  v_kind := CASE WHEN v_cur IS NULL OR public._plan_rank(v_cur) IS NULL THEN 'definicao'
                 WHEN public._plan_rank(p_plan) > public._plan_rank(v_cur) THEN 'upgrade' ELSE 'downgrade' END;

  INSERT INTO public.subscriptions (store_id, plan_id, status, price_cents, billing_cycle, current_period_start, current_period_end)
  VALUES (p_store, p_plan, CASE WHEN st.status = 'trial' THEN 'trialing' ELSE 'active' END, COALESCE(v_price, 0), 'monthly',
          now(), COALESCE(st.valid_until, st.trial_ends_at, now() + interval '30 days'))
  ON CONFLICT (store_id) DO UPDATE
     SET plan_id = EXCLUDED.plan_id, price_cents = EXCLUDED.price_cents,
         pending_plan = NULL, pending_plan_at = NULL, pending_kind = NULL, pending_amount_cents = NULL, updated_at = now();

  UPDATE public.stores SET plan = p_plan WHERE id = p_store;
  PERFORM public.apply_store_modules(p_store);
  PERFORM public.admin_log_audit(p_store, 'plan_changed', jsonb_build_object('from', v_cur, 'to', p_plan, 'kind', v_kind));
  RETURN jsonb_build_object('kind', v_kind, 'status', 'aplicado', 'effective', now(), 'plan', p_plan);
END $$;

-- admin_set_plan (legado: gravava texto livre em stores.plan) sai. Troca de plano é admin_request_plan_change.
DROP FUNCTION IF EXISTS public.admin_set_plan(uuid, text, numeric);

-- Uso interno (gatilho). O front lê o limite em plans.max_sellers (leitura pública).
REVOKE ALL ON FUNCTION public.store_seller_limit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_plan_change_preview(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_plan_change_preview(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_request_plan_change(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_request_plan_change(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.enforce_seller_limit() FROM PUBLIC, anon, authenticated;

COMMIT;

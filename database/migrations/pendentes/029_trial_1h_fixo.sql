-- 029-trial-1h-fixo.sql (NÃO aplicar antes da revisão do SecOps e do teste verde em ROLLBACK)
-- Decisão do usuário: teste grátis SEMPRE de 1 hora na criação. O valor de horas/dias informado pelo admin
-- é ignorado no trial. Estender continua valendo (admin_extend não muda).
-- Corrige a 022 (já aplicada): admin_create_client e admin_set_status passam a usar 1 hora fixa no trial.
-- Assinaturas e demais ramos (plano pago, ativo, suspenso, expirado) não mudam.
-- Aditiva: CREATE OR REPLACE com as mesmas assinaturas.

CREATE OR REPLACE FUNCTION public.admin_set_status(p_store uuid, p_status text, p_hours integer DEFAULT NULL::integer, p_days integer DEFAULT NULL::integer, p_unlimited boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    -- Trial é sempre de 1 hora: horas e dias informados são ignorados aqui.
    UPDATE stores SET status = 'trial', valid_until = NULL,
      trial_ends_at = now() + interval '1 hour'
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

  -- Sem log, sem ação: se o log falhar, a função inteira é desfeita.
  PERFORM public.admin_log_audit(p_store, 'set_status',
    jsonb_build_object('status', p_status, 'hours', p_hours, 'days', p_days, 'unlimited', p_unlimited));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_client(p_email text, p_store_name text, p_modules text[] DEFAULT NULL::text[], p_mode text DEFAULT 'trial'::text, p_hours integer DEFAULT NULL::integer, p_days integer DEFAULT NULL::integer, p_plan text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
RETURNS TABLE(store_id uuid, account_exists boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    -- Teste grátis: sempre 1 hora. Horas e dias informados são ignorados na criação.
    v_end := now() + interval '1 hour';
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

  PERFORM public.admin_log_audit(v_store, 'create_store',
    jsonb_build_object('name', trim(p_store_name), 'mode', p_mode, 'owner_email', v_email,
                       'owner_linked', v_user IS NOT NULL, 'plan', p_plan));

  RETURN QUERY SELECT v_store, v_user IS NOT NULL;
END;
$function$;

-- Verificação pós-aplicação: trial sem 3 h e sem valor informado
SELECT p.proname,
       position('interval ''1 hour''' in pg_get_functiondef(p.oid)) > 0 AS trial_1h_fixo,
       position('COALESCE(p_hours, 1)' in pg_get_functiondef(p.oid)) > 0 AS ainda_usa_valor_informado
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('admin_set_status', 'admin_create_client');

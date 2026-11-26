-- 021: auditoria OBRIGATÓRIA das ações do admin e retenção de 5 anos do log
-- RASCUNHO: NÃO aplicado. Testar em ROLLBACK antes.
--
-- (1) Cada ação do admin grava em admin_audit_logs na MESMA transação. Se o log falhar, a ação falha
--     (sem log, sem ação). Usa public.admin_log_audit (migração 009), que confere is_platform_admin.
--     Funções atualizadas aqui: admin_set_status, admin_extend, admin_create_client.
--     As funções da 018 (plano, conversão, pagamento) já gravam pelo mesmo caminho quando a 018 for aplicada.
-- (2) Retenção: o log não pode ser apagado antes de 5 anos, nem por service role (trigger no banco).

-- ---------------------------------------------------------------------------
-- (1) Ações do admin com auditoria obrigatória
-- ---------------------------------------------------------------------------

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

CREATE OR REPLACE FUNCTION public.admin_extend(p_store uuid, p_hours integer DEFAULT NULL::integer, p_days integer DEFAULT NULL::integer)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  PERFORM public.admin_log_audit(p_store, 'extend',
    jsonb_build_object('hours', p_hours, 'days', p_days, 'new_end', v_end));
  RETURN v_end;
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

  PERFORM public.admin_log_audit(v_store, 'create_store',
    jsonb_build_object('name', trim(p_store_name), 'mode', p_mode, 'owner_email', v_email,
                       'owner_linked', v_user IS NOT NULL, 'plan', p_plan));

  RETURN QUERY SELECT v_store, v_user IS NOT NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- (2) Retenção de 5 anos: nada é apagado do log antes disso (vale para qualquer papel)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_audit_logs_retention_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $f$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'O log de auditoria do admin não pode ser truncado (retenção de 5 anos).';
  END IF;
  IF OLD.created_at > now() - interval '5 years' THEN
    RAISE EXCEPTION 'Registro do log de auditoria com menos de 5 anos não pode ser apagado.';
  END IF;
  RETURN OLD;
END
$f$;

DROP TRIGGER IF EXISTS admin_audit_logs_no_early_delete ON public.admin_audit_logs;
CREATE TRIGGER admin_audit_logs_no_early_delete
  BEFORE DELETE ON public.admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_logs_retention_guard();

DROP TRIGGER IF EXISTS admin_audit_logs_no_truncate ON public.admin_audit_logs;
CREATE TRIGGER admin_audit_logs_no_truncate
  BEFORE TRUNCATE ON public.admin_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.admin_audit_logs_retention_guard();

REVOKE ALL ON FUNCTION public.admin_audit_logs_retention_guard() FROM PUBLIC, anon, authenticated;

-- Função de log da 009 (não tinha revogação de anon). Continua checando is_platform_admin no corpo.
REVOKE ALL ON FUNCTION public.admin_log_audit(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_log_audit(uuid, text, jsonb) TO authenticated;

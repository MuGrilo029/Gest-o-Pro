-- 015: proteção básica do teste grátis sem captcha agora (decisão CEO/CTO)
-- Aditiva: nova coluna, nova tabela de configuração e nova assinatura da RPC.
-- Não altera nem apaga dados de lojas, usuários ou produtos.
--
-- Regras da start_self_trial:
--  1) login obrigatório; e-mail precisa estar confirmado (email_confirmed_at);
--  2) uma loja por conta (já existe OWNER -> recusa);
--  3) limite de 3 cadastros por IP em 24 h (HMAC do último hop de x-forwarded-for);
--  4) limite de 1 teste por e-mail, para sempre (HMAC do e-mail normalizado);
--  5) ponto de integração do Cloudflare Turnstile: se private.app_settings.turnstile_enforced = 'true',
--     exige p_captcha_token não vazio. A VERIFICAÇÃO do token no servidor (siteverify) é feita por uma
--     Edge Function antes da chamada; a chave TURNSTILE_SECRET_KEY NÃO está configurada ainda (ausente).
--     Enquanto turnstile_enforced = 'false', o token é ignorado.

-- Escopo do registro de limite: 'ip' ou 'email' (linhas antigas ficam como 'ip').
ALTER TABLE public.signup_rate_limit ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'ip';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signup_rate_limit_scope_check' AND conrelid = 'public.signup_rate_limit'::regclass
  ) THEN
    ALTER TABLE public.signup_rate_limit
      ADD CONSTRAINT signup_rate_limit_scope_check CHECK (scope IN ('ip', 'email'));
  END IF;
END $$;

-- Configuração do servidor, fora da API. Chave secreta do Turnstile NÃO fica aqui.
CREATE TABLE IF NOT EXISTS private.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO private.app_settings (key, value) VALUES
  ('turnstile_enforced', 'false'),
  ('turnstile_site_key', '')
ON CONFLICT (key) DO NOTHING;
REVOKE ALL ON private.app_settings FROM PUBLIC, anon, authenticated;

-- Nova assinatura: o token do captcha entra como parâmetro opcional.
CREATE OR REPLACE FUNCTION public.start_self_trial(p_name text, p_captcha_token text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid       uuid;
  v_email     text;
  v_confirmed timestamptz;
  v_name      text := trim(coalesce(p_name, ''));
  v_enforced  text;
  v_xff       text;
  v_ip        text;
  v_key       bytea;
  v_ip_hash   text;
  v_mail_hash text;
  v_count     int;
  v_store     uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Faça login para iniciar o teste grátis.' USING ERRCODE = '42501';
  END IF;

  SELECT u.email, u.email_confirmed_at INTO v_email, v_confirmed
  FROM auth.users u WHERE u.id = v_uid;

  IF v_confirmed IS NULL THEN
    RAISE EXCEPTION 'Confirme seu e-mail antes de iniciar o teste grátis.' USING ERRCODE = '42501';
  END IF;

  IF length(v_name) < 2 OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'Informe o nome da loja (de 2 a 100 caracteres).';
  END IF;

  -- Ponto de integração Turnstile: exige token quando a verificação estiver ligada.
  SELECT s.value INTO v_enforced FROM private.app_settings s WHERE s.key = 'turnstile_enforced';
  IF coalesce(v_enforced, 'false') = 'true' AND nullif(trim(coalesce(p_captcha_token, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Confirme que você não é um robô para iniciar o teste grátis.' USING ERRCODE = '42501';
  END IF;

  -- Serializa cadastros da mesma conta (duplo clique não cria duas lojas).
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text));

  IF EXISTS (
    SELECT 1 FROM public.store_members m WHERE m.user_id = v_uid AND m.role = 'OWNER'
  ) THEN
    RAISE EXCEPTION 'Esta conta já possui uma loja. Entre nela ou fale com a gente no WhatsApp.';
  END IF;

  SELECT k.hmac_key INTO v_key FROM private.signup_keys k WHERE k.id = 1;

  -- Limite por IP: 3 em 24 h. Último hop de x-forwarded-for (acrescentado pela borda).
  v_xff := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json->>'x-forwarded-for';
  v_ip := coalesce(
    nullif(trim(regexp_replace(coalesce(v_xff, ''), '^.*,\s*', '')), ''),
    'desconhecido'
  );
  v_ip_hash := encode(extensions.hmac(convert_to(v_ip, 'UTF8'), v_key, 'sha256'), 'hex');

  SELECT count(*) INTO v_count
  FROM public.signup_rate_limit r
  WHERE r.scope = 'ip' AND r.ip_hash = v_ip_hash AND r.created_at > now() - interval '24 hours';

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'Muitos cadastros deste endereço nas últimas 24 horas. Fale com a gente no WhatsApp.';
  END IF;

  -- Limite por e-mail: 1 teste por e-mail, para sempre.
  v_mail_hash := encode(
    extensions.hmac(convert_to(lower(trim(coalesce(v_email, ''))), 'UTF8'), v_key, 'sha256'),
    'hex'
  );

  SELECT count(*) INTO v_count
  FROM public.signup_rate_limit r
  WHERE r.scope = 'email' AND r.ip_hash = v_mail_hash;

  IF v_count >= 1 THEN
    RAISE EXCEPTION 'Este e-mail já usou o teste grátis. Fale com a gente no WhatsApp para assinar.';
  END IF;

  INSERT INTO public.signup_rate_limit (ip_hash, scope) VALUES (v_ip_hash, 'ip');
  INSERT INTO public.signup_rate_limit (ip_hash, scope) VALUES (v_mail_hash, 'email');

  -- Loja em teste: 1 hora a partir do cadastro, sem fidelidade. Prazo vem só do servidor.
  INSERT INTO public.stores (name, created_by, status, is_active, is_trial, trial_ends_at)
  VALUES (v_name, v_uid, 'trial', true, true, now() + interval '1 hour')
  RETURNING id INTO v_store;

  INSERT INTO public.store_members (store_id, user_id, role, permissions)
  VALUES (v_store, v_uid, 'OWNER', '{}');

  INSERT INTO public.company_settings (store_id, name) VALUES (v_store, v_name);

  UPDATE public.profiles SET active_store_id = v_store WHERE id = v_uid;

  RETURN v_store;
END;
$function$;

-- Remove a assinatura anterior (sem token). Nenhum dado depende dela.
DROP FUNCTION IF EXISTS public.start_self_trial(text);

REVOKE ALL ON FUNCTION public.start_self_trial(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_self_trial(text, text) TO authenticated;

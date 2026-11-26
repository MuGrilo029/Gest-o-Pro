-- 013: endurecimento do cadastro com teste grátis de 1 h (ajustes de Arquitetura e SecOps sobre a 012)
-- Aditiva: schema e tabela novos; CREATE OR REPLACE da função criada na 012. Sem alterar dados existentes.
--
-- Mudanças em relação à 012:
--  a) exige auth.users.email_confirmed_at preenchido;
--  b) não insere mais em profiles (o trigger on_auth_user_created já cria o perfil);
--  c) lock por usuário antes de checar a loja (corrida no duplo clique);
--  d) SET search_path = '' com nomes qualificados; EXECUTE só para authenticated;
--  e) IP: usa o último valor de x-forwarded-for (hop confiável, não o primeiro, que o cliente forja);
--     guarda HMAC-SHA256 com chave do servidor (não sha256 simples, que se reverte por enumeração de IPv4).
--     A chave fica em schema private, não exposto pela API.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.signup_keys (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  hmac_key bytea NOT NULL
);
INSERT INTO private.signup_keys (id, hmac_key)
VALUES (1, extensions.gen_random_bytes(32))
ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON private.signup_keys FROM PUBLIC, anon, authenticated;

-- Hashes gravados antes desta versão (sha256 simples) não batem com HMAC; a tabela
-- signup_rate_limit estava vazia quando esta migração foi escrita, então não há o que converter.

CREATE OR REPLACE FUNCTION public.start_self_trial(p_name text)
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
  v_xff       text;
  v_ip        text;
  v_key       bytea;
  v_hash      text;
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

  -- Serializa cadastros da mesma conta (duplo clique não cria duas lojas).
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text));

  IF EXISTS (
    SELECT 1 FROM public.store_members m WHERE m.user_id = v_uid AND m.role = 'OWNER'
  ) THEN
    RAISE EXCEPTION 'Esta conta já possui uma loja. Entre nela ou fale com a gente no WhatsApp.';
  END IF;

  -- IP: último valor de x-forwarded-for (acrescentado pela borda do Supabase).
  v_xff := coalesce(
    nullif(current_setting('request.headers', true), ''),
    '{}'
  )::json->>'x-forwarded-for';
  v_ip := coalesce(
    nullif(trim(regexp_replace(coalesce(v_xff, ''), '^.*,\s*', '')), ''),
    'desconhecido'
  );

  SELECT k.hmac_key INTO v_key FROM private.signup_keys k WHERE k.id = 1;
  v_hash := encode(extensions.hmac(convert_to(v_ip, 'UTF8'), v_key, 'sha256'), 'hex');

  SELECT count(*) INTO v_count
  FROM public.signup_rate_limit r
  WHERE r.ip_hash = v_hash AND r.created_at > now() - interval '24 hours';

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'Muitos cadastros deste endereço nas últimas 24 horas. Fale com a gente no WhatsApp.';
  END IF;

  INSERT INTO public.signup_rate_limit (ip_hash) VALUES (v_hash);

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

REVOKE ALL ON FUNCTION public.start_self_trial(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_self_trial(text) TO authenticated;

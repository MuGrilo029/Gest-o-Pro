-- 012: teste grátis de 1 hora com cadastro próprio (loja + dono criados pelo cliente)
-- Aditiva: só ADD COLUMN IF NOT EXISTS, CREATE TABLE/FUNCTION novos. Não apaga nem altera dados.
-- Reaproveita stores.trial_ends_at e store_effective_status()/store_access_ok() (migração 006):
-- o prazo de 1 hora é gravado em trial_ends_at, então o bloqueio continua pelo RLS.

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false;

-- Anti-abuso por endereço: guarda só o hash do IP (sha256), nunca o IP em claro.
CREATE TABLE IF NOT EXISTS public.signup_rate_limit (
  id bigserial PRIMARY KEY,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signup_rate_limit_ip_created_idx ON public.signup_rate_limit (ip_hash, created_at);

ALTER TABLE public.signup_rate_limit ENABLE ROW LEVEL SECURITY;
-- Sem policies: nenhum cliente lê ou escreve direto; só a função abaixo (SECURITY DEFINER).
REVOKE ALL ON public.signup_rate_limit FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_self_trial(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_name  text := trim(coalesce(p_name, ''));
  v_email text;
  v_ip    text;
  v_hash  text;
  v_count int;
  v_store uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Faça login para iniciar o teste grátis.' USING ERRCODE = '42501';
  END IF;

  IF length(v_name) < 2 OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'Informe o nome da loja (de 2 a 100 caracteres).';
  END IF;

  -- Serializa cadastros da mesma conta (evita duplo clique criar duas lojas).
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  -- Uma loja por conta.
  IF EXISTS (SELECT 1 FROM store_members WHERE user_id = v_uid AND role = 'OWNER') THEN
    RAISE EXCEPTION 'Esta conta já possui uma loja. Entre nela ou fale com a gente no WhatsApp.';
  END IF;

  -- Limite de 3 cadastros por IP em 24 horas (best effort: depende do cabeçalho x-forwarded-for).
  v_ip := coalesce(
    nullif(split_part(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json->>'x-forwarded-for', ',', 1), ''),
    'desconhecido'
  );
  v_hash := encode(sha256(convert_to(trim(v_ip), 'UTF8')), 'hex');

  SELECT count(*) INTO v_count
  FROM signup_rate_limit
  WHERE ip_hash = v_hash AND created_at > now() - interval '24 hours';

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'Muitos cadastros deste endereço nas últimas 24 horas. Fale com a gente no WhatsApp.';
  END IF;

  INSERT INTO signup_rate_limit (ip_hash) VALUES (v_hash);

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  INSERT INTO profiles (id, email) VALUES (v_uid, v_email)
  ON CONFLICT (id) DO NOTHING;

  -- Loja em teste: 1 hora a partir do cadastro, sem fidelidade.
  INSERT INTO stores (name, created_by, status, is_active, is_trial, trial_ends_at)
  VALUES (v_name, v_uid, 'trial', true, true, now() + interval '1 hour')
  RETURNING id INTO v_store;

  INSERT INTO store_members (store_id, user_id, role, permissions)
  VALUES (v_store, v_uid, 'OWNER', '{}');

  INSERT INTO company_settings (store_id, name) VALUES (v_store, v_name);

  UPDATE profiles SET active_store_id = v_store WHERE id = v_uid;

  RETURN v_store;
END;
$function$;

REVOKE ALL ON FUNCTION public.start_self_trial(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_self_trial(text) TO authenticated;

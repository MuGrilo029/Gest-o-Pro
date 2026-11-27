-- Stubs mínimos do Supabase para rodar as migrações no PGlite (só teste local).
-- auth.uid()/auth.role()/auth.jwt() leem as configurações request.jwt.claim.* da sessão, como no PostgREST.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN CREATE ROLE supabase_storage_admin NOLOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE SCHEMA IF NOT EXISTS net;
CREATE SCHEMA IF NOT EXISTS vault;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  encrypted_password text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  email_confirmed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_sign_in_at timestamptz
);

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT jsonb_build_object('sub', auth.uid(), 'role', auth.role()) $$;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text, owner uuid, owner_id text, metadata jsonb, path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;

-- pgcrypto mínimo (só o que as migrações usam)
CREATE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql VOLATILE AS
$$ SELECT decode(substr(repeat(md5(random()::text), (n / 16) + 1), 1, n * 2), 'hex') $$;
CREATE FUNCTION extensions.hmac(data text, key text, type text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
$$ SELECT decode(md5(key || data), 'hex') $$;
CREATE FUNCTION extensions.hmac(data bytea, key bytea, type text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
$$ SELECT decode(md5(encode(key, 'hex') || encode(data, 'hex')), 'hex') $$;

-- pg_cron e pg_net: não executam nada no teste
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
   ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS
$$ WITH d AS (DELETE FROM cron.job WHERE jobname = job_name RETURNING 1) SELECT count(*) > 0 FROM d $$;
CREATE TABLE net.requests (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, created_at timestamptz DEFAULT now());
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO net.requests (url, body, headers) VALUES (url, body, headers) RETURNING id $$;
CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text);

GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth, storage, extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- Objeto que existe em produção fora das migrações (gatilho "ensure_rls" do painel do Supabase).
-- A 017 revoga EXECUTE dele; o corpo aqui é só para a 017 rodar.
CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $$ BEGIN NULL; END; $$;

-- Papel de conexão do PostgREST: os testes trocam a sessão para ele (session_user deixa de ser postgres).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator NOINHERIT LOGIN; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;

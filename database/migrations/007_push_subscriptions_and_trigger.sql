-- ============================================================================
-- 007_push_subscriptions_and_trigger.sql
-- Versão SEGURA da 001: não apaga nada (sem DROP TABLE ... CASCADE).
--   * push_subscriptions (IF NOT EXISTS) + RLS: cada usuário gerencia só as suas.
--   * Gatilho de venda -> Edge Function send-push-notification do projeto
--     yfyckreoprwfwhjadfkl, autenticado pelo cabeçalho x-webhook-secret.
--   * O segredo NÃO fica neste arquivo: vive no Vault (nome push_webhook_secret)
--     e, com o mesmo valor, em Edge Functions > Secrets > PUSH_WEBHOOK_SECRET.
-- A função deve estar publicada com --no-verify-jwt (o gatilho não envia JWT;
-- a própria função exige o segredo). O front não chama a função para a mesma
-- venda, então não há push duplicado.
-- Seguro para rodar mais de uma vez.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  auth       TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT push_subscriptions_user_idx UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.push_subscriptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.push_subscriptions_id_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.update_push_subscriptions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_push_subscriptions_updated_at_trigger ON public.push_subscriptions;
CREATE TRIGGER update_push_subscriptions_updated_at_trigger
BEFORE UPDATE ON public.push_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_push_subscriptions_updated_at();

-- Gatilho de venda ---------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.tr_venda_finalizada_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'push_webhook_secret' LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE WARNING 'push_webhook_secret ausente no Vault';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://yfyckreoprwfwhjadfkl.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object('type', TG_OP, 'record', jsonb_build_object('id', NEW.id))
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca derruba a venda por falha de notificação.
  RAISE WARNING 'Falha ao acionar push notification: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tr_venda_finalizada_push() FROM PUBLIC;

DROP TRIGGER IF EXISTS tg_push_venda_finalizada ON public.sales;
CREATE TRIGGER tg_push_venda_finalizada
AFTER INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.tr_venda_finalizada_push();

COMMIT;

NOTIFY pgrst, 'reload schema';

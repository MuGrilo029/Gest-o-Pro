-- 042-guarda-process-billing-apply.sql
-- Guarda de loja encerrada DENTRO do banco (SecOps 041, condição 1).
-- Hoje só a Edge checa billing_store_closed; process_billing_event reativaria loja encerrada se chamado com service_role.
-- Esta migração não reescreve o corpo da 024: renomeia a função original para _process_billing_event_core
-- (mantém os GRANTs) e cria process_billing_event como wrapper que:
--   - para 'confirmed' e 'late', se a loja está 'expired' ou tem cancelamento confirmado no gateway,
--     responde 'ignorado: loja encerrada' e NÃO altera nada;
--   - caso contrário, chama a função original.
-- PRÉ-REQUISITO: 024 aplicada; 032 (billing_gateway_requests) para a checagem de cancelamento confirmado.
-- Idempotente: se já renomeada, só recria o wrapper.
-- NÃO EXECUTAR em produção antes do teste verde em ROLLBACK, da revisão da SecOps e da autorização do usuário.

DO $pre$
BEGIN
  IF to_regprocedure('public.process_billing_event(text,text,uuid,text,timestamptz,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: process_billing_event (024).';
  END IF;
END
$pre$;

DO $r$
BEGIN
  IF to_regprocedure('public._process_billing_event_core(text,text,uuid,text,timestamptz,integer,text)') IS NULL THEN
    ALTER FUNCTION public.process_billing_event(text, text, uuid, text, timestamptz, integer, text)
      RENAME TO _process_billing_event_core;
  END IF;
END
$r$;

CREATE OR REPLACE FUNCTION public.process_billing_event(
  p_event_id text, p_type text, p_store uuid, p_plan text, p_period_end timestamptz,
  p_grace_days integer DEFAULT 5, p_gateway_subscription text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
BEGIN
  IF p_type IN ('confirmed', 'late') AND (
       EXISTS (SELECT 1 FROM public.stores st WHERE st.id = p_store AND st.status = 'expired')
    OR EXISTS (SELECT 1 FROM public.billing_gateway_requests g
                WHERE g.store_id = p_store AND g.kind = 'cancel_subscription' AND g.status = 'done')
  ) THEN
    RETURN 'ignorado: loja encerrada';
  END IF;
  RETURN public._process_billing_event_core(p_event_id, p_type, p_store, p_plan, p_period_end, p_grace_days, p_gateway_subscription);
END
$f$;

REVOKE ALL ON FUNCTION public.process_billing_event(text, text, uuid, text, timestamptz, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_billing_event(text, text, uuid, text, timestamptz, integer, text) TO service_role;
REVOKE ALL ON FUNCTION public._process_billing_event_core(text, text, uuid, text, timestamptz, integer, text) FROM PUBLIC, anon, authenticated;

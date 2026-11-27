-- 040-agendamento-jobs-apply.sql (revisão 2: pg_cron autorizado pelo usuário)
-- Agendamento (pg_cron) dos jobs de servidor:
--   - expire-billing-grace: suspende lojas com carência de atraso vencida (024/039). Diário, 06:00 UTC (03:00 Brasília).
--   - expire-module-overrides: recalcula o cache de cortesias (overrides) vencidas (036). De hora em hora.
--   - apply-pending-plan-changes: aplica downgrades vencidos no fim do ciclo (037). De hora em hora.
-- PRÉ-REQUISITOS (ordem): 024 → 039 (corpo corrigido de expire_billing_grace) → 036 → 037 → 040.
-- Os jobs rodam como postgres: as funções aceitam session_user = 'postgres' (guarda de servidor), sem JWT.
-- Reverter: SELECT cron.unschedule('expire-billing-grace'); SELECT cron.unschedule('expire-module-overrides');
--           SELECT cron.unschedule('apply-pending-plan-changes');
-- NÃO EXECUTAR antes do teste verde (040-rollback-test.sql) e da revisão da SecOps.

DO $pre$
BEGIN
  IF to_regprocedure('public.expire_billing_grace()') IS NULL
     OR to_regprocedure('public.expire_store_module_overrides()') IS NULL
     OR to_regprocedure('public.apply_pending_plan_changes()') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: aplique 024, 036 e 037 antes do 040.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron indisponível neste projeto.';
  END IF;
END
$pre$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove agendamentos anteriores com o mesmo nome (idempotente)
DO $u$
BEGIN
  PERFORM cron.unschedule(j.jobid) FROM cron.job j
   WHERE j.jobname IN ('expire-billing-grace', 'expire-module-overrides', 'apply-pending-plan-changes');
EXCEPTION WHEN others THEN NULL;
END
$u$;

SELECT cron.schedule('expire-billing-grace', '0 6 * * *', $$SELECT public.expire_billing_grace();$$);
SELECT cron.schedule('expire-module-overrides', '5 * * * *', $$SELECT public.expire_store_module_overrides();$$);
SELECT cron.schedule('apply-pending-plan-changes', '10 * * * *', $$SELECT public.apply_pending_plan_changes();$$);

-- Verificação: SELECT jobname, schedule, active FROM cron.job WHERE jobname IN ('expire-billing-grace','expire-module-overrides','apply-pending-plan-changes');

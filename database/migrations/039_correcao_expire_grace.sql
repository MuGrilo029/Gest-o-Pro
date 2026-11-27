-- 039-correcao-expire-grace-apply.sql
-- Correção aditiva da 024 (expire_billing_grace). Achado: a função tinha GRANT para authenticated e a guarda
-- usava current_user = 'postgres', que dentro de SECURITY DEFINER é sempre verdadeira. Qualquer usuário logado
-- podia suspender lojas em carência.
-- Correção (rev4 da SecOps):
--   1) EXECUTE sai de PUBLIC, anon e authenticated; fica só para service_role.
--   2) Corpo: a guarda passa a ser admin da plataforma, service_role ou session_user = 'postgres' (agendador).
--      current_user não é mais usado.
-- A lógica de suspender lojas com carência vencida é a mesma da 024.
-- PRÉ-REQUISITO: 024 aplicada.
-- NÃO EXECUTAR em produção antes do teste verde em ROLLBACK, da revisão da SecOps e da autorização do usuário.

DO $pre$
BEGIN
  IF to_regprocedure('public.expire_billing_grace()') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: expire_billing_grace (024).';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.expire_billing_grace()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $f$
DECLARE
  v_n integer := 0;
  rec record;
BEGIN
  IF NOT (public.is_platform_admin() OR auth.role() = 'service_role' OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Apenas o servidor ou o administrador da plataforma executa a verificação de carência.' USING ERRCODE = '42501';
  END IF;
  FOR rec IN
    SELECT sb.store_id FROM public.subscriptions sb
    WHERE sb.status = 'past_due' AND sb.grace_until IS NOT NULL AND sb.grace_until < now()
  LOOP
    UPDATE public.stores SET status = 'suspended' WHERE id = rec.store_id AND status IS DISTINCT FROM 'suspended';
    IF FOUND THEN
      v_n := v_n + 1;
      INSERT INTO public.admin_audit_logs (admin_id, store_id, action, details)
      VALUES (auth.uid(), rec.store_id, 'billing_grace_expired', '{}'::jsonb);
    END IF;
  END LOOP;
  RETURN v_n;
END
$f$;

REVOKE ALL ON FUNCTION public.expire_billing_grace() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_billing_grace() TO service_role;

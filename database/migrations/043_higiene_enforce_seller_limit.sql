-- 043-higiene-enforce-seller-limit-apply.sql
-- Higiene (pedido da SecOps sobre a 024): enforce_seller_limit é FUNÇÃO DE TRIGGER (store_members_seller_limit).
-- Não é executável direto por cliente, mas tinha EXECUTE para anon. Tira o EXECUTE de anon, authenticated e PUBLIC.
-- O trigger continua funcionando: a execução de função de trigger não depende de EXECUTE do chamador.
-- Não altera o corpo nem o trigger.
-- PRÉ-REQUISITO: 024 aplicada (já está em produção).
-- NÃO EXECUTAR antes do rollback-test verde e da revisão da SecOps.

DO $pre$
BEGIN
  IF to_regprocedure('public.enforce_seller_limit()') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: enforce_seller_limit (024).';
  END IF;
END
$pre$;

REVOKE ALL ON FUNCTION public.enforce_seller_limit() FROM PUBLIC, anon, authenticated;

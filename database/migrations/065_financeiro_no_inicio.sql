-- 065: Financeiro em todos os planos, incluindo o Início (decisão do dono de 27/11, via Produto).
--   * liga o módulo financial no plano inicio (plan_modules);
--   * recalcula o cache store_modules das lojas cujo plano é o Início (overrides continuam valendo);
--   * Boletos continua fora do Início e não muda nos outros planos; Relatórios não muda;
--   * sem lançamento retroativo: vendas anteriores continuam sem lançamento.
-- Efeito imediato: create_sale passa a gerar lançamentos nas lojas do Início.
-- Idempotente.

BEGIN;

INSERT INTO public.plan_modules (plan_key, module_key, enabled) VALUES ('inicio', 'financial', true)
ON CONFLICT (plan_key, module_key) DO UPDATE SET enabled = true;

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN SELECT st.id FROM public.stores st WHERE public._store_plan_for_modules(st.id) = 'inicio' LOOP
    PERFORM public.apply_store_modules(rec.id);
  END LOOP;
END $$;

COMMIT;

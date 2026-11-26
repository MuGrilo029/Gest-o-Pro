-- 009c: corrige as 2 assinaturas criadas pelo backfill antigo (R$ 199 fixo, lojas sem plano).
-- RASCUNHO: NÃO EXECUTAR sem aprovação do usuário. Mexe em dado de cobrança de produção.
-- Efeito: essas lojas passam a 'custom' com preço 0 (fora do MRR) até o plano ser definido.

-- Conferir antes (esperado: 2 linhas)
SELECT sb.store_id, s.name, s.plan, sb.plan_id, sb.price_cents
FROM public.subscriptions sb JOIN public.stores s ON s.id = sb.store_id
WHERE sb.plan_id = 'starter' AND sb.price_cents = 19900
  AND (s.plan IS NULL OR lower(trim(s.plan)) NOT IN ('início', 'inicio', 'crescimento', 'avançado', 'avancado'));

UPDATE public.subscriptions sb
SET plan_id = 'custom', price_cents = 0, updated_at = now()
FROM public.stores s
WHERE s.id = sb.store_id
  AND sb.plan_id = 'starter' AND sb.price_cents = 19900
  AND (s.plan IS NULL OR lower(trim(s.plan)) NOT IN ('início', 'inicio', 'crescimento', 'avançado', 'avancado'));

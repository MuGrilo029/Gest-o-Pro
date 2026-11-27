-- 044-mapa-planos-modulos-apply.sql
-- Correção de DADOS aditiva: troca a semente provisória da 024 (15 módulos liberados nos três planos)
-- pelo mapa aprovado pelo usuário (26/11). Sem DELETE: linhas fora do mapa ficam enabled = false.
-- Mapa (chaves de module_catalog):
--   inicio:       dashboard, sales (Vendas/PDV), inventory (Estoque e Produtos), customers (Clientes), settings (Configurações)
--   crescimento:  inicio + financial (Financeiro), reports (Relatórios), production (Produção), quotes (Orçamentos/Cotações)
--   avancado:     crescimento + deliveries (Entregas), push_notifications (Notificações), brand (Cor da marca), custom_production (Produção sob medida)
--   custom (COM STILLO): mesmos módulos do crescimento (decisão do usuário, 26/11).
--   boletos, suppliers e orders: fora de todos os planos (aguardam decisão do usuário; ficam desligados).
-- PRÉ-REQUISITOS: 024 (plan_modules), 031 (linhas 'brand'), 035 (module_catalog) e 036 (apply_store_modules).
-- O bloco $pre$ aborta se faltar algum. Depois do upsert, recalcula o cache das lojas com assinatura.
-- NÃO EXECUTAR antes do rollback-test verde e da revisão da SecOps.

DO $pre$
BEGIN
  IF to_regclass('public.plan_modules') IS NULL
     OR to_regclass('public.module_catalog') IS NULL
     OR to_regprocedure('public.apply_store_modules(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: aplique 024, 035 e 036 antes do 044.';
  END IF;
END
$pre$;

-- Upsert do mapa completo (3 planos x 16 chaves). Não remove linhas: o que não está no mapa vai para false.
INSERT INTO public.plan_modules (plan_key, module_key, enabled) VALUES
  -- inicio
  ('inicio', 'dashboard', true), ('inicio', 'sales', true), ('inicio', 'inventory', true),
  ('inicio', 'customers', true), ('inicio', 'settings', true),
  ('inicio', 'financial', false), ('inicio', 'reports', false), ('inicio', 'production', false), ('inicio', 'quotes', false),
  ('inicio', 'deliveries', false), ('inicio', 'push_notifications', false), ('inicio', 'brand', false), ('inicio', 'custom_production', false),
  ('inicio', 'boletos', false), ('inicio', 'suppliers', false), ('inicio', 'orders', false),
  -- crescimento
  ('crescimento', 'dashboard', true), ('crescimento', 'sales', true), ('crescimento', 'inventory', true),
  ('crescimento', 'customers', true), ('crescimento', 'settings', true), ('crescimento', 'financial', true),
  ('crescimento', 'reports', true), ('crescimento', 'production', true), ('crescimento', 'quotes', true),
  ('crescimento', 'deliveries', false), ('crescimento', 'push_notifications', false), ('crescimento', 'brand', false),
  ('crescimento', 'custom_production', false), ('crescimento', 'boletos', false), ('crescimento', 'suppliers', false), ('crescimento', 'orders', false),
  -- avancado
  ('avancado', 'dashboard', true), ('avancado', 'sales', true), ('avancado', 'inventory', true),
  ('avancado', 'customers', true), ('avancado', 'settings', true), ('avancado', 'financial', true),
  ('avancado', 'reports', true), ('avancado', 'production', true), ('avancado', 'quotes', true),
  ('avancado', 'deliveries', true), ('avancado', 'push_notifications', true), ('avancado', 'brand', true),
  ('avancado', 'custom_production', true), ('avancado', 'boletos', false), ('avancado', 'suppliers', false), ('avancado', 'orders', false)
ON CONFLICT (plan_key, module_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- Plano 'custom' (COM STILLO): decisão do usuário (26/11) — usa os módulos do CRESCIMENTO.
-- Linha em plans criada aqui (plan_modules tem FK para plans).
-- price_cents = 9900 (R$ 99), annual_price_cents = 99000 (R$ 990), max_sellers = 3: decisões do usuário (26/11).
INSERT INTO public.plans (key, name, price_cents, annual_price_cents, max_sellers, active)
VALUES ('custom', 'Com Stillo (custom)', 9900, 99000, 3, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.plan_modules (plan_key, module_key, enabled)
SELECT 'custom', pm.module_key, pm.enabled
  FROM public.plan_modules pm
 WHERE pm.plan_key = 'crescimento'
ON CONFLICT (plan_key, module_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- Recalcula o cache das lojas com assinatura (servidor)
DO $r$
DECLARE
  rec record;
BEGIN
  FOR rec IN SELECT sb.store_id FROM public.subscriptions sb LOOP
    PERFORM public.apply_store_modules(rec.store_id);
  END LOOP;
END
$r$;

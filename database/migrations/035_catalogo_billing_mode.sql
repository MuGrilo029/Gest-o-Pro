-- 035-catalogo-billing-mode-apply.sql
-- Migração aditiva. Catálogo de módulos (fonte única) e coluna billing_mode em stores.
-- Base: admin-plano/02-arquitetura.md, seções 1 e 4. Não altera store_modules nem lojas existentes além do novo campo.
-- PRÉ-REQUISITO: nenhum. (Não depende da 024.)
-- NÃO EXECUTAR em produção antes do teste verde em ROLLBACK, da revisão da SecOps e da autorização do usuário.
--
-- Decisões aplicadas (marcar para o usuário):
--   - D-A5: lojas existentes entram como 'manual_contract' (preserva o comportamento atual); lojas novas: 'gateway'.
--   - Core: NENHUMA chave nesta carga. 'settings' é sugestão, pendente de confirmação do usuário (SecOps rev3).

-- 1) Catálogo de módulos e features (fonte única)
CREATE TABLE IF NOT EXISTS public.module_catalog (
  key        text PRIMARY KEY,
  label      text NOT NULL,
  kind       text NOT NULL DEFAULT 'module' CHECK (kind IN ('module', 'feature')),
  core       boolean NOT NULL DEFAULT false,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.module_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS module_catalog_admin_read ON public.module_catalog;
CREATE POLICY module_catalog_admin_read ON public.module_catalog FOR SELECT TO authenticated
  USING (public.is_platform_admin());
-- Sem policy de escrita para clientes: alterações só por migração.

INSERT INTO public.module_catalog (key, label, kind) VALUES
  ('dashboard', 'Painel', 'module'),
  ('sales', 'Vendas (PDV)', 'module'),
  ('customers', 'Clientes', 'module'),
  ('inventory', 'Estoque', 'module'),
  ('settings', 'Configurações', 'module'),
  ('reports', 'Relatórios', 'module'),
  ('quotes', 'Orçamentos', 'module'),
  ('financial', 'Financeiro', 'module'),
  ('boletos', 'Boletos', 'module'),
  ('suppliers', 'Fornecedores', 'module'),
  ('orders', 'Pedidos', 'module'),
  ('production', 'Produção', 'module'),
  ('custom_production', 'Produção personalizada', 'module'),
  ('deliveries', 'Entregas', 'module'),
  ('push_notifications', 'Notificações push', 'module'),
  ('brand', 'Marca e cor', 'feature')
ON CONFLICT (key) DO NOTHING;

-- Chaves core (não desligáveis): PENDENTE de confirmação do usuário (SecOps rev3).
-- PENDENTE (confirmação do usuário): settings como core. Sem confirmação, nenhuma chave é core.
-- UPDATE public.module_catalog SET core = true WHERE key = 'settings';

-- 2) Modo de cobrança da loja
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'manual_contract';
ALTER TABLE public.stores ALTER COLUMN billing_mode SET DEFAULT 'gateway';
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_billing_mode_check') THEN
    ALTER TABLE public.stores ADD CONSTRAINT stores_billing_mode_check CHECK (billing_mode IN ('gateway', 'manual_contract'));
  END IF;
END
$c$;

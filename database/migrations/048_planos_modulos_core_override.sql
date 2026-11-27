-- 048: planos 1/3/6, módulos por plano, core fixo e override só liga/desliga.
-- Decisões do dono (docs/decisoes-do-dono.md): 1, 2, 14, 15, 16, 17.
-- Idempotente. Não altera linhas de lojas (stores, subscriptions, store_modules, overrides existentes).
-- O plano custom ("Com Stillo") sai do fluxo (active = false), mas a linha e os módulos dele ficam:
-- as lojas reais usam plan_id = 'custom' e não podem ser tocadas.

BEGIN;

-- 1) Planos: Início 1, Crescimento 3, Avançado 6 vendedores; anual = 10× mensal. Trial segue o Avançado.
UPDATE public.plans SET max_sellers = 1, annual_price_cents = price_cents * 10 WHERE key = 'inicio';
UPDATE public.plans SET max_sellers = 3, annual_price_cents = price_cents * 10 WHERE key = 'crescimento';
UPDATE public.plans SET max_sellers = 6, annual_price_cents = price_cents * 10 WHERE key = 'avancado';
UPDATE public.plans SET max_sellers = 6 WHERE key = 'trial';
UPDATE public.plans SET active = false WHERE key = 'custom';

-- 2) Core: Dashboard, Vendas, Clientes, Estoque e Configurações.
UPDATE public.module_catalog SET core = true WHERE key IN ('dashboard', 'sales', 'customers', 'inventory', 'settings');

-- 3) plan_modules como fonte de verdade (planos vendáveis e trial). O custom não muda.
WITH alvo(plan_key, module_key) AS (
  SELECT p, m FROM unnest(ARRAY['inicio', 'crescimento', 'avancado', 'trial']) p,
                   unnest(ARRAY['dashboard', 'sales', 'customers', 'inventory', 'settings']) m
  UNION ALL
  SELECT p, m FROM unnest(ARRAY['crescimento', 'avancado', 'trial']) p,
                   unnest(ARRAY['financial', 'boletos', 'reports', 'production', 'quotes', 'suppliers', 'orders']) m
  UNION ALL
  SELECT p, m FROM unnest(ARRAY['avancado', 'trial']) p,
                   unnest(ARRAY['deliveries', 'push_notifications', 'custom_production', 'brand']) m
)
UPDATE public.plan_modules pm
   SET enabled = EXISTS (SELECT 1 FROM alvo a WHERE a.plan_key = pm.plan_key AND a.module_key = pm.module_key)
 WHERE pm.plan_key IN ('inicio', 'crescimento', 'avancado', 'trial');

-- Linhas que faltarem (módulo novo no catálogo) entram desligadas, exceto core.
INSERT INTO public.plan_modules (plan_key, module_key, enabled)
SELECT p.key, mc.key, mc.core
  FROM public.plans p CROSS JOIN public.module_catalog mc
 WHERE p.key IN ('inicio', 'crescimento', 'avancado', 'trial')
ON CONFLICT (plan_key, module_key) DO NOTHING;

-- 4) Guarda: módulo core nunca fica desligado num plano.
CREATE OR REPLACE FUNCTION public._plan_modules_core_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF NOT NEW.enabled AND EXISTS (SELECT 1 FROM public.module_catalog mc WHERE mc.key = NEW.module_key AND mc.core) THEN
    RAISE EXCEPTION 'MODULO_CORE: o módulo % é essencial e não pode ser desligado no plano.', NEW.module_key USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS plan_modules_core_guard ON public.plan_modules;
CREATE TRIGGER plan_modules_core_guard BEFORE INSERT OR UPDATE ON public.plan_modules
  FOR EACH ROW EXECUTE FUNCTION public._plan_modules_core_guard();

-- 5) Override por loja: só liga/desliga, sem motivo e sem validade. O histórico antigo fica.
ALTER TABLE public.store_module_overrides DROP CONSTRAINT IF EXISTS store_module_overrides_reason_check;
ALTER TABLE public.store_module_overrides DROP CONSTRAINT IF EXISTS store_module_overrides_grant_expiry;
ALTER TABLE public.store_module_overrides ALTER COLUMN reason DROP NOT NULL;

-- Core não aceita override (também na tabela, não só na RPC).
CREATE OR REPLACE FUNCTION public._override_core_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.module_catalog mc WHERE mc.key = NEW.module_key AND mc.core) THEN
    RAISE EXCEPTION 'MODULO_CORE: o módulo % é essencial e não aceita override.', NEW.module_key USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS store_module_overrides_core_guard ON public.store_module_overrides;
CREATE TRIGGER store_module_overrides_core_guard BEFORE INSERT ON public.store_module_overrides
  FOR EACH ROW EXECUTE FUNCTION public._override_core_guard();

-- Assinaturas antigas (motivo/validade) saem. A nova admin_clear_module_override tem os mesmos tipos
-- (uuid, text), por isso o DROP vem antes.
DROP FUNCTION IF EXISTS public.admin_set_module_override(uuid, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.admin_clear_module_override(uuid, text);

-- Liga (p_enabled = true) ou desliga (false) um módulo na loja, por cima do plano.
CREATE OR REPLACE FUNCTION public.admin_set_module_override(p_store uuid, p_module text, p_enabled boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_core boolean;
  v_id uuid;
BEGIN
  PERFORM public._require_platform_admin();
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'Informe ligar ou desligar.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store) THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
  SELECT mc.core INTO v_core FROM public.module_catalog mc WHERE mc.key = p_module AND mc.active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Módulo inexistente ou inativo: %.', p_module; END IF;
  IF v_core THEN
    RAISE EXCEPTION 'MODULO_CORE: o módulo % é essencial e não aceita override.', p_module USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.store_module_overrides SET revoked_at = now(), revoked_by = auth.uid()
   WHERE store_id = p_store AND module_key = p_module AND revoked_at IS NULL;

  INSERT INTO public.store_module_overrides (store_id, module_key, action, reason, expires_at, created_by)
  VALUES (p_store, p_module, CASE WHEN p_enabled THEN 'grant' ELSE 'revoke' END, NULL, NULL, auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.apply_store_modules(p_store);
  PERFORM public.admin_log_audit(p_store, 'module_override_set', jsonb_build_object('module', p_module, 'enabled', p_enabled));
  RETURN v_id;
END $$;

-- Volta o módulo ao que o plano define.
CREATE OR REPLACE FUNCTION public.admin_clear_module_override(p_store uuid, p_module text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_n integer;
BEGIN
  PERFORM public._require_platform_admin();
  UPDATE public.store_module_overrides SET revoked_at = now(), revoked_by = auth.uid()
   WHERE store_id = p_store AND module_key = p_module AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    PERFORM public.apply_store_modules(p_store);
    PERFORM public.admin_log_audit(p_store, 'module_override_cleared', jsonb_build_object('module', p_module));
  END IF;
  RETURN v_n > 0;
END $$;

REVOKE ALL ON FUNCTION public.admin_set_module_override(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_clear_module_override(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_module_override(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_module_override(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public._plan_modules_core_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._override_core_guard() FROM PUBLIC, anon, authenticated;

COMMIT;

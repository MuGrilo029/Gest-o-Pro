-- 054: push só para o DONO da loja, para todos os eventos (decisão 28).
-- Eventos: nova venda (já existia), estoque baixo (novo, ao cruzar o mínimo) e conta vencida (nova função).
-- O destinatário é decidido na Edge Function send-push-notification (só OWNER). Aqui o banco só avisa o evento,
-- e só quando o módulo push_notifications está ligado para a loja (plano ou override).
-- notify_overdue_bills() NÃO é agendada por esta migração: o agendamento (pg_cron) precisa de aprovação.
-- Idempotente. A venda nunca falha por causa do push (exceções viram WARNING).

BEGIN;

-- Estado efetivo de um módulo, sem checagem de sessão (uso interno de gatilhos e jobs).
CREATE OR REPLACE FUNCTION public._store_module_on(p_store uuid, p_module text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_core boolean;
  v_action text;
  v_enabled boolean;
BEGIN
  SELECT mc.core INTO v_core FROM public.module_catalog mc WHERE mc.key = p_module AND mc.active;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_core THEN RETURN true; END IF;
  SELECT ov.action INTO v_action FROM public.store_module_overrides ov
   WHERE ov.store_id = p_store AND ov.module_key = p_module AND ov.revoked_at IS NULL
     AND (ov.expires_at IS NULL OR ov.expires_at > now())
   ORDER BY ov.created_at DESC LIMIT 1;
  IF v_action IS NOT NULL THEN RETURN v_action = 'grant'; END IF;
  SELECT pm.enabled INTO v_enabled FROM public.plan_modules pm
   WHERE pm.plan_key = public._store_plan_for_modules(p_store) AND pm.module_key = p_module;
  RETURN COALESCE(v_enabled, false);
END $$;
REVOKE ALL ON FUNCTION public._store_module_on(uuid, text) FROM PUBLIC, anon, authenticated;

-- Envia o evento para a Edge Function (pg_net, assíncrono). O corpo leva só tipo e id; a função relê do banco.
CREATE OR REPLACE FUNCTION public._push_enqueue(p_type text, p_id uuid, p_store uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE
  v_secret text;
BEGIN
  IF NOT public._store_module_on(p_store, 'push_notifications') THEN RETURN; END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'push_webhook_secret' LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE WARNING 'push_webhook_secret ausente no Vault';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := 'https://yfyckreoprwfwhjadfkl.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object('type', p_type, 'record', jsonb_build_object('id', p_id))
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha ao acionar push (%): %', p_type, SQLERRM;
END $$;
REVOKE ALL ON FUNCTION public._push_enqueue(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Nova venda (substitui o corpo da 007; mesmo gatilho tg_push_venda_finalizada).
CREATE OR REPLACE FUNCTION public.tr_venda_finalizada_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
BEGIN
  PERFORM public._push_enqueue('sale', NEW.id, NEW.store_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha ao acionar push notification: %', SQLERRM;
  RETURN NEW;
END $$;

-- Estoque baixo: dispara uma vez, quando a quantidade cruza o mínimo para baixo.
CREATE OR REPLACE FUNCTION public.tr_estoque_baixo_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
BEGIN
  IF COALESCE(NEW.min_stock, 0) > 0
     AND COALESCE(NEW.quantity, 0) <= NEW.min_stock
     AND COALESCE(OLD.quantity, 0) > COALESCE(OLD.min_stock, 0) THEN
    PERFORM public._push_enqueue('low_stock', NEW.id, NEW.store_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha ao acionar push de estoque: %', SQLERRM;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_push_estoque_baixo ON public.products;
CREATE TRIGGER tg_push_estoque_baixo AFTER UPDATE OF quantity, min_stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tr_estoque_baixo_push();

-- Conta vencida: despesas pendentes que venceram ontem (um aviso por conta). Para um job diário.
CREATE OR REPLACE FUNCTION public.notify_overdue_bills()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  rec record;
  v_n integer := 0;
BEGIN
  IF NOT (auth.role() = 'service_role' OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Apenas o servidor dispara avisos de contas vencidas.' USING ERRCODE = '42501';
  END IF;
  FOR rec IN
    SELECT t.id, t.store_id FROM public.transactions t
     WHERE t.type = 'EXPENSE' AND COALESCE(t.status, 'PENDING') <> 'PAID'
       AND t.due_date = current_date - 1
  LOOP
    PERFORM public._push_enqueue('overdue_bill', rec.id, rec.store_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.notify_overdue_bills() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_overdue_bills() TO service_role;
REVOKE ALL ON FUNCTION public.tr_estoque_baixo_push() FROM PUBLIC, anon, authenticated;

COMMIT;

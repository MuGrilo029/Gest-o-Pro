-- 066: excluir loja, só pelo administrador da plataforma (pedido do dono de 27/11).
-- Ordem (para falha ser repetível sem sobra):
--   1) admin_delete_store: UMA transação apaga os dados, marca a loja como excluída e grava o que falta
--      (store_deletions). Se falhar, nada muda e nenhum arquivo é tocado;
--   2) a Edge Function manage-users apaga os arquivos do Storage (products e producao-anexos, pasta {store_id}/)
--      pela Storage API (e os de boletos, 068); a lista vem de admin_store_deletion_files, relida até zerar;
--   3) a função apaga os logins elegíveis (admin_deletion_pending_logins, reavaliados na hora);
--   4) admin_delete_store_status confere no banco o que sobrou. Repetir a mesma chamada continua de onde parou.
--
-- "Apagar tudo" NÃO apaga (retenção ou registro financeiro; ver _store_retained_tables):
--   * a linha de stores, que vira lápide (nome, datas; sem contato, notas, plano ou prazo): o log de auditoria
--     aponta para ela e tem retenção de 5 anos (021);
--   * admin_audit_logs, subscription_payments, invoices, billing_events,
--     billing_gateway_requests, upgrade_payment_events e store_deletions;
--   * logins que a regra manda manter; cópias em backups e em schemas snapshot_* do próprio banco.
-- Aceite dos Termos: apagado junto com a loja (store_id). A FK para auth.users volta com ON DELETE CASCADE,
-- mas a linha ja nao existe quando o login e apagado.
-- LOGINS: decisão do dono (27/11) — apaga todos os logins da loja, sem exceção (só admin da plataforma).
-- Idempotente.

BEGIN;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- O autor do log de auditoria (ex.: quem escolheu o plano no trial) tem FK NO ACTION para auth.users; sem isto
-- apagar o login falha e a exclusão fica "parcial" para sempre. O admin_id continua gravado como UUID órfão.
ALTER TABLE public.admin_audit_logs DROP CONSTRAINT IF EXISTS admin_audit_logs_admin_id_fkey;
-- Aceite dos Termos acompanha a loja (apagado em _store_delete_tables). A FK volta para auth.users com CASCADE:
-- se por algum motivo o login for apagado antes, o aceite segue junto.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terms_acceptances_user_id_fkey') THEN
    ALTER TABLE public.terms_acceptances
      ADD CONSTRAINT terms_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.store_deletions (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE RESTRICT,
  store_name text NOT NULL,
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  rows_deleted jsonb NOT NULL DEFAULT '{}'::jsonb,
  candidate_logins uuid[] NOT NULL DEFAULT '{}',
  storage_done_at timestamptz,
  logins_done_at timestamptz
);
ALTER TABLE public.store_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_deletions FROM anon, authenticated;

-- Tabelas com store_id apagadas, na ordem (filhos antes dos pais). Tabela nova com store_id precisa entrar
-- aqui ou em _store_retained_tables: o teste falha e a exclusão é recusada enquanto não entrar.
CREATE OR REPLACE FUNCTION public._store_delete_tables()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT ARRAY['sale_items', 'quote_items', 'transaction_payments', 'transactions', 'deliveries', 'production_orders',
               'orders', 'stock_movements', 'stock_balances', 'warehouses', 'sales', 'quotes', 'products', 'customers',
               'suppliers', 'categories', 'category_groups', 'card_fees', 'simulations', 'company_settings',
               'store_modules', 'store_module_overrides', 'subscriptions', 'store_members', 'terms_acceptances']
$$;
CREATE OR REPLACE FUNCTION public._store_retained_tables()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT ARRAY['admin_audit_logs', 'subscription_payments', 'invoices', 'billing_events',
               'billing_gateway_requests', 'upgrade_payment_events', 'store_deletions']
$$;

-- >>> REGRA DE LOGINS (decisão do dono 27/11: apaga tudo, incluindo os logins da loja). <<<
-- NULL = apagar; texto = manter, com o motivo.
-- Mantidos: apenas (a) admin da plataforma (dono do SaaS, nao e login de loja).
-- Todos os demais logins sao apagados, inclusive quem e OWNER de outra loja (a outra loja fica sem dono; aviso na previa).
-- Membro (nao OWNER) de outra loja tambem e apagado.
-- O log de auditoria mantem o admin_id como UUID orfao (retencao, sem FK).
CREATE OR REPLACE FUNCTION public._store_login_keep_reason(p_user uuid, p_store uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE
    WHEN COALESCE((SELECT p.is_platform_admin FROM public.profiles p WHERE p.id = p_user), false) THEN 'admin_da_plataforma'
  END
$$;

-- Loja excluída não volta: sem update (exceto o banco zerar created_by quando o login é apagado) e sem membros,
-- assinatura ou dados novos pelas rotas do admin.
CREATE OR REPLACE FUNCTION public.tg_deleted_store_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_deleted timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'stores' THEN
    IF OLD.deleted_at IS NOT NULL
       AND NOT (NEW.created_by IS NULL AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by')) THEN
      RAISE EXCEPTION 'LOJA_EXCLUIDA: esta loja foi excluída.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- FOR KEY SHARE espera uma exclusão em andamento (FOR UPDATE) e lê o resultado dela: nada entra por corrida.
    SELECT s.deleted_at INTO v_deleted FROM public.stores s WHERE s.id = NEW.store_id FOR KEY SHARE;
    IF v_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'LOJA_EXCLUIDA: esta loja foi excluída.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_deleted_store_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS stores_deleted_guard ON public.stores;
CREATE TRIGGER stores_deleted_guard BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.tg_deleted_store_guard();
-- Nada novo entra numa loja excluída (todas as tabelas apagáveis), nem membro é movido para ela.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY public._store_delete_tables() LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_deleted_guard', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF store_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_deleted_store_guard()',
                   t || '_deleted_guard', t);
  END LOOP;
END $$;

-- Arquivos que ainda restam da loja no Storage (só a pasta {store_id}/ dos dois buckets).
CREATE OR REPLACE FUNCTION public.admin_store_deletion_files(p_store uuid, p_limit integer DEFAULT 100)
RETURNS TABLE (bucket_id text, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
BEGIN
  PERFORM public._require_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM public.store_deletions d WHERE d.store_id = p_store) THEN
    RAISE EXCEPTION 'Esta loja não está em exclusão.';
  END IF;
  RETURN QUERY
    SELECT o.bucket_id, o.name FROM storage.objects o
     WHERE o.bucket_id IN ('products', 'producao-anexos', 'boletos') AND (storage.foldername(o.name))[1] = p_store::text
     ORDER BY o.bucket_id, o.name
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
END $$;

-- Logins ainda a apagar: os que eram da loja, continuam existindo e a regra (reavaliada agora) manda apagar.
CREATE OR REPLACE FUNCTION public.admin_deletion_pending_logins(p_store uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
BEGIN
  PERFORM public._require_platform_admin();
  RETURN QUERY
    SELECT c.uid FROM public.store_deletions d, unnest(d.candidate_logins) AS c(uid)
     WHERE d.store_id = p_store
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.uid)
       AND public._store_login_keep_reason(c.uid, p_store) IS NULL;
END $$;

-- Estado da exclusão, conferido no banco (marca as etapas concluídas).
CREATE OR REPLACE FUNCTION public.admin_delete_store_status(p_store uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  d public.store_deletions%ROWTYPE;
  v_files integer;
  v_logins integer;
  v_kept jsonb;
BEGIN
  PERFORM public._require_platform_admin();
  SELECT * INTO d FROM public.store_deletions WHERE store_id = p_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta loja não está em exclusão.'; END IF;
  SELECT count(*)::integer INTO v_files FROM storage.objects o
   WHERE o.bucket_id IN ('products', 'producao-anexos', 'boletos') AND (storage.foldername(o.name))[1] = p_store::text;
  SELECT count(*)::integer INTO v_logins FROM public.admin_deletion_pending_logins(p_store);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', c.uid, 'reason', public._store_login_keep_reason(c.uid, p_store))), '[]'::jsonb)
    INTO v_kept FROM unnest(d.candidate_logins) AS c(uid)
   WHERE public._store_login_keep_reason(c.uid, p_store) IS NOT NULL;
  UPDATE public.store_deletions
     SET storage_done_at = CASE WHEN v_files = 0 THEN COALESCE(storage_done_at, now()) END,
         logins_done_at = CASE WHEN v_logins = 0 THEN COALESCE(logins_done_at, now()) END
   WHERE store_id = p_store;
  RETURN jsonb_build_object('store_id', p_store, 'store_name', d.store_name,
    'status', CASE WHEN v_files = 0 AND v_logins = 0 THEN 'concluida' ELSE 'parcial' END,
    'rows_deleted', d.rows_deleted, 'storage_remaining', v_files, 'logins_remaining', v_logins, 'logins_kept', v_kept);
END $$;

-- Prévia: contagens do que sai, do que fica e do que impede a exclusão. Não altera nada.
CREATE OR REPLACE FUNCTION public.admin_delete_store_preview(p_store uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  st public.stores%ROWTYPE;
  v_tab text;
  v_n bigint;
  v_rows jsonb := '{}'::jsonb;
  v_kept_rows jsonb := '{}'::jsonb;
  v_storage jsonb;
  v_logins jsonb;
BEGIN
  PERFORM public._require_platform_admin();
  SELECT * INTO st FROM public.stores WHERE id = p_store;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
  FOREACH v_tab IN ARRAY public._store_delete_tables() LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE store_id = $1', v_tab) INTO v_n USING p_store;
    v_rows := v_rows || jsonb_build_object(v_tab, v_n);
  END LOOP;
  FOREACH v_tab IN ARRAY public._store_retained_tables() LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE store_id = $1', v_tab) INTO v_n USING p_store;
    v_kept_rows := v_kept_rows || jsonb_build_object(v_tab, v_n);
  END LOOP;
  SELECT jsonb_build_object(
           'products', count(*) FILTER (WHERE o.bucket_id = 'products'),
           'producao-anexos', count(*) FILTER (WHERE o.bucket_id = 'producao-anexos'),
           'boletos', count(*) FILTER (WHERE o.bucket_id = 'boletos'))
    INTO v_storage FROM storage.objects o
   WHERE o.bucket_id IN ('products', 'producao-anexos', 'boletos') AND (storage.foldername(o.name))[1] = p_store::text;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role,
           'action', CASE WHEN public._store_login_keep_reason(m.user_id, p_store) IS NULL THEN 'apagar' ELSE 'manter' END,
           'reason', public._store_login_keep_reason(m.user_id, p_store),
           'other_store_names', CASE WHEN EXISTS (SELECT 1 FROM public.store_members m2 JOIN public.stores s2 ON s2.id = m2.store_id
                    WHERE m2.user_id = m.user_id AND m2.role = 'OWNER' AND m2.store_id <> p_store AND s2.deleted_at IS NULL)
             THEN (SELECT COALESCE(jsonb_agg(s2.name ORDER BY s2.name), '[]'::jsonb)
                     FROM public.store_members m2 JOIN public.stores s2 ON s2.id = m2.store_id
                    WHERE m2.user_id = m.user_id AND m2.role = 'OWNER' AND m2.store_id <> p_store AND s2.deleted_at IS NULL)
             ELSE NULL END,
           'aviso', CASE WHEN public._store_login_keep_reason(m.user_id, p_store) IS NULL
             AND EXISTS (SELECT 1 FROM public.store_members m2 JOIN public.stores s2 ON s2.id = m2.store_id
                    WHERE m2.user_id = m.user_id AND m2.role = 'OWNER' AND m2.store_id <> p_store AND s2.deleted_at IS NULL)
             THEN true ELSE false END)
           ORDER BY CASE m.role WHEN 'OWNER' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END, u.email), '[]'::jsonb)
    INTO v_logins FROM public.store_members m JOIN auth.users u ON u.id = m.user_id WHERE m.store_id = p_store;
  RETURN jsonb_build_object(
    'store', jsonb_build_object('id', st.id, 'name', st.name, 'status', st.status, 'deleted_at', st.deleted_at),
    'rows', v_rows, 'storage', v_storage, 'logins', v_logins, 'logins_rule', 'apaga_todos_os_logins_da_loja',
    'retained', v_kept_rows, 'blocker', public._store_delete_blocker(p_store));
END $$;

-- Motivo que impede excluir (NULL = pode).
CREATE OR REPLACE FUNCTION public._store_delete_blocker(p_store uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_new text;
  fk record;
  v_cross boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.subscriptions sb WHERE sb.store_id = p_store
              AND sb.gateway_subscription_id IS NOT NULL AND sb.status <> 'cancelled') THEN
    RETURN 'ASSINATURA_NO_GATEWAY: cancele a assinatura no gateway (encerre a loja) antes de excluir.';
  END IF;
  SELECT string_agg(c.table_name::text, ', ' ORDER BY c.table_name) INTO v_new
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
   WHERE c.table_schema = 'public' AND c.column_name = 'store_id'
     AND c.table_name::text <> ALL (public._store_delete_tables() || public._store_retained_tables());
  IF v_new IS NOT NULL THEN
    RETURN 'TABELA_SEM_TRATAMENTO: a exclusão ainda não sabe tratar: ' || v_new || '.';
  END IF;
  -- Linha de OUTRA loja ligada a uma linha desta seria apagada (cascata) ou alterada (SET NULL) junto: recusa.
  FOR fk IN
    SELECT k.conrelid::regclass AS child, k.confrelid::regclass AS parent, a.attname AS col, b.attname AS ref
      FROM pg_catalog.pg_constraint k
      JOIN pg_catalog.pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      JOIN pg_catalog.pg_attribute b ON b.attrelid = k.confrelid AND b.attnum = k.confkey[1]
      JOIN pg_catalog.pg_class cc ON cc.oid = k.conrelid
      JOIN pg_catalog.pg_class pc ON pc.oid = k.confrelid
     WHERE k.contype = 'f' AND k.confdeltype IN ('c', 'n') AND array_length(k.conkey, 1) = 1
       AND cc.relnamespace = 'public'::regnamespace AND pc.relnamespace = 'public'::regnamespace
       AND cc.relname::text = ANY (public._store_delete_tables()) AND pc.relname::text = ANY (public._store_delete_tables())
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s c JOIN %s p ON p.%I = c.%I WHERE p.store_id = $1 AND c.store_id <> $1)',
                   fk.child, fk.parent, fk.ref, fk.col) INTO v_cross USING p_store;
    IF v_cross THEN
      RETURN 'REFERENCIA_ENTRE_LOJAS: há registro de outra loja ligado a esta (' || fk.child::text || ' → ' || fk.parent::text || ').';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- Etapa 1: apaga os dados numa transação. Repetir depois de apagado só devolve o estado.
CREATE OR REPLACE FUNCTION public.admin_delete_store(p_store uuid, p_confirm_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  st public.stores%ROWTYPE;
  d public.store_deletions%ROWTYPE;
  v_tab text;
  v_n bigint;
  v_rows jsonb := '{}'::jsonb;
  v_users uuid[];
  v_blocker text;
BEGIN
  PERFORM public._require_platform_admin();
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('delete_store:' || COALESCE(p_store::text, ''), 0));
  SELECT * INTO st FROM public.stores WHERE id = p_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF btrim(COALESCE(p_confirm_name, '')) IS DISTINCT FROM btrim(st.name) THEN
    RAISE EXCEPTION 'NOME_NAO_CONFERE: digite o nome exato da loja para excluir.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO d FROM public.store_deletions WHERE store_id = p_store;
  IF FOUND THEN
    RETURN jsonb_build_object('store_id', p_store, 'already_deleted', true, 'rows_deleted', d.rows_deleted);
  END IF;

  v_blocker := public._store_delete_blocker(p_store);
  IF v_blocker IS NOT NULL THEN RAISE EXCEPTION '%', v_blocker USING ERRCODE = 'P0001'; END IF;

  SELECT COALESCE(array_agg(m.user_id), '{}') INTO v_users FROM public.store_members m WHERE m.store_id = p_store;

  FOREACH v_tab IN ARRAY public._store_delete_tables() LOOP
    EXECUTE format('DELETE FROM public.%I WHERE store_id = $1', v_tab) USING p_store;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN v_rows := v_rows || jsonb_build_object(v_tab, v_n); END IF;
  END LOOP;

  UPDATE public.profiles SET active_store_id = NULL WHERE active_store_id = p_store;
  INSERT INTO public.store_deletions (store_id, store_name, requested_by, rows_deleted, candidate_logins)
  VALUES (p_store, st.name, auth.uid(), v_rows, v_users);
  PERFORM public.admin_log_audit(p_store, 'delete_store',
    jsonb_build_object('name', st.name, 'status_before', st.status, 'linhas', v_rows, 'contas', cardinality(v_users)));

  UPDATE public.stores
     SET deleted_at = now(), is_active = false, status = 'expired', slug = NULL, plan = NULL, contact_email = NULL,
         notes = NULL, monthly_value = NULL, trial_ends_at = NULL, valid_until = NULL, is_trial = false
   WHERE id = p_store;

  RETURN jsonb_build_object('store_id', p_store, 'already_deleted', false, 'rows_deleted', v_rows);
END $$;


REVOKE ALL ON FUNCTION public._store_delete_tables() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._store_retained_tables() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._store_login_keep_reason(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._store_delete_blocker(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_store_deletion_files(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_deletion_pending_logins(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_store_status(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_store_preview(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_store(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_store_deletion_files(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deletion_pending_logins(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_store_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_store_preview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_store(uuid, text) TO authenticated;

-- A lista do painel deixa de mostrar lojas com exclusão concluída (corpo da 050 mais o filtro).
CREATE OR REPLACE FUNCTION public.admin_list_stores(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50,
  p_after_key timestamptz DEFAULT NULL::timestamptz, p_after_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_q text := NULLIF(lower(btrim(COALESCE(p_filters->>'q', ''))), '');
  v_items jsonb;
  v_count integer;
  v_last jsonb;
BEGIN
  PERFORM public._require_platform_admin();
  IF (p_after_key IS NULL) <> (p_after_id IS NULL) THEN RAISE EXCEPTION 'Cursor incompleto.'; END IF;

  WITH base AS (
    SELECT st.id, st.name, st.status,
           public.store_effective_status(st.status, st.trial_ends_at, st.valid_until) AS effective_status,
           sb.plan_id AS plano, sb.status AS assinatura_status, sb.price_cents, sb.billing_cycle,
           pl.max_sellers,
           (SELECT count(*)::integer FROM public.store_members m WHERE m.store_id = st.id AND m.role = 'SELLER') AS sellers_count,
           (SELECT u.email::text FROM public.store_members m JOIN auth.users u ON u.id = m.user_id
             WHERE m.store_id = st.id AND m.role = 'OWNER' ORDER BY m.created_at LIMIT 1) AS owner_email,
           COALESCE(sb.current_period_end, st.trial_ends_at, st.valid_until) AS fim,
           COALESCE(sb.current_period_end, st.trial_ends_at, st.valid_until, 'infinity'::timestamptz) AS chave,
           st.trial_ends_at, st.valid_until, st.billing_mode, st.created_at,
           st.deleted_at IS NOT NULL AS exclusao_pendente
      FROM public.stores st
      LEFT JOIN public.subscriptions sb ON sb.store_id = st.id
      LEFT JOIN public.plans pl ON pl.key = sb.plan_id
     -- Excluída some da lista quando tudo terminou; enquanto restar arquivo ou login, aparece com exclusao_pendente.
     WHERE (st.deleted_at IS NULL OR EXISTS (SELECT 1 FROM public.store_deletions d
             WHERE d.store_id = st.id AND (d.storage_done_at IS NULL OR d.logins_done_at IS NULL)))
       AND (p_filters->>'status' IS NULL OR st.status = p_filters->>'status')
       AND (p_filters->>'plan' IS NULL OR sb.plan_id = p_filters->>'plan')
       AND (p_filters->>'em_teste' IS DISTINCT FROM 'true' OR st.status = 'trial')
       AND (p_filters->>'vencimento_ate' IS NULL
            OR COALESCE(sb.current_period_end, st.trial_ends_at, st.valid_until) <= (p_filters->>'vencimento_ate')::timestamptz)
  ),
  filtrada AS (
    SELECT b.* FROM base b
     WHERE v_q IS NULL OR position(v_q IN lower(b.name)) > 0 OR position(v_q IN lower(COALESCE(b.owner_email, ''))) > 0
  ),
  pagina AS (
    SELECT f.* FROM filtrada f
     WHERE p_after_key IS NULL OR (f.chave, f.id) > (p_after_key, p_after_id)
     ORDER BY f.chave, f.id
     LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.chave, p.id), '[]'::jsonb), count(*)::integer
    INTO v_items, v_count FROM pagina p;

  v_last := CASE WHEN v_count > 0 THEN v_items -> (v_count - 1) ELSE NULL END;
  RETURN jsonb_build_object('items', v_items, 'count', v_count, 'has_more', v_count = v_limit,
    'next_after_key', CASE WHEN v_count = v_limit THEN v_last ->> 'chave' ELSE NULL END,
    'next_after_id', CASE WHEN v_count = v_limit THEN v_last ->> 'id' ELSE NULL END);
END $$;

COMMIT;

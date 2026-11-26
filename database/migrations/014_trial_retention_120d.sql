-- 014: regra de retenção de trial não convertido (120 dias após expirar)
-- Aditiva: schema/tabela/função novos. NÃO executa a exclusão: a função só simula por padrão.
-- Critério: loja com is_trial = true, status ainda 'trial' (nunca virou paga) e trial_ends_at
-- anterior a now() - 120 dias. Lojas pagas ou com status diferente nunca entram.
-- Ação: exclui a loja; todas as tabelas filhas têm ON DELETE CASCADE (dados da loja saem junto).
-- Limite: a conta do dono (auth.users) não é removida aqui; isso exige a API de administração
-- do Auth (job separado, a definir).

CREATE TABLE IF NOT EXISTS private.retention_log (
  id bigserial PRIMARY KEY,
  store_id uuid NOT NULL,
  store_name text,
  trial_ends_at timestamptz,
  purged_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.retention_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.purge_expired_trials(
  p_dry_run boolean DEFAULT true,
  p_days integer DEFAULT 120
)
RETURNS TABLE (store_id uuid, store_name text, trial_ends_at timestamptz, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  s record;
BEGIN
  FOR s IN
    SELECT st.id, st.name, st.trial_ends_at
    FROM public.stores st
    WHERE st.is_trial = true
      AND st.status = 'trial'
      AND st.trial_ends_at < now() - make_interval(days => p_days)
    ORDER BY st.trial_ends_at
  LOOP
    IF p_dry_run THEN
      store_id := s.id; store_name := s.name; trial_ends_at := s.trial_ends_at;
      action := 'candidata (simulação, nada apagado)';
      RETURN NEXT;
    ELSE
      INSERT INTO private.retention_log (store_id, store_name, trial_ends_at)
      VALUES (s.id, s.name, s.trial_ends_at);
      DELETE FROM public.stores WHERE id = s.id;
      store_id := s.id; store_name := s.name; trial_ends_at := s.trial_ends_at;
      action := 'excluída';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION private.purge_expired_trials(boolean, integer) FROM PUBLIC, anon, authenticated;

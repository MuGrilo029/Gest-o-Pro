-- 016: retenção do trial não convertido passa a ser EXCLUSÃO LOGO APÓS EXPIRAR (decisão do usuário)
-- Substitui a regra de 120 dias da 014 por CREATE OR REPLACE (mesma assinatura, mesmo retorno).
-- Aditiva no esquema: não cria tabelas novas e não altera dados. NÃO executa a exclusão:
-- por padrão só simula (p_dry_run = true).
--
-- Critério: loja com status = 'trial' (nunca virou paga: status 'active' ou 'suspended' nunca entram)
-- e trial_ends_at já vencido há mais de p_days dias (padrão 0 = logo após expirar).
-- Inclui trials criados pelo cadastro público (is_trial = true) e pelo admin (is_trial = false),
-- porque ambos são testes que nunca assinaram.
-- Ação: exclui a loja; todas as tabelas filhas têm ON DELETE CASCADE. A conta do dono no Auth
-- não é removida aqui (exige job com a API de administração do Auth).

CREATE OR REPLACE FUNCTION private.purge_expired_trials(
  p_dry_run boolean DEFAULT true,
  p_days integer DEFAULT 0
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
    WHERE st.status = 'trial'
      AND st.trial_ends_at IS NOT NULL
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

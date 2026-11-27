-- 069: aposenta a add_store_member (003/006) para clientes (baixo da Segurança na revisão da 067).
-- Chamada direto pelo admin da plataforma, ela ligava conta com e-mail não confirmado a uma loja. O app não a usa:
-- membros entram pela Edge Function manage-users, que confere a confirmação. A função continua no banco, sem
-- EXECUTE para anon e authenticated. Idempotente.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.add_store_member(uuid, text, text, text[]) FROM PUBLIC, anon, authenticated;

COMMIT;

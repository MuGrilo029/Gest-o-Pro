-- 017: fecha EXECUTE de anon (e PUBLIC) nas funções SECURITY DEFINER do schema public
-- ATENÇÃO: migração PREPARADA, NÃO aplicada. Aguarda aprovação do Tech Lead/usuário.
--
-- Efeito esperado:
--  - anon deixa de executar qualquer RPC do schema public (sem login não há chamada de loja/admin);
--  - authenticated continua executando tudo o que o app usa (ver achados-backend.md);
--  - as políticas RLS que usam as funções de apoio (current_store_id, is_store_member, is_store_manager,
--    store_role, store_access_ok, is_platform_admin, is_admin) rodam só para o papel authenticated
--    (as políticas são TO authenticated), então não mudam para o usuário logado;
--  - funções de trigger (handle_new_user, protect_platform_admin_flag, tr_venda_finalizada_push,
--    rls_auto_enable) não precisam de EXECUTE do chamador para disparar; a revogação não as quebra;
--  - as admin_* já têm guarda no corpo (_require_platform_admin / is_platform_admin). Não recebem
--    novo grant: continuam chamáveis só por authenticated e recusam quem não é platform admin.
--
-- Como funciona: REVOKE de PUBLIC e anon; GRANT explícito para authenticated, porque
-- authenticated herda o EXECUTE de PUBLIC e perderia o acesso sem este GRANT.

-- Funções de loja, usadas pelo app com login
REVOKE EXECUTE ON FUNCTION public.my_stores() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_store_access() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_active_store(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_store(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_store_members(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_store_member(uuid, text, text, text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_store_member(uuid, uuid, text, text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_store_member(uuid, uuid) FROM PUBLIC, anon;

-- Funções administrativas (plataforma): só authenticated, e o corpo confere is_platform_admin
REVOKE EXECUTE ON FUNCTION public._require_platform_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_clients() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_create_client(text, text, text[], text, integer, integer, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_extend(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_status(uuid, text, integer, integer, boolean) FROM PUBLIC, anon;

-- Funções de apoio das políticas RLS
REVOKE EXECUTE ON FUNCTION public.current_store_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_store_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_store_manager(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.store_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.store_access_ok(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;

-- Funções de trigger e de evento: nenhuma deve ser chamada por API
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_platform_admin_flag() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tr_venda_finalizada_push() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- GRANT explícito para authenticated nas funções que o app chama (mantém o acesso após o REVOKE de PUBLIC)
GRANT EXECUTE ON FUNCTION public.my_stores() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_store_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_store(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_store(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_store_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_store_member(uuid, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_store_member(uuid, uuid, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_store_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._require_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_clients() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_client(text, text, text[], text, integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_status(uuid, text, integer, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_store_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_store_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_store_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_access_ok(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

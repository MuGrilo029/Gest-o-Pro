// Edge Function: manage-users
//
// Cria contas (e-mail + senha) e troca senhas sem cadastro público.
//
//   create_member  -> cria a conta (ou reaproveita uma existente) e coloca na loja
//   set_password   -> define uma nova senha para alguém da loja
//
// Quem pode:
//   * Administrador da plataforma: qualquer papel, qualquer loja.
//   * Dono/gerente da loja: só VENDEDORES da própria loja.
//
// A chave service_role fica só aqui no servidor (injetada pelo Supabase).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_ROLES = ['OWNER', 'MANAGER', 'SELLER'];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const fail = (message: string, status = 400) => json({ error: message }, status);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Método não permitido.', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return fail('Faça login novamente.', 401);

  // Cliente com a identidade de quem chamou: as checagens usam auth.uid().
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData?.user) return fail('Faça login novamente.', 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail('Requisição inválida.');
  }

  const storeId: string | undefined = body.store_id;
  if (!storeId) return fail('Loja não informada.');

  const { data: isAdmin } = await caller.rpc('is_platform_admin');
  const { data: isManager } = await caller.rpc('is_store_manager', { p_store: storeId });
  if (!isAdmin && !isManager) return fail('Sem permissão para gerenciar esta loja.', 403);

  const { data: store } = await admin.from('stores').select('id').eq('id', storeId).maybeSingle();
  if (!store) return fail('Loja não encontrada.', 404);

  const validPassword = (p: unknown) => typeof p === 'string' && p.length >= 6;

  // -------------------------------------------------------------------------
  if (body.action === 'create_member') {
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    const role = String(body.role || 'SELLER');
    const permissions: string[] = Array.isArray(body.permissions) ? body.permissions.map(String) : [];

    if (!email || !email.includes('@')) return fail('Informe um e-mail válido.');
    if (!VALID_ROLES.includes(role)) return fail('Papel inválido.');
    if (role !== 'SELLER' && !isAdmin) return fail('Dono e gerente só podem criar vendedores.', 403);

    // Procura uma conta existente com o e-mail.
    let userId: string | null = null;
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return fail('Erro ao consultar contas.', 500);
      userId = data.users.find((u: any) => u.email?.toLowerCase() === email)?.id ?? null;
      if (data.users.length < 1000) break;
    }

    const wasExisting = !!userId;
    if (!userId) {
      if (!validPassword(body.password)) return fail('A senha precisa ter pelo menos 6 caracteres.');
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: body.password,
        email_confirm: true,
        user_metadata: { name: name || email },
      });
      if (error || !created?.user) return fail(error?.message || 'Não foi possível criar a conta.', 500);
      userId = created.user.id;
    } else if (!isAdmin) {
      // Gerente não pode rebaixar dono/gerente nem mexer em quem já é de outra loja como gestor.
      const { data: existing } = await admin
        .from('store_members').select('role').eq('store_id', storeId).eq('user_id', userId).maybeSingle();
      if (existing && existing.role !== 'SELLER') return fail('Essa pessoa já é dona ou gerente desta loja.', 403);
    }

    if (name) await admin.from('profiles').update({ name }).eq('id', userId);

    const { error: memberError } = await admin.from('store_members').upsert(
      { store_id: storeId, user_id: userId, role, permissions: role === 'SELLER' ? permissions : [] },
      { onConflict: 'store_id,user_id' },
    );
    if (memberError) return fail(memberError.message, 500);

    await admin.from('profiles').update({ active_store_id: storeId }).eq('id', userId).is('active_store_id', null);

    return json({ ok: true, user_id: userId, existing_account: wasExisting });
  }

  // -------------------------------------------------------------------------
  if (body.action === 'set_password') {
    const userId = String(body.user_id || '');
    if (!userId) return fail('Pessoa não informada.');
    if (!validPassword(body.password)) return fail('A senha precisa ter pelo menos 6 caracteres.');

    const { data: member } = await admin
      .from('store_members').select('role').eq('store_id', storeId).eq('user_id', userId).maybeSingle();
    if (!member) return fail('Pessoa não encontrada nesta loja.', 404);
    if (!isAdmin && member.role !== 'SELLER') return fail('Dono e gerente só trocam a senha de vendedores.', 403);

    const { error } = await admin.auth.admin.updateUserById(userId, { password: body.password });
    if (error) return fail(error.message, 500);
    return json({ ok: true });
  }

  return fail('Ação desconhecida.');
});

// Edge Function: manage-users
//
// Cria contas (e-mail + senha) e troca senhas sem cadastro público.
//
//   create_member  -> cria a conta e coloca na loja
//   set_password   -> define uma nova senha para alguém da loja
//   create_store          -> (só admin) cria o login do dono e a loja, sem sobra se algo falhar (migração 067)
//   delete_store_preview  -> (só admin) contagens do que a exclusão apaga e do que fica (migração 066)
//   delete_store          -> (só admin) apaga dados, arquivos e logins elegíveis; repetível (migração 066)
//
// Quem pode:
//   * Administrador da plataforma: qualquer papel, qualquer loja.
//   * Dono/gerente da loja: só VENDEDORES da própria loja, e só contas que
//     pertencem exclusivamente a essa loja (nunca contas de outras lojas nem
//     administradores).
//
// A chave service_role fica só aqui no servidor (injetada pelo Supabase).
// Segredos: ALLOWED_ORIGINS (lista de origens do site, separadas por vírgula).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { allow, clientKey } from '../_shared/rateLimit.ts';
import { createStore, deleteStore, previewDeleteStore, UNCONFIRMED_MEMBER } from '../_shared/storeAdmin.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const VALID_ROLES = ['OWNER', 'MANAGER', 'SELLER'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERMISSION_RE = /^[A-Z0-9_]{1,40}$/;

// Política de senha (decisão 42 do dono): 8 a 72 caracteres, sem exigir números. Igual a lib/utils.ts.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72; // limite do bcrypt
// Senha provisória quando o ADMIN da plataforma cria a conta sem informar senha (decisão 40).
// Risco registrado pela Segurança; troca obrigatória no 1º acesso só com confirmação do dono.
const ADMIN_DEFAULT_PASSWORD = '12345678';

const passwordProblem = (p: unknown): string | null => {
  if (typeof p !== 'string') return 'Informe a senha.';
  if (p.length < PASSWORD_MIN) return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`;
  if (p.length > PASSWORD_MAX) return `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`;
  return null;
};

/** Senha provisória aleatória (16 caracteres, sem símbolos ambíguos), quando dono/gerente cria sem senha. */
const generatePassword = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const pwd = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    if (!passwordProblem(pwd)) return pwd;
  }
};

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  const fail = (message: string, status = 400) => json({ error: message }, status);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Método não permitido.', 405);

  // Rate limit por IP (30 req/min por instância)
  if (!allow(clientKey(req, 'manage-users'), 30, 60_000)) {
    return fail('Muitas requisições. Tente novamente em instantes.', 429);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return fail('Faça login novamente.', 401);

  // Cliente com a identidade de quem chamou: as checagens usam auth.uid().
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // getUser precisa do token do chamador: com persistSession false não há sessão guardada.
  const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const { data: userData, error: userError } = await caller.auth.getUser(callerToken);
  if (userError || !userData?.user) return fail('Faça login novamente.', 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail('Requisição inválida.');
  }

  const { data: isAdmin } = await caller.rpc('is_platform_admin');

  // Ações do dono do SaaS: conferidas aqui e de novo em cada RPC no banco.
  if (['create_store', 'delete_store_preview', 'delete_store'].includes(body?.action)) {
    if (isAdmin !== true) return fail('Apenas o administrador da plataforma pode fazer isso.', 403);
    const reply = body.action === 'create_store' ? await createStore(caller, admin, body, ADMIN_DEFAULT_PASSWORD)
      : body.action === 'delete_store' ? await deleteStore(caller, admin, body)
      : await previewDeleteStore(caller, body);
    return json(reply.body, reply.status);
  }

  const storeId = typeof body?.store_id === 'string' ? body.store_id : '';
  if (!UUID_RE.test(storeId)) return fail('Loja não informada.');

  const { data: isManager } = await caller.rpc('is_store_manager', { p_store: storeId });
  if (!isAdmin && !isManager) return fail('Sem permissão para gerenciar esta loja.', 403);

  const { data: store } = await admin.from('stores').select('id').eq('id', storeId).maybeSingle();
  if (!store) return fail('Loja não encontrada.', 404);

  // -------------------------------------------------------------------------
  if (body.action === 'create_member') {
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim().slice(0, 120);
    const role = String(body.role || 'SELLER');
    const permissions: string[] = Array.isArray(body.permissions)
      ? body.permissions.map(String).filter((p: string) => PERMISSION_RE.test(p)).slice(0, 40)
      : [];

    if (!EMAIL_RE.test(email) || email.length > 254) return fail('Informe um e-mail válido.');
    if (!VALID_ROLES.includes(role)) return fail('Papel inválido.');
    if (role !== 'SELLER' && !isAdmin) return fail('Dono e gerente só podem criar vendedores.', 403);

    // Procura conta existente pelo e-mail (profiles espelha auth.users).
    const { data: existingProfile } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
    let userId: string | null = existingProfile?.id ?? null;
    let wasExisting = !!userId;
    let createdNow = false;
    let temporaryPassword: string | null = null;

    // Mensagem única para qualquer recusa ligada a conta já existente: o
    // dono/gerente não consegue descobrir quais e-mails têm conta no sistema.
    const REFUSED = 'Não foi possível adicionar este e-mail. Solicite ao administrador da plataforma.';

    if (!userId) {
      let password = body.password;
      if (password === undefined || password === null || password === '') {
        password = isAdmin ? ADMIN_DEFAULT_PASSWORD : generatePassword();
        temporaryPassword = password;
      } else {
        const problem = passwordProblem(password);
        if (problem) return fail(problem);
      }
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: name || email },
      });
      if (error || !created?.user) {
        // Conta existe em auth mas sem perfil (ou corrida): não detalha o motivo.
        console.error('createUser falhou:', error?.message);
        return fail(isAdmin ? error?.message || 'Não foi possível criar a conta.' : REFUSED, 409);
      }
      userId = created.user.id;
      createdNow = true;
    } else {
      // Conta existente só ganha vínculo novo se o e-mail estiver confirmado (senão quem cadastrou o e-mail de
      // outra pessoa entraria na loja). Quem já é membro desta loja pode ter o vínculo atualizado.
      const { data: link } = await admin
        .from('store_members').select('role').eq('store_id', storeId).eq('user_id', userId).maybeSingle();
      if (!link) {
        const { data: account, error: accountError } = await admin.auth.admin.getUserById(userId);
        if (accountError || !account?.user) return fail(isAdmin ? 'Não foi possível conferir a conta.' : REFUSED, 409);
        if (!account.user.email_confirmed_at) return fail(isAdmin ? UNCONFIRMED_MEMBER : REFUSED, 409);
      }
    }

    if (wasExisting && !isAdmin) {
      // Dono/gerente só mexe em quem já é VENDEDOR desta loja (atualiza permissões).
      // Conta de outra loja, administrador, dono ou gerente: recusa genérica.
      const { data: existing } = await admin
        .from('store_members').select('role').eq('store_id', storeId).eq('user_id', userId).maybeSingle();
      if (!existing || existing.role !== 'SELLER') return fail(REFUSED, 409);
      wasExisting = false; // não revela nada ao chamador
    }

    // Só atualiza o nome de contas novas ou quando é o administrador.
    if (name && (isAdmin || !existingProfile)) await admin.from('profiles').update({ name }).eq('id', userId);

    const { error: memberError } = await admin.from('store_members').upsert(
      { store_id: storeId, user_id: userId, role, permissions: role === 'SELLER' ? permissions : [] },
      { onConflict: 'store_id,user_id' },
    );
    if (memberError) {
      console.error('upsert store_members falhou:', memberError.message);
      // Conta recém-criada sem vínculo não fica órfã.
      if (createdNow && userId) await admin.auth.admin.deleteUser(userId);
      // Regras do banco com mensagem para a tela (migrações 049 e 050).
      const msg = memberError.message || '';
      if (msg.includes('LIMITE_VENDEDORES:') || msg.includes('UMA_LOJA_POR_DONO:') || msg.includes('LOJA_EXCLUIDA:')) return fail(msg, 409);
      return fail('Não foi possível salvar o membro.', 500);
    }

    await admin.from('profiles').update({ active_store_id: storeId }).eq('id', userId).is('active_store_id', null);

    const result: Record<string, unknown> = { ok: true, user_id: userId };
    if (isAdmin) result.existing_account = wasExisting;
    if (temporaryPassword) result.temporary_password = temporaryPassword; // exibida uma única vez
    return json(result);
  }

  // -------------------------------------------------------------------------
  if (body.action === 'set_password') {
    const userId = typeof body.user_id === 'string' ? body.user_id : '';
    if (!UUID_RE.test(userId)) return fail('Pessoa não informada.');

    let password = body.password;
    let temporaryPassword: string | null = null;
    if (password === undefined || password === null || password === '') {
      password = generatePassword();
      temporaryPassword = password;
    } else {
      const problem = passwordProblem(password);
      if (problem) return fail(problem);
    }

    const { data: member } = await admin
      .from('store_members').select('role').eq('store_id', storeId).eq('user_id', userId).maybeSingle();
    if (!member) return fail('Pessoa não encontrada nesta loja.', 404);

    if (!isAdmin) {
      if (member.role !== 'SELLER') return fail('Dono e gerente só trocam a senha de vendedores.', 403);

      // Anti-sequestro de conta: dono/gerente só troca senha de quem pertence
      // SOMENTE a esta loja e não é administrador da plataforma.
      const { data: target } = await admin.from('profiles').select('is_platform_admin').eq('id', userId).maybeSingle();
      const { count } = await admin
        .from('store_members').select('store_id', { count: 'exact', head: true }).eq('user_id', userId);
      if (target?.is_platform_admin || (count ?? 0) !== 1) {
        return fail('Esta conta não pode ser alterada pela loja. Solicite ao administrador da plataforma.', 403);
      }
    }

    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) {
      console.error('updateUserById falhou:', error.message);
      return fail('Não foi possível alterar a senha.', 500);
    }
    return json(temporaryPassword ? { ok: true, temporary_password: temporaryPassword } : { ok: true });
  }

  return fail('Ação desconhecida.');
});

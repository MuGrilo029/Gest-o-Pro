// Criação e exclusão de loja pelo administrador da plataforma (ações da manage-users).
// Sem Deno nem imports externos: os clientes chegam prontos, para o teste local com dublês.
//   caller = cliente com o JWT de quem chamou (o banco confere is_platform_admin em cada RPC);
//   admin  = cliente service_role (só Auth e Storage).

export interface Reply { status: number; body: Record<string, unknown> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLANS = ['inicio', 'crescimento', 'avancado'];
const FILE_BATCH = 100;
const MAX_FILE_BATCHES = 100; // até 10 mil arquivos por chamada; o resto sai na repetição

const ok = (body: Record<string, unknown>): Reply => ({ status: 200, body: { ok: true, ...body } });
const fail = (error: string, status = 400): Reply => ({ status, body: { error } });

/** Mensagens de regra do banco vão para a tela; erro inesperado vira frase genérica. */
const BUSINESS_RE = /^(UMA_LOJA_POR_DONO|REQUISICAO_REUTILIZADA|CONTA_INEXISTENTE|NOME_NAO_CONFERE|ASSINATURA_NO_GATEWAY|TABELA_SEM_TRATAMENTO|REFERENCIA_ENTRE_LOJAS|LOJA_EXCLUIDA):|^(Loja não encontrada|Plano inválido|Prazo inválido|Informe |Apenas o administrador)/;
const dbFail = (error: any, fallback: string): Reply => {
  const message = String(error?.message || '');
  if (BUSINESS_RE.test(message)) return fail(message, message.startsWith('Loja não encontrada') ? 404 : 409);
  console.error('storeAdmin: erro no banco', error?.code ?? '', message);
  return fail(fallback, 500);
};

export async function createStore(caller: any, admin: any, body: any, tempPassword: string): Promise<Reply> {
  const requestId = typeof body?.request_id === 'string' ? body.request_id : '';
  const storeName = String(body?.store_name || '').trim().slice(0, 120);
  const ownerName = String(body?.owner_name || '').trim().slice(0, 120);
  const email = String(body?.email || '').trim().toLowerCase();
  const plan = String(body?.plan || '');
  const mode = String(body?.mode || 'trial');
  const days = body?.days === undefined || body?.days === null || body?.days === '' ? null : Number(body.days);

  if (!UUID_RE.test(requestId)) return fail('Informe o identificador da requisição (request_id).');
  if (storeName.length < 2) return fail('Informe o nome da loja.');
  if (ownerName.length < 2) return fail('Informe o nome do dono.');
  if (!EMAIL_RE.test(email) || email.length > 254) return fail('Informe um e-mail válido.');
  if (!PLANS.includes(plan)) return fail('Plano inválido. Use inicio, crescimento ou avancado.');
  if (mode !== 'trial' && mode !== 'paid') return fail('Modo inválido (use trial ou paid).');
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) return fail('Prazo inválido (1 a 3650 dias).');

  const lookup = async () => caller.rpc('admin_lookup_login', { p_email: email, p_request_id: requestId });
  const first = await lookup();
  if (first.error) return dbFail(first.error, 'Não foi possível conferir o e-mail. Nada foi criado.');
  let info = first.data;
  // Conta que já é dona de outra loja: recusa antes de criar qualquer coisa.
  if (info.owns_other_store) return fail('UMA_LOJA_POR_DONO: esta conta já é dona de outra loja.', 409);

  let userId: string | null = info.user_id;
  let createdNow = false;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name: ownerName },
      app_metadata: { gp_store_request: requestId },
    });
    if (error || !data?.user) {
      // Duas chamadas ao mesmo tempo: a outra pode ter criado o login.
      const again = await lookup();
      if (again.error || !again.data?.user_id) {
        console.error('createUser falhou:', error?.message);
        return fail('Não foi possível criar o login do dono. Nenhuma loja foi criada.', 502);
      }
      info = again.data;
      userId = info.user_id;
    } else {
      userId = data.user.id;
      createdNow = true;
    }
  }

  const created = await caller.rpc('admin_create_store_with_owner', {
    p_request_id: requestId, p_owner: userId, p_store_name: storeName, p_plan: plan, p_mode: mode, p_days: days,
  });
  if (created.error) {
    if (createdNow) {
      // Só remove o login criado nesta chamada, e só se ele não ficou ligado a nenhuma loja.
      const check = await lookup();
      const linked = check.error ? true : Number(check.data?.memberships) > 0;
      if (!linked) {
        const { error: delError } = await admin.auth.admin.deleteUser(userId);
        if (delError) {
          console.error('deleteUser (compensação) falhou:', delError.message);
          return fail('A loja não foi criada e o login novo não pôde ser removido. Repita a tentativa para concluir.', 500);
        }
      }
    }
    return dbFail(created.error, 'Não foi possível criar a loja. Nada ficou criado; pode tentar de novo.');
  }

  // Também conta como conta nova o login deixado por uma tentativa anterior deste fluxo (ou por uma chamada
  // simultânea): nunca usado, ainda com a senha provisória. `info` é a leitura anterior à criação da loja.
  const leftover = !!info.user_id && !!info.marker && !info.signed_in
    && (info.marker === requestId || Number(info.memberships) === 0);
  const accountCreated = createdNow || leftover;
  return ok({
    store_id: created.data.store_id,
    already_created: !!created.data.already_created,
    account_created: accountCreated,
    temporary_password: accountCreated ? tempPassword : null,
  });
}

export async function previewDeleteStore(caller: any, body: any): Promise<Reply> {
  const storeId = typeof body?.store_id === 'string' ? body.store_id : '';
  if (!UUID_RE.test(storeId)) return fail('Loja não informada.');
  const { data, error } = await caller.rpc('admin_delete_store_preview', { p_store: storeId });
  if (error) return dbFail(error, 'Não foi possível montar a prévia.');
  return ok({ preview: data });
}

export async function deleteStore(caller: any, admin: any, body: any): Promise<Reply> {
  const storeId = typeof body?.store_id === 'string' ? body.store_id : '';
  const confirmName = typeof body?.confirm_name === 'string' ? body.confirm_name : '';
  if (!UUID_RE.test(storeId)) return fail('Loja não informada.');
  if (!confirmName.trim()) return fail('NOME_NAO_CONFERE: digite o nome exato da loja para excluir.', 409);

  // 1. Banco (uma transação). Falhou aqui: nada mudou.
  const dbStep = await caller.rpc('admin_delete_store', { p_store: storeId, p_confirm_name: confirmName });
  if (dbStep.error) return dbFail(dbStep.error, 'Não foi possível excluir a loja. Nada foi apagado.');

  const errors: string[] = [];
  let filesRemoved = 0;
  let loginsDeleted = 0;

  // 2. Arquivos. A lista é relida no banco até zerar; sem progresso, para.
  let previous = '';
  for (let i = 0; i < MAX_FILE_BATCHES; i++) {
    const { data, error } = await caller.rpc('admin_store_deletion_files', { p_store: storeId, p_limit: FILE_BATCH });
    if (error) { errors.push('Não foi possível listar os arquivos.'); break; }
    const files: { bucket_id: string; name: string }[] = data || [];
    if (!files.length) break;
    const signature = files.map(f => `${f.bucket_id}/${f.name}`).join('\n');
    if (signature === previous) { errors.push('Alguns arquivos não foram removidos.'); break; }
    previous = signature;
    let failed = false;
    for (const bucket of [...new Set(files.map(f => f.bucket_id))]) {
      const names = files.filter(f => f.bucket_id === bucket).map(f => f.name);
      const { error: removeError } = await admin.storage.from(bucket).remove(names);
      if (removeError) {
        console.error('storage.remove falhou:', bucket, removeError.message);
        errors.push(`Não foi possível apagar arquivos de ${bucket}.`);
        failed = true;
      } else {
        filesRemoved += names.length;
      }
    }
    if (failed) break;
  }

  // 3. Logins, só depois dos arquivos.
  if (!errors.length) {
    const { data, error } = await caller.rpc('admin_deletion_pending_logins', { p_store: storeId });
    if (error) errors.push('Não foi possível listar os logins.');
    for (const row of (data || []) as { user_id: string }[]) {
      const { error: delError } = await admin.auth.admin.deleteUser(row.user_id);
      if (delError) {
        console.error('deleteUser falhou:', delError.message);
        errors.push('Um login não pôde ser apagado.');
      } else {
        loginsDeleted++;
      }
    }
  }

  // 4. O que sobrou, conferido no banco.
  const state = await caller.rpc('admin_delete_store_status', { p_store: storeId });
  if (state.error) {
    return ok({ store_id: storeId, status: 'parcial', files_removed: filesRemoved, logins_deleted: loginsDeleted,
      errors: [...errors, 'Não foi possível conferir o resultado. Repita a exclusão.'] });
  }
  return ok({ ...state.data, files_removed: filesRemoved, logins_deleted: loginsDeleted, errors });
}

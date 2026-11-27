// Exclusão de loja (066): RPCs no PGlite e index.ts real da manage-users com dublês de Auth e Storage.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { loadManageUsers } from '../doubles/edgeHarness';

let t: TestDb;
let fn: Awaited<ReturnType<typeof loadManageUsers>>;
let admin: string, admin2: string;

beforeAll(async () => {
  t = await createTestDb();
  fn = await loadManageUsers(t);
  admin = await t.createUser('admin@teste.local', { platformAdmin: true });
  admin2 = await t.createUser('admin2@teste.local', { platformAdmin: true });
}, 120_000);
afterAll(async () => { await t?.close(); });
beforeEach(() => { for (const k of Object.keys(fn.faults)) delete (fn.faults as any)[k]; });

interface Full { id: string; name: string; owner: string; manager: string; seller: string }
let seq = 0;

/** Loja com dados em todas as tabelas que a exclusão trata, arquivos nos dois buckets e três logins. */
async function fullStore(name: string): Promise<Full> {
  const n = ++seq;
  const owner = await t.createUser(`dono${n}@teste.local`);
  const id = await t.createStore(name, owner, { plan: 'avancado' });
  await t.sql('SELECT public.apply_store_modules($1)', [id]);
  const manager = await t.createUser(`gerente${n}@teste.local`);
  const seller = await t.createUser(`vend${n}@teste.local`);
  await t.addMember(id, manager, 'MANAGER');
  await t.addMember(id, seller, 'SELLER');
  const one = async (q: string, p: unknown[] = [id]) => (await t.sql<any>(q, p))[0].id as string;
  const product = await one(`INSERT INTO products (name, price, quantity, store_id) VALUES ('P', 10, 20, $1) RETURNING id`);
  const empty = await one(`INSERT INTO products (name, price, quantity, store_id) VALUES ('Z', 10, 0, $1) RETURNING id`);
  const group = await one(`INSERT INTO category_groups (name, store_id) VALUES ('G', $1) RETURNING id`);
  await t.sql(`INSERT INTO categories (name, type, group_id, store_id) VALUES ('C', 'EXPENSE', $2, $1)`, [id, group]);
  await t.sql(`INSERT INTO customers (name, store_id) VALUES ('Cli', $1)`, [id]);
  const supplier = await one(`INSERT INTO suppliers (name, store_id) VALUES ('F', $1) RETURNING id`);
  await t.sql(`INSERT INTO card_fees (installments, percentage, store_id) VALUES (1, 2, $1)`, [id]);
  await t.sql(`INSERT INTO simulations (description, amount, due_date, group_id, store_id) VALUES ('S', 1, now(), gen_random_uuid(), $1)`, [id]);
  await t.as(owner, `SELECT create_sale($1::jsonb, $2::jsonb)`, [
    JSON.stringify({ total: 120, payment_type: 'FULL', payment_method: 'PIX', delivery_type: 'DELIVERY' }),
    JSON.stringify([{ product_id: product, product_name: 'P', quantity: 1, unit_price: 10 },
      { product_id: empty, product_name: 'Z', quantity: 1, unit_price: 10 },
      { product_name: 'Serv', category: 'Serviços', service_type: 'INTERNAL', quantity: 1, unit_price: 100 }])]);
  const tx = await one(`INSERT INTO transactions (description, amount, type, category, supplier_id, store_id) VALUES ('Compra', 5, 'EXPENSE', 'C', $2, $1) RETURNING id`, [id, supplier]);
  await t.sql(`INSERT INTO transaction_payments (transaction_id, amount, store_id) VALUES ($2, 5, $1)`, [id, tx]);
  const quote = await one(`INSERT INTO quotes (quote_number, client_name, total, store_id) VALUES ('1', 'Cli', 10, $1) RETURNING id`);
  await t.sql(`INSERT INTO quote_items (quote_id, product_id, product_name, quantity, unit_price, total, store_id) VALUES ($2, $3, 'P', 1, 10, 10, $1)`, [id, quote, product]);
  const wh = (await t.as<any>(owner, `SELECT upsert_warehouse('Dep') id`))[0].id;
  const def = await one(`SELECT id FROM warehouses WHERE store_id = $1 AND is_default`);
  await t.as(owner, `SELECT stock_transfer($1, $2, $3, 2)`, [product, def, wh]);
  await t.sql(`INSERT INTO store_module_overrides (store_id, module_key, action) VALUES ($1, 'deliveries', 'grant')`, [id]);
  await t.sql(`INSERT INTO invoices (store_id, amount_cents) VALUES ($1, 100)`, [id]);
  await t.sql(`INSERT INTO subscription_payments (store_id, amount, method, period_days) VALUES ($1, 1, 'pix', 30)`, [id]);
  await t.as(owner, `SELECT record_terms_acceptance('v1')`);
  await t.sql(`INSERT INTO storage.objects (bucket_id, name) VALUES ('products', $1 || '/a.jpg'), ('products', $1 || '/sub/b.jpg'), ('producao-anexos', $1 || '/c.pdf'), ('boletos', $1 || '/d.pdf')`, [id]);
  return { id, name, owner, manager, seller };
}

/** Contagem por tabela com store_id (mais arquivos e membros), para provar que nada mudou. */
async function snapshot(store: string) {
  const tabs = await t.sql<any>(`SELECT table_name n FROM information_schema.columns c WHERE table_schema = 'public' AND column_name = 'store_id'
    AND EXISTS (SELECT 1 FROM information_schema.tables x WHERE x.table_schema = 'public' AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE') ORDER BY 1`);
  const r: Record<string, number> = {};
  for (const { n } of tabs) r[n] = (await t.sql<any>(`SELECT count(*)::int c FROM public."${n}" WHERE store_id = $1`, [store]))[0].c;
  r.files = (await t.sql<any>(`SELECT count(*)::int c FROM storage.objects WHERE name LIKE $1 || '/%'`, [store]))[0].c;
  return r;
}
const del = (store: string, name: string, who: string = admin) => fn.call(who, { action: 'delete_store', store_id: store, confirm_name: name });
const loginExists = async (id: string) => (await t.sql('SELECT 1 FROM auth.users WHERE id = $1', [id])).length === 1;

describe('cobertura de tabelas', () => {
  it('toda tabela com store_id está na lista de apagar ou na de reter, sem repetição', async () => {
    const rows = await t.sql<any>(`SELECT c.table_name n FROM information_schema.columns c JOIN information_schema.tables x
      ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'store_id' ORDER BY 1`);
    const [{ d, k }] = await t.sql<any>('SELECT public._store_delete_tables() d, public._store_retained_tables() k');
    expect(new Set([...d, ...k]).size).toBe(d.length + k.length);
    // Se falhar: decida se a tabela nova é apagada ou retida e atualize a lista numa migração.
    expect(rows.map(r => r.n)).toEqual([...d, ...k].sort());
  });

  it('tabela nova sem tratamento: a exclusão é recusada e nada muda', async () => {
    const s = await fullStore('Loja Tabela Nova');
    await t.sql('CREATE TABLE public.zz_nova (store_id uuid)');
    try {
      const before = await snapshot(s.id);
      const res = await del(s.id, s.name);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/^TABELA_SEM_TRATAMENTO:.*zz_nova/);
      expect(await snapshot(s.id)).toEqual(before);
    } finally {
      await t.sql('DROP TABLE public.zz_nova');
    }
  });

  it('a loja de teste tem linhas em todas as tabelas apagáveis', async () => {
    const s = await fullStore('Loja Cobertura');
    const [{ d }] = await t.sql<any>('SELECT public._store_delete_tables() d');
    const snap = await snapshot(s.id);
    expect(d.filter((n: string) => !snap[n])).toEqual([]);
  });
});

describe('quem pode e confirmação', () => {
  let s: Full;
  beforeAll(async () => { s = await fullStore('Loja Protegida'); });

  it('dono, gerente, vendedor e anônimo são recusados na função e no banco', async () => {
    const before = await snapshot(s.id);
    for (const who of [s.owner, s.manager, s.seller]) {
      expect((await del(s.id, s.name, who)).status).toBe(403);
      expect((await fn.call(who, { action: 'delete_store_preview', store_id: s.id })).status).toBe(403);
      for (const q of ['SELECT admin_delete_store($1, $2)', 'SELECT admin_delete_store_preview($1)', 'SELECT * FROM admin_store_deletion_files($1)',
        'SELECT * FROM admin_deletion_pending_logins($1)', 'SELECT admin_delete_store_status($1)']) {
        expect(await t.fails(who, q, q.includes('$2') ? [s.id, s.name] : [s.id]), q).toMatch(/administrador da plataforma/);
      }
      expect(await t.fails(who, `SELECT _store_login_keep_reason($1, $2)`, [s.owner, s.id])).toMatch(/permission denied/);
    }
    expect(await t.fails(null, 'SELECT admin_delete_store($1, $2)', [s.id, s.name])).toMatch(/permission denied/);
    expect((await fn.call(null, { action: 'delete_store', store_id: s.id, confirm_name: s.name })).status).toBe(401);
    expect(await snapshot(s.id)).toEqual(before);
  });

  it('nome errado, parcial, com outra caixa ou vazio é recusado e nada muda', async () => {
    const before = await snapshot(s.id);
    for (const name of ['', 'Loja', 'loja protegida', 'Loja Protegida X']) {
      const res = await del(s.id, name);
      expect(res.status, name).toBe(409);
      expect(res.body.error).toMatch(/^NOME_NAO_CONFERE:/);
    }
    expect(await snapshot(s.id)).toEqual(before);
    expect(fn.calls.removed).toEqual([]);
  });

  it('prévia conta o que sai e o que fica, sem alterar nada', async () => {
    const before = await snapshot(s.id);
    const { body } = await fn.call(admin, { action: 'delete_store_preview', store_id: s.id });
    expect(body.preview.store).toMatchObject({ id: s.id, name: s.name, deleted_at: null });
    expect(body.preview.rows).toMatchObject({ sales: 1, sale_items: 3, store_members: 3, products: 2 });
    expect(body.preview.storage).toEqual({ products: 2, 'producao-anexos': 1, boletos: 1 });
    expect(body.preview.retained).toMatchObject({ terms_acceptances: 1, subscription_payments: 1, invoices: 1 });
    expect(body.preview.logins.map((l: any) => [l.role, l.action])).toEqual([['OWNER', 'apagar'], ['MANAGER', 'apagar'], ['SELLER', 'apagar']]);
    expect(body.preview).toMatchObject({ logins_rule: 'recomendada_pendente_do_dono', blocker: null });
    expect(await snapshot(s.id)).toEqual(before);
  });
});

describe('exclusão', () => {
  it('apaga dados, arquivos e logins só desta loja; loja B intacta; retidos ficam', async () => {
    const a = await fullStore('Loja A Excluir');
    const b = await fullStore('Loja B Fica');
    // Gerente de A também é vendedor de B (fica); admin da plataforma membro de A (fica).
    await t.addMember(b.id, a.manager, 'SELLER');
    await t.addMember(a.id, admin2, 'MANAGER');
    const beforeB = await snapshot(b.id);
    const res = await del(a.id, '  Loja A Excluir ');
    expect(res.body).toMatchObject({ ok: true, status: 'concluida', files_removed: 4, logins_deleted: 2, storage_remaining: 0, logins_remaining: 0, errors: [] });
    expect(res.body.logins_kept.map((l: any) => l.reason).sort()).toEqual(['admin_da_plataforma', 'tem_outra_loja']);
    const after = await snapshot(a.id);
    const [{ d }] = await t.sql<any>('SELECT public._store_delete_tables() d');
    for (const tab of d) expect(after[tab], tab).toBe(0);
    expect(after.files).toBe(0);
    expect(after).toMatchObject({ terms_acceptances: 1, subscription_payments: 1, invoices: 1, store_deletions: 1 });
    expect(after.admin_audit_logs).toBeGreaterThan(0);
    expect(await snapshot(b.id)).toEqual(beforeB);
    expect([await loginExists(a.owner), await loginExists(a.seller), await loginExists(a.manager), await loginExists(admin2)]).toEqual([false, false, true, true]);
    expect([await loginExists(b.owner), await loginExists(b.manager), await loginExists(b.seller)]).toEqual([true, true, true]);
    // O aceite dos Termos sobrevive ao login apagado.
    expect(await t.sql('SELECT 1 FROM terms_acceptances WHERE user_id = $1', [a.owner])).toHaveLength(1);

    const [st] = await t.sql<any>('SELECT name, is_active, status, deleted_at, contact_email, plan FROM stores WHERE id = $1', [a.id]);
    expect(st).toMatchObject({ name: 'Loja A Excluir', is_active: false, status: 'expired', contact_email: null, plan: null });
    expect(st.deleted_at).not.toBeNull();
    const [{ r }] = await t.as<any>(admin, `SELECT admin_list_stores('{}'::jsonb, 100) r`);
    expect(r.items.map((i: any) => i.id)).not.toContain(a.id);
    expect(r.items.map((i: any) => i.id)).toContain(b.id);
  });

  it('loja excluída não volta: sem estender, trocar plano, override ou novo membro', async () => {
    const [{ id }] = await t.sql<any>(`SELECT id FROM stores WHERE name = 'Loja A Excluir'`);
    for (const q of [`SELECT admin_set_status($1, 'active', NULL, NULL, false)`, `SELECT admin_extend_store($1, NULL, 30)`,
      `SELECT admin_request_plan_change($1, 'inicio')`, `SELECT admin_set_module_override($1, 'deliveries', true)`]) {
      await expect(t.as(admin, q, [id]), q).rejects.toThrow(/LOJA_EXCLUIDA|encerrada|excluída/);
    }
    await expect(t.addMember(id, admin2, 'SELLER')).rejects.toThrow(/LOJA_EXCLUIDA/);
    await expect(t.sql(`INSERT INTO products (name, price, store_id) VALUES ('volta', 1, $1)`, [id])).rejects.toThrow(/LOJA_EXCLUIDA/);
    const [{ d }] = await t.sql<any>('SELECT public._store_delete_tables() d');
    const after = await snapshot(id);
    for (const tab of d) expect(after[tab], tab).toBe(0);
  });

  it('repetir depois de concluída não faz nada e continua exigindo o nome', async () => {
    const [{ id }] = await t.sql<any>(`SELECT id FROM stores WHERE name = 'Loja A Excluir'`);
    expect((await del(id, 'errado')).status).toBe(409);
    expect((await del(id, 'Loja A Excluir')).body).toMatchObject({ status: 'concluida', files_removed: 0, logins_deleted: 0 });
  });

  it('falha no meio do banco: nada pela metade e nenhum arquivo tocado; repetir conclui', async () => {
    const s = await fullStore('Loja Falha Banco');
    const before = await snapshot(s.id);
    await t.sql(`CREATE FUNCTION public.zz_falha() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END $$`);
    await t.sql(`CREATE TRIGGER zz_falha BEFORE DELETE ON public.store_members FOR EACH ROW EXECUTE FUNCTION public.zz_falha()`);
    const removed = fn.calls.removed.length;
    const res = await del(s.id, s.name);
    await t.sql('DROP TRIGGER zz_falha ON public.store_members');
    await t.sql('DROP FUNCTION public.zz_falha()');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Nada foi apagado/);
    expect(await snapshot(s.id)).toEqual(before);
    expect(fn.calls.removed).toHaveLength(removed);
    expect((await del(s.id, s.name)).body.status).toBe('concluida');
  });

  it('falha no Storage: parcial, logins preservados; repetir continua de onde parou', async () => {
    const s = await fullStore('Loja Falha Storage');
    fn.faults.storageError = 'products';
    const res = await del(s.id, s.name);
    expect(res.body).toMatchObject({ status: 'parcial', storage_remaining: 2, logins_remaining: 3, logins_deleted: 0 });
    expect(res.body.errors[0]).toMatch(/products/);
    expect(await loginExists(s.owner)).toBe(true);
    const listed = async () => (await t.as<any>(admin, `SELECT admin_list_stores('{"q":"loja falha storage"}'::jsonb) r`))[0].r.items;
    expect(await listed()).toMatchObject([{ id: s.id, name: s.name, exclusao_pendente: true }]);
    delete fn.faults.storageError;
    expect((await del(s.id, s.name)).body).toMatchObject({ status: 'concluida', files_removed: 2, logins_deleted: 3 });
    const [d] = await t.sql<any>('SELECT storage_done_at, logins_done_at FROM store_deletions WHERE store_id = $1', [s.id]);
    expect(d.storage_done_at && d.logins_done_at).toBeTruthy();
    expect(await listed()).toEqual([]);
  });

  it('Storage que responde sucesso sem apagar: para sem laço infinito e fica parcial', async () => {
    const s = await fullStore('Loja Sem Progresso');
    fn.faults.storageNoop = true;
    expect((await del(s.id, s.name)).body).toMatchObject({ status: 'parcial', storage_remaining: 4 });
    delete fn.faults.storageNoop;
    expect((await del(s.id, s.name)).body.status).toBe('concluida');
  });

  it('falha ao apagar login: parcial; repetir conclui; quem ganhou outra loja no meio é mantido', async () => {
    const s = await fullStore('Loja Falha Login');
    const other = await fullStore('Loja Destino');
    fn.faults.deleteUser = true;
    expect((await del(s.id, s.name)).body).toMatchObject({ status: 'parcial', storage_remaining: 0, logins_remaining: 3 });
    delete fn.faults.deleteUser;
    await t.addMember(other.id, s.seller, 'SELLER');
    expect((await del(s.id, s.name)).body).toMatchObject({ status: 'concluida', logins_deleted: 2 });
    expect(await loginExists(s.seller)).toBe(true);
  });

  it('mais de 100 arquivos saem em lotes', async () => {
    const s = await fullStore('Loja Muitos Arquivos');
    await t.sql(`INSERT INTO storage.objects (bucket_id, name) SELECT 'products', $1 || '/f' || g FROM generate_series(1, 250) g`, [s.id]);
    expect((await del(s.id, s.name)).body).toMatchObject({ status: 'concluida', files_removed: 254 });
  });

  it('dono de autocadastro: login é apagado (loja criada por ele); autor no log de auditoria é mantido', async () => {
    const own = await t.createUser('auto@teste.local');
    const s = await t.createStore('Loja Auto', own, { status: 'trial' });
    await t.sql('UPDATE stores SET created_by = $2 WHERE id = $1', [s, own]);
    expect((await del(s, 'Loja Auto')).body).toMatchObject({ status: 'concluida', logins_deleted: 1 });
    expect(await loginExists(own)).toBe(false);

    const chooser = await t.createUser('escolheu@teste.local');
    const s2 = await t.createStore('Loja Escolheu', chooser, { status: 'trial' });
    await t.as(chooser, `SELECT choose_trial_plan('inicio')`);
    const res = await del(s2, 'Loja Escolheu');
    expect(res.body).toMatchObject({ status: 'concluida', logins_deleted: 0 });
    expect(res.body.logins_kept).toEqual([{ user_id: chooser, reason: 'autor_no_log_de_auditoria' }]);
    expect(await loginExists(chooser)).toBe(true);
  });

  it('loja órfã (sem membros) é excluída', async () => {
    const [{ id }] = await t.sql<any>(`INSERT INTO stores (name, status) VALUES ('Orfa', 'trial') RETURNING id`);
    expect((await del(id, 'Orfa')).body).toMatchObject({ status: 'concluida', logins_deleted: 0, files_removed: 0 });
  });

  it('assinatura no gateway e referência de outra loja bloqueiam sem apagar nada', async () => {
    const s = await fullStore('Loja Gateway');
    await t.sql(`UPDATE subscriptions SET gateway_subscription_id = 'sub_1' WHERE store_id = $1`, [s.id]);
    let res = await del(s.id, s.name);
    expect(res.body.error).toMatch(/^ASSINATURA_NO_GATEWAY:/);
    await t.sql(`UPDATE subscriptions SET status = 'cancelled' WHERE store_id = $1`, [s.id]);

    const other = await fullStore('Loja Vizinha');
    const [{ id: sup }] = await t.sql<any>('SELECT id FROM suppliers WHERE store_id = $1', [s.id]);
    const [{ id: tx }] = await t.sql<any>(`INSERT INTO transactions (description, amount, type, supplier_id, store_id) VALUES ('cruzada', 1, 'EXPENSE', $2, $1) RETURNING id`, [other.id, sup]);
    const before = await snapshot(s.id);
    res = await del(s.id, s.name);
    expect(res.body.error).toMatch(/^REFERENCIA_ENTRE_LOJAS:/);
    expect(await snapshot(s.id)).toEqual(before);
    await t.sql('DELETE FROM transactions WHERE id = $1', [tx]);
    expect((await del(s.id, s.name)).body.status).toBe('concluida');
  });
});

describe('referência de outra loja por FK que anula', () => {
  it('item da loja B apontando para produto da loja A bloqueia a exclusão de A', async () => {
    const a = await fullStore('Loja Ref A');
    const b = await fullStore('Loja Ref B');
    const [{ id: product }] = await t.sql<any>(`SELECT id FROM products WHERE store_id = $1 AND name = 'P'`, [a.id]);
    const [{ id: item }] = await t.sql<any>('SELECT id FROM quote_items WHERE store_id = $1', [b.id]);
    await t.sql('UPDATE quote_items SET product_id = $2 WHERE id = $1', [item, product]);
    const before = await snapshot(a.id);
    expect((await del(a.id, a.name)).body.error).toMatch(/^REFERENCIA_ENTRE_LOJAS:/);
    expect(await snapshot(a.id)).toEqual(before);
    await t.sql('UPDATE quote_items SET product_id = NULL WHERE id = $1', [item]);
    expect((await del(a.id, a.name)).body.status).toBe('concluida');
  });
});

// Criação de loja sem sobra (067): index.ts real da manage-users com dublês, sobre o banco local PGlite.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { loadManageUsers } from '../doubles/edgeHarness';

let t: TestDb;
let fn: Awaited<ReturnType<typeof loadManageUsers>>;
let admin: string, outsider: string;
/** Lojas sem membros que já vêm das migrações (a 003 semeia a "Loja Principal"). */
let seeded: string[] = [];

beforeAll(async () => {
  t = await createTestDb();
  fn = await loadManageUsers(t);
  admin = await t.createUser('admin@teste.local', { platformAdmin: true });
  outsider = await t.createUser('comum@teste.local');
  seeded = await orphans();
}, 120_000);
afterAll(async () => { await t?.close(); });
beforeEach(() => { for (const k of Object.keys(fn.faults)) delete (fn.faults as any)[k]; });

const input = (email: string, extra: Record<string, unknown> = {}) => ({
  action: 'create_store', request_id: randomUUID(), store_name: `Loja ${email}`, owner_name: 'Dona Teste',
  email, plan: 'inicio', mode: 'trial', ...extra,
});
const userByEmail = async (email: string) => (await t.sql<any>('SELECT * FROM auth.users WHERE lower(email) = lower($1)', [email]))[0];
const storesNamed = (name: string) => t.sql<any>('SELECT * FROM stores WHERE name = $1', [name]);
const orphans = async () => (await t.sql<any>(
  'SELECT s.name FROM stores s WHERE s.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM store_members m WHERE m.store_id = s.id)')).map(r => r.name);

/** O dono entra: loja ativa, is_active, papel OWNER, acesso e módulos do plano; vende e gera lançamento. */
async function expectOwnerCanEnter(owner: string, store: string, plan: string) {
  await t.as(owner, 'SELECT set_active_store($1)', [store]);
  const mine = await t.as<any>(owner, 'SELECT * FROM my_stores()');
  expect(mine.find(s => s.id === store)).toMatchObject({ role: 'OWNER', is_active_store: true });
  expect((await t.as<any>(owner, 'SELECT current_store_id() id'))[0].id).toBe(store);
  const [access] = await t.as<any>(owner, 'SELECT * FROM my_store_access()');
  expect(access.access_ok).toBe(true);
  expect((await t.sql<any>('SELECT is_active FROM stores WHERE id = $1', [store]))[0].is_active).toBe(true);
  const on = async (m: string) => (await t.as<any>(owner, 'SELECT store_module_enabled($1, $2) v', [store, m]))[0].v;
  expect(await on('financial')).toBe(true);
  expect(await on('boletos')).toBe(plan !== 'inicio');
  const [{ r }] = await t.as<any>(owner, 'SELECT create_sale($1::jsonb, $2::jsonb) r', [
    JSON.stringify({ total: 10, payment_type: 'FULL', payment_method: 'PIX' }),
    JSON.stringify([{ product_name: 'Avulso', quantity: 1, unit_price: 10 }])]);
  expect(r.lancamentos).toBe(1);
}

describe('create_store', () => {
  it('só o admin da plataforma: usuário comum e sem login são recusados e nada é criado', async () => {
    const before = fn.calls.createUser;
    expect(await fn.call(outsider, input('x1@teste.local'))).toMatchObject({ status: 403 });
    expect(await fn.call(null, input('x1@teste.local'))).toMatchObject({ status: 401 });
    expect(await t.fails(outsider, `SELECT admin_lookup_login('x1@teste.local')`)).toMatch(/administrador da plataforma/);
    expect(await t.fails(outsider, `SELECT admin_create_store_with_owner(gen_random_uuid(), $1, 'X', 'inicio')`, [outsider])).toMatch(/administrador da plataforma/);
    expect(fn.calls.createUser).toBe(before);
    expect(await userByEmail('x1@teste.local')).toBeUndefined();
  });

  it('e-mail novo, teste: cria login com 12345678, loja e dono; o dono entra', async () => {
    const req = input('Novo.Teste@teste.local');
    const res = await fn.call(admin, req);
    expect(res.body).toMatchObject({ ok: true, account_created: true, temporary_password: '12345678', already_created: false });
    const u = await userByEmail('novo.teste@teste.local');
    expect(u.encrypted_password).toBe('12345678');
    await expectOwnerCanEnter(u.id, res.body.store_id, 'inicio');
    const [s] = await storesNamed(req.store_name);
    expect(s).toMatchObject({ status: 'trial', billing_mode: 'manual_contract' });
  });

  it('e-mail novo, loja paga: assinatura ativa no plano e prazo pedido', async () => {
    const res = await fn.call(admin, input('paga@teste.local', { plan: 'crescimento', mode: 'paid', days: 45 }));
    expect(res.status).toBe(200);
    const [sub] = await t.sql<any>(`SELECT plan_id, status, round(extract(epoch FROM current_period_end - now()) / 86400)::int d FROM subscriptions WHERE store_id = $1`, [res.body.store_id]);
    expect(sub).toEqual({ plan_id: 'crescimento', status: 'active', d: 45 });
    await expectOwnerCanEnter((await userByEmail('paga@teste.local')).id, res.body.store_id, 'crescimento');
  });

  it('e-mail com conta: liga como dono sem trocar a senha nem informar senha provisória', async () => {
    const id = await t.createUser('ja.existe@teste.local');
    await t.sql(`UPDATE auth.users SET encrypted_password = 'senha-dele', last_sign_in_at = now() WHERE id = $1`, [id]);
    const before = fn.calls.createUser;
    const res = await fn.call(admin, input('ja.existe@teste.local'));
    expect(res.body).toMatchObject({ ok: true, account_created: false, temporary_password: null });
    expect(fn.calls.createUser).toBe(before);
    expect(fn.calls.updateUser).toBe(0);
    expect((await userByEmail('ja.existe@teste.local')).encrypted_password).toBe('senha-dele');
    await expectOwnerCanEnter(id, res.body.store_id, 'inicio');
  });

  it('e-mail que é vendedor em outra loja: vira dono da nova e continua entrando nas duas', async () => {
    const boss = await t.createUser('chefe@teste.local');
    const other = await t.createStore('Outra', boss, { plan: 'avancado' });
    const id = await t.createUser('vendedor.outra@teste.local');
    await t.addMember(other, id, 'SELLER');
    const res = await fn.call(admin, input('vendedor.outra@teste.local'));
    expect(res.status).toBe(200);
    expect((await t.sql<any>('SELECT active_store_id a FROM profiles WHERE id = $1', [id]))[0].a).toBe(other);
    await expectOwnerCanEnter(id, res.body.store_id, 'inicio');
  });

  it('conta com e-mail não confirmado: recusada na função e no banco; nada é criado, ligado ou apagado', async () => {
    const id = await t.createUser('vitima@teste.local');
    await t.sql(`UPDATE auth.users SET email_confirmed_at = NULL, encrypted_password = 'do-atacante' WHERE id = $1`, [id]);
    const before = { users: fn.calls.createUser, deleted: fn.calls.deleteUser, stores: (await t.sql('SELECT id FROM stores')).length };
    const res = await fn.call(admin, input('vitima@teste.local'));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/^CONTA_NAO_CONFIRMADA:.*não deve clicar no link.*crie a loja de novo\.$/);
    for (const q of [`SELECT * FROM admin_create_client('vitima@teste.local', 'X')`,
      `SELECT admin_create_store_with_owner(gen_random_uuid(), '${id}', 'X', 'inicio')`]) {
      expect(await t.fails(admin, q), q).toMatch(/CONTA_NAO_CONFIRMADA/);
    }
    expect([fn.calls.createUser, fn.calls.deleteUser]).toEqual([before.users, before.deleted]);
    expect(await t.sql('SELECT id FROM stores')).toHaveLength(before.stores);
    expect(await t.sql('SELECT 1 FROM store_members WHERE user_id = $1', [id])).toHaveLength(0);
    expect((await userByEmail('vitima@teste.local')).encrypted_password).toBe('do-atacante');
  });

  it('equipe (create_member): conta não confirmada não ganha vínculo, nem pelo admin nem pelo dono', async () => {
    const boss = await t.createUser('chefe.equipe@teste.local');
    const store = await t.createStore('Equipe', boss, { plan: 'avancado' });
    const id = await t.createUser('pendente@teste.local');
    await t.sql('UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1', [id]);
    const body = { action: 'create_member', store_id: store, email: 'pendente@teste.local', name: 'P' };
    for (const role of ['OWNER', 'MANAGER', 'SELLER']) {
      const res = await fn.call(admin, { ...body, role });
      expect(res.status, role).toBe(409);
      expect(res.body.error, role).toMatch(/^CONTA_NAO_CONFIRMADA:.*não deve clicar no link.*adicione a pessoa de novo\.$/);
    }
    // A RPC antiga não serve de atalho: ninguém logado a executa (069).
    for (const who of [admin, boss]) {
      expect(await t.fails(who, `SELECT add_store_member($1, 'pendente@teste.local', 'SELLER')`, [store])).toMatch(/permission denied/);
    }
    const byOwner = await fn.call(boss, { ...body, role: 'SELLER' });
    expect(byOwner.body.error).toBe('Não foi possível adicionar este e-mail. Solicite ao administrador da plataforma.');
    expect(await t.sql('SELECT 1 FROM store_members WHERE user_id = $1', [id])).toHaveLength(0);
    // Confirmado, o admin liga normalmente; o dono atualiza o vendedor e cria e-mail novo como antes.
    await t.sql('UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1', [id]);
    expect((await fn.call(admin, { ...body, role: 'SELLER' })).body).toMatchObject({ ok: true, existing_account: true });
    expect((await fn.call(boss, { ...body, role: 'SELLER' })).body).toMatchObject({ ok: true });
    const fresh = await fn.call(boss, { ...body, email: 'novo.vendedor@teste.local', role: 'SELLER' });
    expect(fresh.body.ok).toBe(true);
    expect(fresh.body.temporary_password).toHaveLength(16);
  });

  it('e-mail já dono de loja: recusado, nada criado', async () => {
    await fn.call(admin, input('dono.unico@teste.local'));
    const before = { users: fn.calls.createUser, stores: (await t.sql('SELECT id FROM stores')).length };
    const res = await fn.call(admin, input('dono.unico@teste.local', { store_name: 'Segunda' }));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/^UMA_LOJA_POR_DONO:/);
    expect(fn.calls.createUser).toBe(before.users);
    expect(await t.sql('SELECT id FROM stores')).toHaveLength(before.stores);
  });

  it('falha ao criar o login: nenhuma loja; repetir cria uma só', async () => {
    const req = input('falha.login@teste.local');
    fn.faults.createUser = true;
    const res = await fn.call(admin, req);
    expect(res).toMatchObject({ status: 502 });
    expect(res.body.error).toMatch(/Nenhuma loja foi criada/);
    expect(await storesNamed(req.store_name)).toHaveLength(0);
    delete fn.faults.createUser;
    expect((await fn.call(admin, req)).status).toBe(200);
    expect(await storesNamed(req.store_name)).toHaveLength(1);
  });

  const breakStores = async () => {
    await t.sql(`CREATE FUNCTION public.zz_falha() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END $$`);
    await t.sql(`CREATE TRIGGER zz_falha BEFORE INSERT ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.zz_falha()`);
    return async () => {
      await t.sql('DROP TRIGGER zz_falha ON public.subscriptions');
      await t.sql('DROP FUNCTION public.zz_falha()');
    };
  };

  it('falha no meio da criação da loja: desfaz a loja e apaga o login novo; repetir funciona', async () => {
    const req = input('falha.meio@teste.local');
    const restore = await breakStores();
    const res = await fn.call(admin, req);
    await restore();
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Nada ficou criado/);
    expect(res.body.error).not.toMatch(/falha simulada/);
    expect(await userByEmail('falha.meio@teste.local')).toBeUndefined();
    expect(await storesNamed(req.store_name)).toHaveLength(0);
    expect((await fn.call(admin, req)).body).toMatchObject({ ok: true, account_created: true });
  });

  it('falha no meio com conta existente: a conta não é apagada nem alterada', async () => {
    const id = await t.createUser('antiga@teste.local');
    const restore = await breakStores();
    const res = await fn.call(admin, input('antiga@teste.local'));
    await restore();
    expect(res.status).toBe(500);
    expect((await userByEmail('antiga@teste.local')).id).toBe(id);
  });

  it('falha na loja e na limpeza: a repetição reaproveita o login e informa a senha provisória', async () => {
    const req = input('sobrou@teste.local');
    const restore = await breakStores();
    fn.faults.deleteUser = true;
    const res = await fn.call(admin, req);
    await restore();
    delete fn.faults.deleteUser;
    expect(res.body.error).toMatch(/Repita a tentativa/);
    const left = await userByEmail('sobrou@teste.local');
    expect(left).toBeDefined();
    // Mesmo reabrindo o formulário (request_id novo), o login que sobrou é reconhecido.
    const again = await fn.call(admin, { ...req, request_id: randomUUID() });
    expect(again.body).toMatchObject({ ok: true, account_created: true, temporary_password: '12345678' });
    expect((await userByEmail('sobrou@teste.local')).id).toBe(left.id);
    await expectOwnerCanEnter(left.id, again.body.store_id, 'inicio');
  });

  it('repetição da mesma requisição não duplica e devolve a mesma loja', async () => {
    const req = input('repete@teste.local');
    const a = await fn.call(admin, req);
    const created = fn.calls.createUser;
    const b = await fn.call(admin, req);
    expect(b.body).toMatchObject({ store_id: a.body.store_id, already_created: true, account_created: true, temporary_password: '12345678' });
    expect(fn.calls.createUser).toBe(created);
    expect(await storesNamed(req.store_name)).toHaveLength(1);
  });

  it('duas chamadas ao mesmo tempo: uma loja, um login', async () => {
    const req = input('junto@teste.local');
    const [a, b] = await Promise.all([fn.call(admin, req), fn.call(admin, req)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.store_id).toBe(b.body.store_id);
    expect([a.body.account_created, b.body.account_created]).toEqual([true, true]);
    expect(await storesNamed(req.store_name)).toHaveLength(1);
  });

  it('request_id reutilizado com outro e-mail: recusado e o login novo é desfeito', async () => {
    const req = input('um@teste.local');
    await fn.call(admin, req);
    const res = await fn.call(admin, { ...req, email: 'dois@teste.local' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/^REQUISICAO_REUTILIZADA:/);
    expect(await userByEmail('dois@teste.local')).toBeUndefined();
  });

  it('validação: dados ruins são recusados antes de criar qualquer coisa', async () => {
    const before = fn.calls.createUser;
    for (const bad of [{ request_id: 'x' }, { email: 'sem-arroba' }, { plan: 'custom' }, { mode: 'outro' }, { store_name: ' ' }, { days: 0 }]) {
      expect((await fn.call(admin, input('v@teste.local', bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect(fn.calls.createUser).toBe(before);
  });

  it('nenhuma loja ficou sem dono e nenhum login novo ficou solto', async () => {
    expect(await orphans()).toEqual(seeded);
    expect(await t.sql(`SELECT u.email FROM auth.users u WHERE u.raw_app_meta_data ? 'gp_store_request'
                         AND NOT EXISTS (SELECT 1 FROM store_members m WHERE m.user_id = u.id)`)).toHaveLength(0);
  });
});

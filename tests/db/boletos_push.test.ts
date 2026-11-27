// 068: bucket privado de boletos (RLS no PGlite). E o limite de taxa da send-push (index.ts real com dublês).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { loadManageUsers } from '../doubles/edgeHarness';

let t: TestDb;
let admin: string, ownerA: string, managerA: string, sellerA: string, ownerB: string, ownerI: string;
let storeA: string, storeB: string, storeI: string;

beforeAll(async () => {
  t = await createTestDb();
  admin = await t.createUser('admin@teste.local', { platformAdmin: true });
  [ownerA, managerA, sellerA, ownerB, ownerI] = await Promise.all(
    ['dono.a', 'gerente.a', 'vend.a', 'dono.b', 'dono.i'].map(n => t.createUser(`${n}@teste.local`)));
  storeA = await t.createStore('A', ownerA, { plan: 'avancado' });
  storeB = await t.createStore('B', ownerB, { plan: 'crescimento' });
  storeI = await t.createStore('I', ownerI, { plan: 'inicio' });
  await t.addMember(storeA, managerA, 'MANAGER');
  await t.addMember(storeA, sellerA, 'SELLER');
}, 120_000);
afterAll(async () => { await t?.close(); });

const put = (who: string, name: string) => t.as(who, `INSERT INTO storage.objects (bucket_id, name) VALUES ('boletos', $1) RETURNING id`, [name]);
const putFails = (who: string | null, name: string) => t.fails(who, `INSERT INTO storage.objects (bucket_id, name) VALUES ('boletos', $1)`, [name]);
const list = async (who: string) => (await t.as<any>(who, `SELECT name FROM storage.objects WHERE bucket_id = 'boletos' ORDER BY name`)).map(r => r.name);

describe('068: bucket boletos', () => {
  it('privado, até 10 MB, só PDF e imagem sem SVG', async () => {
    const [b] = await t.sql<any>(`SELECT public, file_size_limit::int size, allowed_mime_types types FROM storage.buckets WHERE id = 'boletos'`);
    expect(b).toMatchObject({ public: false, size: 10 * 1024 * 1024 });
    expect(b.types).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
  });

  it('dono e gerente enviam, leem, trocam e excluem na pasta da loja', async () => {
    await put(ownerA, `${storeA}/dono.pdf`);
    await put(managerA, `${storeA}/gerente.pdf`);
    expect(await list(ownerA)).toEqual([`${storeA}/dono.pdf`, `${storeA}/gerente.pdf`]);
    expect(await t.as(managerA, `UPDATE storage.objects SET metadata = '{}' WHERE name = $1 RETURNING id`, [`${storeA}/dono.pdf`])).toHaveLength(1);
    expect(await t.as(ownerA, `DELETE FROM storage.objects WHERE name = $1 RETURNING id`, [`${storeA}/gerente.pdf`])).toHaveLength(1);
  });

  it('vendedor e anônimo não leem, enviam, trocam nem excluem', async () => {
    expect(await list(sellerA)).toEqual([]);
    expect(await putFails(sellerA, `${storeA}/v.pdf`)).toMatch(/row-level security/);
    expect(await t.as(sellerA, `UPDATE storage.objects SET metadata = '{}' WHERE bucket_id = 'boletos' RETURNING id`)).toHaveLength(0);
    expect(await t.as(sellerA, `DELETE FROM storage.objects WHERE bucket_id = 'boletos' RETURNING id`)).toHaveLength(0);
    expect(await putFails(null, `${storeA}/anon.pdf`)).toMatch(/row-level security|permission denied/);
  });

  it('isolamento: outra loja, raiz do bucket e mover para outra pasta são recusados', async () => {
    expect(await list(ownerB)).toEqual([]);
    expect(await putFails(ownerB, `${storeA}/invasor.pdf`)).toMatch(/row-level security/);
    expect(await putFails(ownerA, 'raiz.pdf')).toMatch(/row-level security/);
    expect(await t.fails(ownerA, `UPDATE storage.objects SET name = $1 WHERE name = $2`, [`${storeB}/x.pdf`, `${storeA}/dono.pdf`])).toMatch(/row-level security/);
    expect(await t.as(ownerB, `DELETE FROM storage.objects WHERE name = $1 RETURNING id`, [`${storeA}/dono.pdf`])).toHaveLength(0);
  });

  it('exige financial E boletos: Início recusado; override desliga e religar devolve o acesso', async () => {
    expect(await putFails(ownerI, `${storeI}/i.pdf`)).toMatch(/row-level security/);
    for (const mod of ['boletos', 'financial']) {
      await t.as(admin, `SELECT admin_set_module_override($1, $2, false)`, [storeA, mod]);
      expect(await list(ownerA), mod).toEqual([]);
      expect(await putFails(ownerA, `${storeA}/off.pdf`), mod).toMatch(/row-level security/);
      await t.as(admin, `SELECT admin_clear_module_override($1, $2)`, [storeA, mod]);
    }
    expect(await list(ownerA)).toEqual([`${storeA}/dono.pdf`]);
  });

  it('admin impersonando alcança só a loja ativa', async () => {
    await put(ownerB, `${storeB}/b.pdf`);
    await t.as(admin, `SELECT set_active_store($1)`, [storeB]);
    expect(await list(admin)).toEqual([`${storeB}/b.pdf`]);
    expect(await putFails(admin, `${storeA}/adm.pdf`)).toMatch(/row-level security/);
    await put(admin, `${storeB}/adm.pdf`);
    await t.as(admin, `SELECT set_active_store($1)`, [storeA]);
    expect(await list(admin)).toEqual([`${storeA}/dono.pdf`]);
  });
});

describe('send-push: limite de taxa depois do segredo', () => {
  let fn: Awaited<ReturnType<typeof loadManageUsers>>;
  let sale: string;
  beforeAll(async () => {
    (globalThis as any).__pushSent = [];
    fn = await loadManageUsers(t, 'send-push-notification');
    await t.sql(`INSERT INTO push_subscriptions (user_id, endpoint, auth, p256dh) VALUES ($1, 'https://push.teste/dono', 'a', 'p')`, [ownerA]);
    [{ id: sale }] = await t.sql<any>(`INSERT INTO sales (total, store_id) VALUES (10, $1) RETURNING id`, [storeA]);
  });
  const body = () => ({ type: 'sale', record: { id: sale } });
  const ip = { 'x-forwarded-for': '203.0.113.7' };

  it('o webhook com o segredo não tem limite: 80 avisos do mesmo IP chegam ao dono', async () => {
    for (let i = 0; i < 80; i++) {
      expect((await fn.request({ ...ip, 'x-webhook-secret': 'segredo-de-teste' }, body())).status, `aviso ${i}`).toBe(200);
    }
    expect((globalThis as any).__pushSent).toHaveLength(80);
  });

  it('sem o segredo (ou errado) vale 30 por minuto por IP, e o webhook válido segue passando', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await fn.request({ ...ip, 'x-webhook-secret': 'errado' }, body())).status);
    expect(codes.slice(0, 30).every(c => c === 401)).toBe(true);
    expect(codes.slice(30)).toEqual([429, 429]);
    expect((await fn.request({ ...ip, 'x-webhook-secret': 'segredo-de-teste' }, body())).status).toBe(200);
  });

  it('usuário logado é limitado por conta mesmo trocando o IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await fn.request({ 'x-forwarded-for': `198.51.100.${i}`, Authorization: `Bearer ${ownerA}` }, body())).status);
    expect(codes.slice(0, 30).every(c => c === 200)).toBe(true);
    expect(codes.slice(30)).toEqual([429, 429]);
  });
});

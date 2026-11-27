// 065: Financeiro no Início. O banco sobe até a 064, ganha dados e só então recebe a 065, como em produção.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { MIG_DIR } from './load.mjs';

let t: TestDb;
let admin: string, owner: string, seller: string, off: string, inicio: string, cresc: string, avanc: string, overridden: string;
let oldSale: string;
let before: Record<string, string[]>;

const apply065 = () => t.db.exec(readFileSync(path.join(MIG_DIR, '065_financeiro_no_inicio.sql'), 'utf8'));
const sell = async (who: string, extra: Record<string, unknown> = {}) => (await t.as<any>(who, 'SELECT create_sale($1::jsonb, $2::jsonb) r', [
  JSON.stringify({ total: 100, payment_type: 'FULL', payment_method: 'PIX', ...extra }),
  JSON.stringify([{ product_name: 'Avulso', quantity: 1, unit_price: 100 }])]))[0].r;
const tx = (sale: string) => t.sql<any>(`SELECT type, amount::float8 amount, status, payment_method, COALESCE(has_boleto, false) has_boleto
  FROM transactions WHERE sale_id = $1 ORDER BY amount`, [sale]);
const cache = async (store: string) => (await t.sql<any>('SELECT module_key FROM store_modules WHERE store_id = $1 AND enabled ORDER BY 1', [store])).map(r => r.module_key);
const planMap = async () => Object.fromEntries((await t.sql<any>(
  `SELECT plan_key, array_agg(module_key ORDER BY module_key) FILTER (WHERE enabled) m FROM plan_modules GROUP BY 1`)).map(r => [r.plan_key, r.m]));

beforeAll(async () => {
  t = await createTestDb({ upTo: '064_limite_desconto_vendedor.sql' });
  admin = await t.createUser('admin@teste.local', { platformAdmin: true });
  owner = await t.createUser('dono@teste.local');
  seller = await t.createUser('vend@teste.local');
  inicio = await t.createStore('Inicio', owner, { plan: 'inicio' });
  await t.addMember(inicio, seller, 'SELLER');
  cresc = await t.createStore('Cresc', await t.createUser('c@teste.local'), { plan: 'crescimento' });
  avanc = await t.createStore('Avanc', await t.createUser('a@teste.local'), { plan: 'avancado' });
  off = await t.createUser('off@teste.local');
  overridden = await t.createStore('Inicio sem financeiro', off, { plan: 'inicio' });
  await t.as(admin, `SELECT admin_set_module_override($1, 'financial', false)`, [overridden]);
  for (const s of [inicio, cresc, avanc, overridden]) await t.sql('SELECT public.apply_store_modules($1)', [s]);
  oldSale = (await sell(owner)).sale_id;
  before = await planMap();
  await apply065();
}, 120_000);
afterAll(async () => { await t?.close(); });

describe('065', () => {
  it('só o Início ganha financial; boletos, relatórios e os outros planos não mudam', async () => {
    const after = await planMap();
    expect(after.inicio).toEqual([...before.inicio, 'financial'].sort());
    for (const p of ['crescimento', 'avancado', 'trial', 'custom']) expect(after[p], p).toEqual(before[p]);
    expect(after.inicio).not.toContain('boletos');
    expect(after.inicio).not.toContain('reports');
  });

  it('recalcula as lojas do Início (cache) e respeita o override', async () => {
    expect(await cache(inicio)).toEqual(['customers', 'dashboard', 'financial', 'inventory', 'sales', 'settings']);
    expect(await cache(overridden)).not.toContain('financial');
    expect((await t.as<any>(owner, `SELECT store_module_enabled($1, 'financial') v`, [inicio]))[0].v).toBe(true);
    expect((await t.as<any>(off, `SELECT store_module_enabled($1, 'financial') v`, [overridden]))[0].v).toBe(false);
  });

  it('sem retroativo: a venda antiga continua sem lançamento; as novas geram', async () => {
    expect(await tx(oldSale)).toEqual([]);
    const r = await sell(seller);
    expect(await tx(r.sale_id)).toEqual([{ type: 'INCOME', amount: 100, status: 'PAID', payment_method: 'PIX', has_boleto: false }]);
  });

  it('boleto no Início: à vista vira receita PAGA; no dividido o restante fica pendente; nunca marca has_boleto', async () => {
    const full = await sell(owner, { payment_method: 'Boleto' });
    expect(await tx(full.sale_id)).toEqual([{ type: 'INCOME', amount: 100, status: 'PAID', payment_method: 'Boleto', has_boleto: false }]);
    const part = await sell(owner, { payment_type: 'PARTIAL', down_payment: 30, remaining_amount: 70, down_payment_method: 'PIX',
      remaining_payment_method: 'Boleto', remaining_status: 'PENDING' });
    expect(await tx(part.sale_id)).toEqual([
      { type: 'INCOME', amount: 30, status: 'PAID', payment_method: 'PIX', has_boleto: false },
      { type: 'INCOME', amount: 70, status: 'PENDING', payment_method: 'Boleto', has_boleto: false }]);
  });

  it('com o financeiro desligado por override, boleto não gera lançamento', async () => {
    const r = await sell(off, { payment_method: 'Boleto' });
    expect(await tx(r.sale_id)).toEqual([]);
  });

  it('reaplicar não muda nada', async () => {
    const snap = [await planMap(), await cache(inicio), await cache(overridden)];
    await apply065();
    expect([await planMap(), await cache(inicio), await cache(overridden)]).toEqual(snap);
  });
});

// Riscos de docs/riscos-seguranca.md cobertos no PGlite (migrações 001–058): A5, A10 e impersonação × loja ativa.
// A3 (bucket products), A9 (exclusão e configuração por papel) e A11 (producao-anexos) estão em rls.test.ts.
// Papéis: dono, gerente e vendedor da loja A; dono da loja B; admin da plataforma.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
let admin: string, ownerA: string, managerA: string, sellerA: string, ownerB: string;
let storeA: string, storeB: string;

beforeAll(async () => {
  t = await createTestDb();
  admin = await t.createUser('admin@teste.local', { platformAdmin: true });
  ownerA = await t.createUser('dono.a@teste.local');
  managerA = await t.createUser('gerente.a@teste.local');
  sellerA = await t.createUser('vendedor.a@teste.local');
  ownerB = await t.createUser('dono.b@teste.local');
  storeA = await t.createStore('Loja A', ownerA, { plan: 'avancado' });
  storeB = await t.createStore('Loja B', ownerB, { plan: 'avancado' });
  await t.addMember(storeA, managerA, 'MANAGER');
  await t.addMember(storeA, sellerA, 'SELLER');
  await t.sql(`INSERT INTO products (name, price, store_id) VALUES ('PA', 1, $1), ('PB', 1, $2)`, [storeA, storeB]);
  await t.sql(`INSERT INTO customers (name, store_id) VALUES ('CA', $1), ('CB', $2)`, [storeA, storeB]);
}, 120_000);
afterAll(async () => { await t?.close(); });

describe('A10: lançamentos por papel (057, antiga 028)', () => {
  let sale: string;
  beforeAll(async () => {
    [{ id: sale }] = await t.sql(`INSERT INTO sales (total, card_fee_amount, store_id, created_by) VALUES (100, 3, $1, $2) RETURNING id`, [storeA, sellerA]);
  });

  // Sem RETURNING: o vendedor não lê lançamentos (SELECT só dono/gerente).
  it('vendedor grava a receita da própria venda e a taxa de cartão com o valor gravado na venda', async () => {
    await t.as(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES ('Venda', 100, 'INCOME', 'Vendas', $1)`, [sale]);
    await t.as(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES ('Taxa', 3, 'EXPENSE', 'Taxas e Impostos', $1)`, [sale]);
    expect(await t.sql(`SELECT id FROM transactions WHERE sale_id = $1`, [sale])).toHaveLength(2);
  });

  it('vendedor não grava receita sem venda, despesa comum nem taxa com valor diferente', async () => {
    expect(await t.fails(sellerA, `INSERT INTO transactions (description, amount, type, category) VALUES ('X', 1, 'INCOME', 'Vendas')`)).toMatch(/row-level security/);
    expect(await t.fails(sellerA, `INSERT INTO transactions (description, amount, type, category) VALUES ('Aluguel', 1, 'EXPENSE', 'Fixas')`)).toMatch(/row-level security/);
    expect(await t.fails(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES ('Taxa', 50, 'EXPENSE', 'Taxas e Impostos', $1)`, [sale])).toMatch(/row-level security/);
  });

  it('vendedor não infla receita acima do total nem duplica a taxa', async () => {
    // A venda já tem 100 de receita (total 100) e 1 taxa do teste anterior.
    expect(await t.fails(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES ('Extra', 999999, 'INCOME', 'Vendas', $1)`, [sale])).toMatch(/row-level security/);
    expect(await t.fails(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES ('Extra', 1, 'INCOME', 'Vendas', $1)`, [sale])).toMatch(/row-level security/);
    expect(await t.fails(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES ('Taxa 2', 3, 'EXPENSE', 'Taxas e Impostos', $1)`, [sale])).toMatch(/row-level security/);
    expect(await t.sql(`SELECT id FROM transactions WHERE sale_id = $1`, [sale])).toHaveLength(2);
  });

  it('entrada + restante dentro do total passam; venda de outro vendedor da mesma loja é recusada', async () => {
    const [{ id: s2 }] = await t.sql(`INSERT INTO sales (total, store_id, created_by) VALUES (300, $1, $2) RETURNING id`, [storeA, sellerA]);
    await t.as(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES ('Entrada', 100, 'INCOME', 'Vendas', $1)`, [s2]);
    await t.as(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id, status) VALUES ('Restante', 200, 'INCOME', 'Vendas', $1, 'PENDING')`, [s2]);
    const [{ id: s3 }] = await t.sql(`INSERT INTO sales (total, store_id, created_by) VALUES (50, $1, $2) RETURNING id`, [storeA, managerA]);
    expect(await t.fails(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES ('V', 50, 'INCOME', 'Vendas', $1)`, [s3])).toMatch(/row-level security/);
  });

  it('vendedor não grava lançamento ligado a venda de outra loja', async () => {
    const [{ id: saleB }] = await t.sql(`INSERT INTO sales (total, store_id, created_by) VALUES (10, $1, $2) RETURNING id`, [storeB, ownerB]);
    expect(await t.fails(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES ('V', 10, 'INCOME', 'Vendas', $1)`, [saleB])).toMatch(/row-level security/);
  });

  it('dono e gerente gravam despesa da loja', async () => {
    expect(await t.as(managerA, `INSERT INTO transactions (description, amount, type, category) VALUES ('Aluguel', 1, 'EXPENSE', 'Fixas') RETURNING id`)).toHaveLength(1);
    expect(await t.as(ownerA, `INSERT INTO transactions (description, amount, type, category) VALUES ('Luz', 1, 'EXPENSE', 'Fixas') RETURNING id`)).toHaveLength(1);
  });

  it('venda pelo create_sale (055) grava a taxa do vendedor no servidor', async () => {
    const [{ r }] = await t.as(sellerA, `SELECT create_sale($1::jsonb, $2::jsonb) r`, [
      JSON.stringify({ total: 100, payment_type: 'FULL', card_fee_amount: 3 }),
      JSON.stringify([{ product_name: 'Avulso', quantity: 1, unit_price: 100 }]),
    ]);
    expect(r.lancamentos).toBe(2);
  });
});

describe('A9: categorias são configuração', () => {
  it('vendedor não cria categoria; gerente cria', async () => {
    expect(await t.fails(sellerA, `INSERT INTO categories (name, type) VALUES ('X', 'EXPENSE')`)).toMatch(/row-level security/);
    expect(await t.as(managerA, `INSERT INTO categories (name, type) VALUES ('X', 'EXPENSE') RETURNING id`)).toHaveLength(1);
  });
});

describe('edit_sale_items e impersonação (058)', () => {
  let sale: string;
  const items = JSON.stringify([{ product_name: 'Avulso', quantity: 1, unit_price: 10 }]);
  beforeAll(async () => {
    [{ id: sale }] = await t.sql(`INSERT INTO sales (total, store_id, created_by) VALUES (10, $1, $2) RETURNING id`, [storeA, sellerA]);
  });

  it('vendedor não edita itens da venda; gerente edita', async () => {
    expect(await t.fails(sellerA, `SELECT edit_sale_items($1, $2::jsonb, 10, 0)`, [sale, items])).toMatch(/dono ou gerente/);
    expect(await t.as(managerA, `SELECT edit_sale_items($1, $2::jsonb, 10, 0) r`, [sale, items])).toHaveLength(1);
  });

  it('dono da loja B não edita venda da loja A', async () => {
    expect(await t.fails(ownerB, `SELECT edit_sale_items($1, $2::jsonb, 10, 0)`, [sale, items])).toMatch(/dono ou gerente|outra loja/);
  });

  it('admin impersonando a loja B não edita venda da loja A; com a loja A ativa, edita', async () => {
    await t.as(admin, `SELECT set_active_store($1)`, [storeB]);
    expect(await t.fails(admin, `SELECT edit_sale_items($1, $2::jsonb, 10, 0)`, [sale, items])).toMatch(/outra loja/);
    await t.as(admin, `SELECT set_active_store($1)`, [storeA]);
    expect(await t.as(admin, `SELECT edit_sale_items($1, $2::jsonb, 10, 0) r`, [sale, items])).toHaveLength(1);
  });

  it('admin impersonando vê só os dados da loja impersonada', async () => {
    await t.as(admin, `SELECT set_active_store($1)`, [storeB]);
    const prods = await t.as(admin, `SELECT store_id FROM products`);
    expect(new Set(prods.map(p => p.store_id))).toEqual(new Set([storeB]));
    expect(await t.as(admin, `SELECT id FROM customers WHERE store_id = $1`, [storeA])).toHaveLength(0);
    expect(await t.as(admin, `SELECT id FROM sales WHERE store_id = $1`, [storeA])).toHaveLength(0);
  });

  it('usuário sem is_platform_admin não troca para loja de que não faz parte', async () => {
    expect(await t.fails(ownerB, `SELECT set_active_store($1)`, [storeA])).toMatch(/não faz parte/);
  });
});

describe('A5: search_path fixo', () => {
  it('store_effective_status e update_push_subscriptions_updated_at com search_path=public', async () => {
    const rows = await t.sql(`SELECT proname, proconfig FROM pg_proc WHERE proname IN ('store_effective_status', 'update_push_subscriptions_updated_at') ORDER BY 1`);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.proconfig, r.proname).toEqual(['search_path=public']);
  });
});

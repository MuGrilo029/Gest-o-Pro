// Riscos de docs/riscos-seguranca.md cobertos no PGlite (migrações 001–061): A5, A10/A13 e impersonação × loja ativa.
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

describe('A10/A13: venda e lançamentos do vendedor só pelo servidor (057 + 059)', () => {
  let sale: string;
  const tx = (desc: string, amount: number, type: string, cat: string) => `('${desc}', ${amount}, '${type}', '${cat}', $1)`;
  beforeAll(async () => {
    [{ id: sale }] = await t.sql(`INSERT INTO sales (total, card_fee_amount, store_id, created_by) VALUES (100, 3, $1, $2) RETURNING id`, [storeA, sellerA]);
  });
  const count = async (s: string) => (await t.sql(`SELECT id FROM transactions WHERE sale_id = $1`, [s])).length;

  it('vendedor não insere várias linhas de uma vez (bulk do PostgREST): receita e taxa', async () => {
    expect(await t.fails(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES
      ${tx('R1', 100, 'INCOME', 'Vendas')}, ${tx('R2', 100, 'INCOME', 'Vendas')}, ${tx('R3', 100, 'INCOME', 'Vendas')},
      ${tx('T1', 3, 'EXPENSE', 'Taxas e Impostos')}, ${tx('T2', 3, 'EXPENSE', 'Taxas e Impostos')}`, [sale])).toMatch(/row-level security/);
    expect(await count(sale)).toBe(0);
  });

  it('vendedor não insere em sequência acima do total (nem a primeira linha passa)', async () => {
    expect(await t.fails(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES ${tx('R1', 60, 'INCOME', 'Vendas')}`, [sale])).toMatch(/row-level security/);
    expect(await t.fails(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES ${tx('R2', 60, 'INCOME', 'Vendas')}`, [sale])).toMatch(/row-level security/);
    expect(await t.fails(sellerA, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES ${tx('T', 3, 'EXPENSE', 'Taxas e Impostos')}`, [sale])).toMatch(/row-level security/);
    expect(await count(sale)).toBe(0);
  });

  it('oráculo _seller_sale_tx_ok removido', async () => {
    expect(await t.sql(`SELECT 1 FROM pg_proc WHERE proname = '_seller_sale_tx_ok'`)).toHaveLength(0);
  });

  it('vendedor não altera total, card_fee_amount, created_by nem outros valores da própria venda', async () => {
    for (const set of ['total = 999999', 'card_fee_amount = 999', 'created_by = $2', 'discount = 50', 'down_payment = 1', 'remaining_amount = 1']) {
      const params = set.includes('$2') ? [sale, managerA] : [sale];
      expect(await t.fails(sellerA, `UPDATE sales SET ${set} WHERE id = $1`, params), set).toMatch(/dono ou o gerente/);
    }
    const [s] = await t.sql(`SELECT total, card_fee_amount, created_by FROM sales WHERE id = $1`, [sale]);
    expect([Number(s.total), Number(s.card_fee_amount), s.created_by]).toEqual([100, 3, sellerA]);
  });

  it('vendedor ainda altera campos sem valor da própria venda (observações)', async () => {
    expect(await t.as(sellerA, `UPDATE sales SET observations = 'ok' WHERE id = $1 RETURNING id`, [sale])).toHaveLength(1);
  });

  it('vendedor não cria venda nem itens direto (só pelo create_sale)', async () => {
    expect(await t.fails(sellerA, `INSERT INTO sales (total, store_id) VALUES (999999, $1)`, [storeA])).toMatch(/row-level security/);
    expect(await t.fails(sellerA, `INSERT INTO sale_items (sale_id, store_id, product_name, quantity, unit_price) VALUES ($1, $2, 'X', 1, 999)`, [sale, storeA])).toMatch(/row-level security/);
    expect(await t.as(sellerA, `DELETE FROM sale_items WHERE sale_id = $1 RETURNING id`, [sale])).toHaveLength(0);
  });

  it('create_sale do vendedor continua gravando venda, itens, receita e taxa', async () => {
    const [{ r }] = await t.as(sellerA, `SELECT create_sale($1::jsonb, $2::jsonb) r`, [
      JSON.stringify({ total: 100, payment_type: 'FULL', payment_method: 'Cartão Crédito', card_installments: 1, card_fee_amount: 3 }),
      JSON.stringify([{ product_name: 'Avulso', quantity: 1, unit_price: 100 }]),
    ]);
    expect(r.lancamentos).toBe(2);
    expect(r.itens).toBe(1);
    const [s] = await t.sql(`SELECT created_by, store_id FROM sales WHERE id = $1`, [r.sale_id]);
    expect([s.created_by, s.store_id]).toEqual([sellerA, storeA]);
    expect(await t.as(sellerA, `SELECT id FROM sale_items WHERE sale_id = $1`, [r.sale_id])).toHaveLength(1);
  });

  it('gerente e dono: sem regressão (venda, itens, lançamentos e valores)', async () => {
    for (const who of [managerA, ownerA]) {
      const [{ id }] = await t.as(who, `INSERT INTO sales (total, card_fee_amount, store_id) VALUES (50, 2, $1) RETURNING id`, [storeA]);
      expect(await t.as(who, `INSERT INTO sale_items (sale_id, store_id, product_name, quantity, unit_price) VALUES ($1, $2, 'X', 1, 50) RETURNING id`, [id, storeA])).toHaveLength(1);
      expect(await t.as(who, `INSERT INTO transactions (description, amount, type, category, sale_id) VALUES
        ${tx('R', 50, 'INCOME', 'Vendas')}, ${tx('T', 2, 'EXPENSE', 'Taxas e Impostos')} RETURNING id`, [id])).toHaveLength(2);
      expect(await t.as(who, `INSERT INTO transactions (description, amount, type, category) VALUES ('Aluguel', 1, 'EXPENSE', 'Fixas') RETURNING id`)).toHaveLength(1);
      expect(await t.as(who, `UPDATE sales SET total = 60, card_fee_amount = 1 WHERE id = $1 RETURNING id`, [id])).toHaveLength(1);
      expect(await t.as(who, `UPDATE sales SET total = 70 WHERE id = $1 RETURNING id`, [sale])).toHaveLength(1);
    }
  });

  it('dono da loja B não grava lançamento nem item em venda da loja A', async () => {
    expect(await t.fails(ownerB, `INSERT INTO transactions (description, amount, type, category, sale_id, store_id) VALUES ('V', 10, 'INCOME', 'Vendas', $1, $2)`, [sale, storeA])).toMatch(/row-level security/);
    expect(await t.fails(ownerB, `INSERT INTO sale_items (sale_id, store_id, product_name, quantity, unit_price) VALUES ($1, $2, 'X', 1, 1)`, [sale, storeA])).toMatch(/row-level security/);
  });
});

describe('A13 residual: create_sale recalcula valores no servidor (060)', () => {
  const item = (unit_price: number, quantity = 1) => ({ product_name: 'Avulso', quantity, unit_price });
  const cs = (who: string, sale: object, items: object[]) =>
    t.as(who, `SELECT create_sale($1::jsonb, $2::jsonb) r`, [JSON.stringify(sale), JSON.stringify(items)]);
  const csFails = (who: string, sale: object, items: object[]) =>
    t.fails(who, `SELECT create_sale($1::jsonb, $2::jsonb)`, [JSON.stringify(sale), JSON.stringify(items)]);
  const txOf = (id: string) => t.sql(`SELECT type, amount::float8 AS amount FROM transactions WHERE sale_id = $1 ORDER BY type, amount`, [id]);
  let storeC: string, ownerC: string;

  beforeAll(async () => {
    // Loja A com taxa configurada: 1x crédito 3%, débito (0x) 1%.
    await t.sql(`INSERT INTO card_fees (installments, percentage, store_id) VALUES (1, 3, $1), (0, 1, $1)`, [storeA]);
    ownerC = await t.createUser('dono.c@teste.local');
    storeC = await t.createStore('Loja C', ownerC, { plan: 'avancado' });
  });

  it('total inflado é recusado (venda e lançamentos não gravados)', async () => {
    const before = (await t.sql(`SELECT count(*)::int n FROM sales`))[0].n;
    expect(await csFails(sellerA, { total: 999999, payment_type: 'FULL', payment_method: 'PIX' }, [item(100)])).toMatch(/não confere com os itens \(calculado: 100/);
    expect((await t.sql(`SELECT count(*)::int n FROM sales`))[0].n).toBe(before);
  });

  it('preço unitário negativo e desconto fora de 0..subtotal são recusados', async () => {
    expect(await csFails(sellerA, { total: -10, payment_type: 'FULL' }, [item(-10)])).toMatch(/negativ|inválidos/);
    expect(await csFails(sellerA, { total: 0, discount: 150, payment_type: 'FULL' }, [item(100)])).toMatch(/desconto deve ficar entre 0 e o subtotal/);
    expect(await csFails(sellerA, { total: 110, discount: -10, payment_type: 'FULL' }, [item(100)])).toMatch(/desconto deve ficar entre 0 e o subtotal/);
  });

  it('entrada maior que o total e restante errado são recusados', async () => {
    expect(await csFails(sellerA, { total: 100, payment_type: 'PARTIAL', down_payment: 150, remaining_amount: 0 }, [item(100)])).toMatch(/entrada deve ficar entre 0 e o total/);
    expect(await csFails(sellerA, { total: 100, payment_type: 'PARTIAL', down_payment: 40, remaining_amount: 600 }, [item(100)])).toMatch(/restante deve ser o total menos a entrada/);
    expect(await csFails(sellerA, { total: 100, payment_type: 'FULL', down_payment: 500 }, [item(100)])).toMatch(/entrada deve ficar entre 0 e o total/);
  });

  it('taxa negativa, maior que o total, sem cartão ou diferente da taxa da loja é recusada', async () => {
    expect(await csFails(sellerA, { total: 100, payment_type: 'FULL', payment_method: 'Cartão Crédito', card_installments: 1, card_fee_amount: -1 }, [item(100)])).toMatch(/Valores da venda inválidos|taxa de cartão deve ficar entre 0 e o total/);
    expect(await csFails(sellerA, { total: 100, payment_type: 'FULL', payment_method: 'Cartão Crédito', card_installments: 1, card_fee_amount: 101 }, [item(100)])).toMatch(/taxa de cartão deve ficar entre 0 e o total/);
    expect(await csFails(sellerA, { total: 100, payment_type: 'FULL', payment_method: 'PIX', card_fee_amount: 3 }, [item(100)])).toMatch(/só em pagamento com cartão/);
    expect(await csFails(sellerA, { total: 100, payment_type: 'FULL', payment_method: 'Cartão Crédito', card_installments: 1, card_fee_amount: 50 }, [item(100)])).toMatch(/não confere com a taxa da loja \(esperado: 3/);
    // Dividido: no máximo a parte em cartão × maior % (3%): entrada PIX 40, restante cartão 60 → até 1,80.
    expect(await csFails(sellerA, { total: 100, payment_type: 'PARTIAL', down_payment: 40, remaining_amount: 60, down_payment_method: 'PIX', remaining_payment_method: 'CREDIT_CARD', card_fee_amount: 5 }, [item(100)])).toMatch(/passa da taxa configurada/);
  });

  it('NaN e Infinity recusados no preço (sem total), desconto, taxa, entrada e restante', async () => {
    const before = (await t.sql(`SELECT count(*)::int n FROM transactions`))[0].n;
    for (const bad of ['NaN', 'Infinity', '-Infinity']) {
      expect(await csFails(sellerA, { payment_type: 'FULL', payment_method: 'PIX' }, [{ product_name: 'X', quantity: 1, unit_price: bad }]), `preço ${bad}`).toMatch(/Valores dos itens inválidos/);
      for (const f of ['discount', 'card_fee_amount', 'down_payment', 'remaining_amount', 'total']) {
        expect(await csFails(sellerA, { total: 100, payment_type: 'PARTIAL', payment_method: 'Cartão Crédito', [f]: bad }, [item(100)]), `${f} ${bad}`).toMatch(/Valores da venda inválidos/);
      }
    }
    expect((await t.sql(`SELECT count(*)::int n FROM transactions`))[0].n).toBe(before);
  });

  it('CHECK de finitude (061) recusa NaN e Infinity gravados direto, até pelo servidor', async () => {
    const [{ id }] = await t.sql(`INSERT INTO sales (total, store_id) VALUES (1, $1) RETURNING id`, [storeA]);
    for (const q of [
      `UPDATE sales SET total = 'NaN' WHERE id = $1`,
      `UPDATE sales SET card_fee_amount = 'Infinity' WHERE id = $1`,
      `UPDATE sales SET discount = '-Infinity' WHERE id = $1`,
      `INSERT INTO sale_items (sale_id, store_id, product_name, quantity, unit_price) VALUES ($1, '${storeA}', 'X', 1, 'NaN')`,
      `INSERT INTO transactions (description, amount, type, category, sale_id, store_id) VALUES ('X', 'Infinity', 'INCOME', 'Vendas', $1, '${storeA}')`,
    ]) {
      await expect(t.sql(q, [id]), q).rejects.toThrow(/_finito/);
    }
  });

  it('venda normal do vendedor: à vista no cartão, débito, dividida e com desconto', async () => {
    const [{ r: a }] = await cs(sellerA, { total: 200, payment_type: 'FULL', payment_method: 'Cartão Crédito', card_installments: 1, card_fee_amount: 6 }, [item(100, 2)]);
    expect(await txOf(a.sale_id)).toEqual([{ type: 'EXPENSE', amount: 6 }, { type: 'INCOME', amount: 200 }]);
    const [s] = await t.sql(`SELECT total::float8 total, card_fee_percentage::float8 pct FROM sales WHERE id = $1`, [a.sale_id]);
    expect(s).toEqual({ total: 200, pct: 3 });

    const [{ r: b }] = await cs(sellerA, { total: 100, payment_type: 'FULL', payment_method: 'DEBIT_CARD', down_payment: 100, card_installments: 0, card_fee_amount: 1 }, [item(100)]);
    expect(await txOf(b.sale_id)).toEqual([{ type: 'EXPENSE', amount: 1 }, { type: 'INCOME', amount: 100 }]);

    const [{ r: c }] = await cs(sellerA, { total: 90, discount: 10, payment_type: 'PARTIAL', down_payment: 40, remaining_amount: 50, down_payment_method: 'PIX', remaining_payment_method: 'Cartão Crédito', card_fee_amount: 1.5, remaining_status: 'PENDING' }, [item(100)]);
    expect(await txOf(c.sale_id)).toEqual([{ type: 'EXPENSE', amount: 1.5 }, { type: 'INCOME', amount: 40 }, { type: 'INCOME', amount: 50 }]);

    // Arredondamento do front (float) dentro de 1 centavo é aceito e gravado com o valor do servidor.
    const [{ r: d }] = await cs(sellerA, { total: 33.33, payment_type: 'FULL', payment_method: 'Cartão Crédito', card_installments: 1, card_fee_amount: 0.9999 }, [item(11.11, 3)]);
    expect(await txOf(d.sale_id)).toEqual([{ type: 'EXPENSE', amount: 1 }, { type: 'INCOME', amount: 33.33 }]);
  });

  it('sem taxa configurada na loja: taxa enviada aceita até o total, só com cartão', async () => {
    const [{ r }] = await cs(ownerC, { total: 100, payment_type: 'FULL', payment_method: 'Cartão Crédito', card_installments: 3, card_fee_amount: 4 }, [item(100)]);
    expect(await txOf(r.sale_id)).toEqual([{ type: 'EXPENSE', amount: 4 }, { type: 'INCOME', amount: 100 }]);
  });

  it('gerente e dono: sem regressão e mesmas validações', async () => {
    for (const who of [managerA, ownerA]) {
      const [{ r }] = await cs(who, { total: 150, payment_type: 'FULL', payment_method: 'Dinheiro' }, [item(50, 3)]);
      expect(await txOf(r.sale_id)).toEqual([{ type: 'INCOME', amount: 150 }]);
      expect(await csFails(who, { total: 999, payment_type: 'FULL' }, [item(50, 3)])).toMatch(/não confere com os itens/);
    }
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

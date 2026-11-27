// Testes de banco (PGlite local): migrações 001–058, RLS por loja e por papel, limites e regras do lançamento.
// Nenhuma conexão remota. Dados fictícios: duas lojas ("Loja A", "Loja B").
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
let admin: string, ownerA: string, managerA: string, sellerA: string, ownerB: string;
let storeA: string, storeB: string;
let productA: string, productB: string;

beforeAll(async () => {
  t = await createTestDb();
  admin = await t.createUser('admin@teste.local', { platformAdmin: true });
  ownerA = await t.createUser('dono.a@teste.local');
  managerA = await t.createUser('gerente.a@teste.local');
  sellerA = await t.createUser('vendedor.a@teste.local');
  ownerB = await t.createUser('dono.b@teste.local');
  storeA = await t.createStore('Loja A', ownerA, { plan: 'avancado' });
  storeB = await t.createStore('Loja B', ownerB, { plan: 'crescimento' });
  await t.addMember(storeA, managerA, 'MANAGER');
  await t.addMember(storeA, sellerA, 'SELLER');
  [{ id: productA }] = await t.sql(`INSERT INTO products (name, price, quantity, min_stock, store_id) VALUES ('Sofá A', 1000, 10, 2, $1) RETURNING id`, [storeA]);
  [{ id: productB }] = await t.sql(`INSERT INTO products (name, price, quantity, store_id) VALUES ('Mesa B', 500, 5, $1) RETURNING id`, [storeB]);
  await t.sql(`INSERT INTO customers (name, store_id) VALUES ('Cliente A', $1), ('Cliente B', $2)`, [storeA, storeB]);
}, 120_000);

afterAll(async () => { await t?.close(); });

describe('migrações', () => {
  it('reaplicar 048+ não quebra (idempotência é testada por tests/db/replay.mjs --twice)', async () => {
    const [{ n }] = await t.sql(`SELECT count(*)::int n FROM pg_proc WHERE proname IN ('create_sale','stock_transfer','record_terms_acceptance','purge_unconverted_trial')`);
    expect(n).toBe(4);
  });
});

describe('isolamento entre lojas', () => {
  it('dono da loja A não vê produtos nem clientes da loja B', async () => {
    const prods = await t.as(ownerA, `SELECT name FROM products`);
    expect(prods.map(p => p.name)).toEqual(['Sofá A']);
    const custs = await t.as(ownerA, `SELECT name FROM customers`);
    expect(custs.map(c => c.name)).toEqual(['Cliente A']);
  });

  it('UPDATE e DELETE em linha da loja B não afetam nada', async () => {
    const up = await t.as(ownerA, `UPDATE products SET price = 1 WHERE id = $1 RETURNING id`, [productB]);
    expect(up).toHaveLength(0);
    const del = await t.as(ownerA, `DELETE FROM products WHERE id = $1 RETURNING id`, [productB]);
    expect(del).toHaveLength(0);
    const [{ price }] = await t.sql(`SELECT price FROM products WHERE id = $1`, [productB]);
    expect(Number(price)).toBe(500);
  });

  it('INSERT com store_id da loja B é recusado', async () => {
    const msg = await t.fails(sellerA, `INSERT INTO customers (name, store_id) VALUES ('X', $1)`, [storeB]);
    expect(msg).toMatch(/row-level security/);
  });

  it('anônimo não lê nada', async () => {
    expect(await t.as(null, `SELECT id FROM products`)).toHaveLength(0);
  });

  it('set_active_store para loja de outro dono é recusado', async () => {
    expect(await t.fails(ownerA, `SELECT set_active_store($1)`, [storeB])).toMatch(/não faz parte/);
  });
});

describe('RLS por papel (053)', () => {
  const tables = ['products', 'customers', 'suppliers', 'orders', 'deliveries', 'production_orders',
                  'stock_movements', 'categories', 'category_groups', 'card_fees'];
  const seed: Record<string, string> = {
    products: `INSERT INTO products (name, price, store_id) VALUES ('Tmp', 1, $1) RETURNING id`,
    customers: `INSERT INTO customers (name, store_id) VALUES ('Tmp', $1) RETURNING id`,
    suppliers: `INSERT INTO suppliers (name, store_id) VALUES ('Tmp', $1) RETURNING id`,
    orders: `INSERT INTO orders (product_name, store_id) VALUES ('Tmp', $1) RETURNING id`,
    deliveries: `INSERT INTO deliveries (customer_name, store_id) VALUES ('Tmp', $1) RETURNING id`,
    production_orders: `INSERT INTO production_orders (item_name, store_id) VALUES ('Tmp', $1) RETURNING id`,
    stock_movements: `INSERT INTO stock_movements (quantity, type, store_id) VALUES (1, 'IN', $1) RETURNING id`,
    categories: `INSERT INTO categories (name, type, store_id) VALUES ('Tmp', 'EXPENSE', $1) RETURNING id`,
    category_groups: `INSERT INTO category_groups (name, store_id) VALUES ('Tmp', $1) RETURNING id`,
    card_fees: `INSERT INTO card_fees (installments, percentage, store_id) VALUES (1, 2.5, $1) RETURNING id`,
  };

  it.each(tables)('vendedor não exclui em %s; gerente exclui', async table => {
    const [{ id }] = await t.sql(seed[table], [storeA]);
    expect(await t.as(sellerA, `DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id])).toHaveLength(0);
    expect(await t.as(managerA, `DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id])).toHaveLength(1);
  });

  it('vendedor ainda cria e edita cliente da própria loja', async () => {
    const [{ id }] = await t.as(sellerA, `INSERT INTO customers (name) VALUES ('Novo') RETURNING id`);
    expect(await t.as(sellerA, `UPDATE customers SET phone = '1' WHERE id = $1 RETURNING id`, [id])).toHaveLength(1);
  });

  it('card_fees: vendedor não cria nem edita taxa; dono cria', async () => {
    expect(await t.fails(sellerA, `INSERT INTO card_fees (installments, percentage) VALUES (2, 3)`)).toMatch(/row-level security/);
    expect(await t.as(ownerA, `INSERT INTO card_fees (installments, percentage) VALUES (2, 3) RETURNING id`)).toHaveLength(1);
  });

  it('producao-anexos: vendedor não exclui anexo; dono exclui', async () => {
    await t.sql(`INSERT INTO storage.objects (bucket_id, name) VALUES ('producao-anexos', $1)`, [`${storeA}/os/a.pdf`]);
    expect(await t.as(sellerA, `DELETE FROM storage.objects WHERE name = $1 RETURNING id`, [`${storeA}/os/a.pdf`])).toHaveLength(0);
    expect(await t.as(ownerA, `DELETE FROM storage.objects WHERE name = $1 RETURNING id`, [`${storeA}/os/a.pdf`])).toHaveLength(1);
  });
});

describe('Storage: bucket products por loja (051)', () => {
  it('upload na pasta da própria loja passa', async () => {
    expect(await t.as(sellerA, `INSERT INTO storage.objects (bucket_id, name) VALUES ('products', $1) RETURNING id`, [`${storeA}/sofa.jpg`])).toHaveLength(1);
  });
  it('upload na pasta de outra loja ou fora de pasta é recusado', async () => {
    expect(await t.fails(sellerA, `INSERT INTO storage.objects (bucket_id, name) VALUES ('products', $1)`, [`${storeB}/x.jpg`])).toMatch(/row-level security/);
    expect(await t.fails(sellerA, `INSERT INTO storage.objects (bucket_id, name) VALUES ('products', 'solto.jpg')`)).toMatch(/row-level security/);
  });
  it('mover objeto para a pasta de outra loja é recusado', async () => {
    expect(await t.fails(ownerA, `UPDATE storage.objects SET name = $1 WHERE name = $2`, [`${storeB}/sofa.jpg`, `${storeA}/sofa.jpg`])).toMatch(/row-level security/);
  });
  it('loja B não lista nem apaga a imagem da loja A', async () => {
    expect(await t.as(ownerB, `SELECT id FROM storage.objects WHERE bucket_id = 'products'`)).toHaveLength(0);
    expect(await t.as(ownerB, `DELETE FROM storage.objects WHERE name = $1 RETURNING id`, [`${storeA}/sofa.jpg`])).toHaveLength(0);
    expect(await t.as(ownerA, `SELECT id FROM storage.objects WHERE bucket_id = 'products'`)).toHaveLength(1);
  });
});

describe('planos, módulos e core (048)', () => {
  it('limites 1/3/6, anual = 10× e custom fora do fluxo', async () => {
    const rows = await t.sql(`SELECT key, max_sellers, price_cents, annual_price_cents, active FROM plans ORDER BY key`);
    const by = Object.fromEntries(rows.map(r => [r.key, r]));
    expect([by.inicio.max_sellers, by.crescimento.max_sellers, by.avancado.max_sellers]).toEqual([1, 3, 6]);
    for (const k of ['inicio', 'crescimento', 'avancado']) expect(by[k].annual_price_cents).toBe(by[k].price_cents * 10);
    expect(by.custom.active).toBe(false);
  });

  it('core = dashboard, sales, customers, inventory, settings', async () => {
    const rows = await t.sql(`SELECT key FROM module_catalog WHERE core ORDER BY key`);
    expect(rows.map(r => r.key)).toEqual(['customers', 'dashboard', 'inventory', 'sales', 'settings']);
  });

  it('plano não consegue desligar módulo core', async () => {
    await expect(t.sql(`UPDATE plan_modules SET enabled = false WHERE plan_key = 'inicio' AND module_key = 'customers'`)).rejects.toThrow(/MODULO_CORE/);
  });

  it('override: core recusado; liga e desliga módulo comum; limpar volta ao plano', async () => {
    expect(await t.fails(admin, `SELECT admin_set_module_override($1, 'inventory', false)`, [storeB])).toMatch(/MODULO_CORE/);
    await t.as(admin, `SELECT admin_set_module_override($1, 'deliveries', true)`, [storeB]);
    let [{ on }] = await t.as(admin, `SELECT store_module_enabled($1, 'deliveries') AS on`, [storeB]);
    expect(on).toBe(true);
    await t.as(admin, `SELECT admin_set_module_override($1, 'financial', false)`, [storeB]);
    [{ on }] = await t.as(admin, `SELECT store_module_enabled($1, 'financial') AS on`, [storeB]);
    expect(on).toBe(false);
    await t.as(admin, `SELECT admin_clear_module_override($1, 'financial')`, [storeB]);
    [{ on }] = await t.as(admin, `SELECT store_module_enabled($1, 'financial') AS on`, [storeB]);
    expect(on).toBe(true);
    const [{ reason, expires_at }] = await t.sql(`SELECT reason, expires_at FROM store_module_overrides WHERE store_id = $1 AND module_key = 'deliveries' AND revoked_at IS NULL`, [storeB]);
    expect(reason).toBeNull();
    expect(expires_at).toBeNull();
    await t.as(admin, `SELECT admin_clear_module_override($1, 'deliveries')`, [storeB]);
  });

  it('não-admin não chama RPCs do painel', async () => {
    expect(await t.fails(ownerA, `SELECT admin_set_module_override($1, 'deliveries', true)`, [storeA])).toMatch(/administrador da plataforma/);
    expect(await t.fails(ownerA, `SELECT admin_list_stores('{}'::jsonb)`)).toMatch(/administrador da plataforma/);
    expect(await t.fails(ownerA, `SELECT admin_request_plan_change($1, 'inicio')`, [storeA])).toMatch(/administrador da plataforma/);
    expect(await t.fails(sellerA, `SELECT * FROM admin_create_client('x@y.zz', 'Loja X')`)).toMatch(/administrador da plataforma/);
  });

  it('admin_set_plan legado não existe mais', async () => {
    const r = await t.sql(`SELECT 1 FROM pg_proc WHERE proname = 'admin_set_plan'`);
    expect(r).toHaveLength(0);
  });
});

describe('limite de vendedores e downgrade (049)', () => {
  let store: string, owner: string;
  const sellers: string[] = [];
  beforeAll(async () => {
    owner = await t.createUser('dono.limite@teste.local');
    store = await t.createStore('Loja Limite', owner, { plan: 'inicio' });
    for (let i = 0; i < 4; i++) sellers.push(await t.createUser(`v${i}.limite@teste.local`));
  });

  it('Início: o 1º vendedor entra, o 2º é bloqueado no banco', async () => {
    await t.sql(`INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'SELLER')`, [store, sellers[0]]);
    await expect(t.sql(`INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'SELLER')`, [store, sellers[1]]))
      .rejects.toThrow(/LIMITE_VENDEDORES/);
  });

  it('upgrade para Crescimento vale na hora e libera até 3', async () => {
    const [{ r }] = await t.as(admin, `SELECT admin_request_plan_change($1, 'crescimento') r`, [store]);
    expect(r.kind).toBe('upgrade');
    expect(r.status).toBe('aplicado');
    await t.sql(`INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'SELLER'), ($1, $3, 'SELLER')`, [store, sellers[1], sellers[2]]);
    await expect(t.sql(`INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'SELLER')`, [store, sellers[3]]))
      .rejects.toThrow(/LIMITE_VENDEDORES/);
  });

  it('downgrade para Início é recusado e diz quantos precisam sair', async () => {
    const [{ p }] = await t.as(admin, `SELECT admin_plan_change_preview($1, 'inicio') p`, [store]);
    expect(p).toMatchObject({ limite: 1, atuais: 3, excedentes: 2 });
    const msg = await t.fails(admin, `SELECT admin_request_plan_change($1, 'inicio')`, [store]);
    expect(msg).toMatch(/LIMITE_VENDEDORES: remova 2 vendedor/);
    const [{ plan_id }] = await t.sql(`SELECT plan_id FROM subscriptions WHERE store_id = $1`, [store]);
    expect(plan_id).toBe('crescimento');
  });

  it('depois de remover os excedentes, o downgrade passa e recalcula os módulos', async () => {
    await t.sql(`DELETE FROM store_members WHERE store_id = $1 AND user_id IN ($2, $3)`, [store, sellers[1], sellers[2]]);
    const [{ r }] = await t.as(admin, `SELECT admin_request_plan_change($1, 'inicio') r`, [store]);
    expect(r.kind).toBe('downgrade');
    const [{ enabled }] = await t.sql(`SELECT enabled FROM store_modules WHERE store_id = $1 AND module_key = 'financial'`, [store]);
    expect(enabled).toBe(false);
  });

  it('loja em trial sem assinatura segue o limite do Avançado (6)', async () => {
    const o = await t.createUser('dono.trial@teste.local');
    const s = await t.createStore('Loja Trial', o, { status: 'trial' });
    const [{ lim }] = await t.sql(`SELECT public.store_seller_limit($1) lim`, [s]);
    expect(lim).toBe(6);
  });
});

describe('um dono = uma loja e criação pelo admin (050)', () => {
  it('admin_create_client recusa e-mail que já é dono', async () => {
    expect(await t.fails(admin, `SELECT * FROM admin_create_client('dono.a@teste.local', 'Outra')`)).toMatch(/UMA_LOJA_POR_DONO/);
  });

  it('segunda loja como OWNER é recusada também direto na tabela', async () => {
    await expect(t.sql(`INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [storeB, ownerA]))
      .rejects.toThrow(/UMA_LOJA_POR_DONO/);
  });

  it('loja paga: assinatura ativa, contrato manual e módulos do plano', async () => {
    const u = await t.createUser('novo.dono@teste.local');
    const [{ store_id, account_exists }] = await t.as(admin,
      `SELECT * FROM admin_create_client('novo.dono@teste.local', 'Loja Paga', NULL, 'paid', NULL, 30, 'crescimento', NULL)`);
    expect(account_exists).toBe(true);
    const [sub] = await t.sql(`SELECT plan_id, status, price_cents FROM subscriptions WHERE store_id = $1`, [store_id]);
    expect(sub).toMatchObject({ plan_id: 'crescimento', status: 'active', price_cents: 9900 });
    const [{ billing_mode }] = await t.sql(`SELECT billing_mode FROM stores WHERE id = $1`, [store_id]);
    expect(billing_mode).toBe('manual_contract');
    const mods = await t.sql(`SELECT module_key FROM store_modules WHERE store_id = $1 AND enabled ORDER BY 1`, [store_id]);
    expect(mods.map(m => m.module_key)).toEqual(
      ['boletos', 'customers', 'dashboard', 'financial', 'inventory', 'orders', 'production', 'quotes', 'reports', 'sales', 'settings', 'suppliers']);
    const [{ role }] = await t.sql(`SELECT role FROM store_members WHERE store_id = $1 AND user_id = $2`, [store_id, u]);
    expect(role).toBe('OWNER');
  });

  it('loja paga sem plano é recusada; trial sem plano usa os módulos do trial', async () => {
    expect(await t.fails(admin, `SELECT * FROM admin_create_client('z1@teste.local', 'Z', NULL, 'paid')`)).toMatch(/precisa do plano/);
    const [{ store_id, account_exists }] = await t.as(admin, `SELECT * FROM admin_create_client('z2@teste.local', 'Z2')`);
    expect(account_exists).toBe(false);
    const [{ status }] = await t.sql(`SELECT status FROM stores WHERE id = $1`, [store_id]);
    expect(status).toBe('trial');
  });

  it('lista do admin traz dono, vendedores, limite, preço, ciclo e filtro q', async () => {
    const [{ r }] = await t.as(admin, `SELECT admin_list_stores('{"q":"loja a"}'::jsonb) r`);
    expect(r.count).toBe(1);
    expect(r.items[0]).toMatchObject({ name: 'Loja A', owner_email: 'dono.a@teste.local', sellers_count: 1, max_sellers: 6, plano: 'avancado', billing_cycle: 'monthly' });
  });

  it('ficha traz módulos (core e override) e membros', async () => {
    const [{ d }] = await t.as(admin, `SELECT admin_store_detail($1) d`, [storeA]);
    expect(d.membros.map((m: any) => m.role)).toEqual(['OWNER', 'MANAGER', 'SELLER']);
    const inv = d.modulos.find((m: any) => m.module_key === 'inventory');
    expect(inv).toMatchObject({ core: true, enabled: true, override: null });
  });

  it('encerrar loja de contrato manual funciona com a cobrança adiada', async () => {
    const [{ store_id }] = await t.as(admin, `SELECT * FROM admin_create_client('z3@teste.local', 'Z3', NULL, 'paid', NULL, 30, 'inicio')`);
    const [{ r }] = await t.as(admin, `SELECT admin_close_store($1) r`, [store_id]);
    expect(r.status).toBe('expired');
  });
});

describe('aceite dos Termos (051)', () => {
  it('registra uma vez por versão; cada um vê só o seu; sem INSERT direto', async () => {
    await t.as(sellerA, `SELECT record_terms_acceptance('rascunho-2026-11')`);
    await t.as(sellerA, `SELECT record_terms_acceptance('rascunho-2026-11')`);
    const mine = await t.as(sellerA, `SELECT version, store_id FROM terms_acceptances`);
    expect(mine).toEqual([{ version: 'rascunho-2026-11', store_id: storeA }]);
    expect(await t.as(ownerB, `SELECT id FROM terms_acceptances`)).toHaveLength(0);
    expect(await t.fails(sellerA, `INSERT INTO terms_acceptances (user_id, version) VALUES ($1, 'x')`, [sellerA])).toMatch(/permission denied/);
    expect(await t.fails(null, `SELECT record_terms_acceptance('x')`)).toMatch(/permission denied|login/);
  });
});

describe('limpeza de trial não convertido (052)', () => {
  it('usuário logado (mesmo admin) não executa', async () => {
    expect(await t.fails(admin, `SELECT purge_unconverted_trial($1)`, [storeA])).toMatch(/permission denied|servidor/);
  });

  it('simulação conta; execução apaga os dados, mantém o login do dono e remove o vendedor', async () => {
    const o = await t.createUser('dono.vencido@teste.local');
    const v = await t.createUser('vend.vencido@teste.local');
    const s = await t.createStore('Trial Vencido', o, { status: 'trial' });
    await t.addMember(s, v, 'SELLER');
    await t.sql(`UPDATE stores SET is_trial = true, trial_ends_at = now() - interval '1 hour' WHERE id = $1`, [s]);
    await t.sql(`INSERT INTO products (name, price, store_id) VALUES ('P', 1, $1)`, [s]);
    await t.sql(`INSERT INTO customers (name, store_id) VALUES ('C', $1)`, [s]);

    const [{ r: dry }] = await t.as('service', `SELECT purge_unconverted_trial($1) r`, [s]);
    expect(dry.dry_run).toBe(true);
    expect(dry.linhas).toMatchObject({ products: 1, customers: 1, store_members: 2 });
    expect(await t.sql(`SELECT id FROM products WHERE store_id = $1`, [s])).toHaveLength(1);

    const [{ r }] = await t.as('service', `SELECT purge_unconverted_trial($1, false) r`, [s]);
    expect(r.contas_removidas).toBe(1);
    expect(await t.sql(`SELECT id FROM products WHERE store_id = $1`, [s])).toHaveLength(0);
    expect(await t.sql(`SELECT id FROM auth.users WHERE id = $1`, [o])).toHaveLength(1);
    expect(await t.sql(`SELECT id FROM auth.users WHERE id = $1`, [v])).toHaveLength(0);
    const [st] = await t.sql(`SELECT is_active, status FROM stores WHERE id = $1`, [s]);
    expect(st).toEqual({ is_active: false, status: 'expired' });
  });

  it('recusa trial ainda vigente e loja paga', async () => {
    expect(await t.fails('service', `SELECT purge_unconverted_trial($1, false)`, [storeA])).toMatch(/Só loja de trial|assinatura/);
  });
});

describe('venda numa transação (055)', () => {
  it('serviço com entrega gera OS, entrega ligada à OS e lançamentos; produto baixa estoque', async () => {
    const sale = {
      customer_name: 'Cliente A', delivery_type: 'DELIVERY', total: 1500, payment_type: 'PARTIAL',
      down_payment: 500, remaining_amount: 1000, remaining_status: 'PENDING', payment_method: 'PIX', card_fee_amount: 0,
    };
    const items = [
      { product_id: productA, product_name: 'Sofá A', quantity: 1, unit_price: 1000, category: 'Móveis' },
      { product_name: 'Sofá sob medida', quantity: 1, unit_price: 500, category: 'Serviços', service_specs: '{"medidas":"2m"}' },
    ];
    const [{ r }] = await t.as(sellerA, `SELECT create_sale($1::jsonb, $2::jsonb) r`, [JSON.stringify(sale), JSON.stringify(items)]);
    expect(r).toMatchObject({ itens: 2, ordens_producao: 1, entregas: 2, lancamentos: 2, movimentos_estoque: 1 });
    const [{ quantity }] = await t.sql(`SELECT quantity FROM products WHERE id = $1`, [productA]);
    expect(quantity).toBe(9);
    const [po] = await t.sql(`SELECT id FROM production_orders WHERE sale_id = $1`, [r.sale_id]);
    const [dl] = await t.sql(`SELECT origin FROM deliveries WHERE production_order_id = $1`, [po.id]);
    expect(dl.origin).toBe('PRODUCTION');
    const tx = await t.sql(`SELECT amount, status FROM transactions WHERE sale_id = $1 ORDER BY amount`, [r.sale_id]);
    expect(tx.map(x => [Number(x.amount), x.status])).toEqual([[500, 'PAID'], [1000, 'PENDING']]);
    const [{ created_by }] = await t.sql(`SELECT created_by FROM sales WHERE id = $1`, [r.sale_id]);
    expect(created_by).toBe(sellerA);
  });

  it('item de outra loja desfaz tudo (nada fica gravado)', async () => {
    const before = await t.sql(`SELECT count(*)::int n FROM sales`);
    const msg = await t.fails(sellerA, `SELECT create_sale('{"total":10}'::jsonb, $1::jsonb)`,
      [JSON.stringify([{ product_id: productB, product_name: 'Mesa B', quantity: 1, unit_price: 10 }])]);
    expect(msg).toMatch(/não pertence/);
    expect(await t.sql(`SELECT count(*)::int n FROM sales`)).toEqual(before);
  });

  it('sem módulo Produção (plano Início), serviço não gera OS', async () => {
    const o = await t.createUser('dono.inicio@teste.local');
    await t.createStore('Loja Início', o, { plan: 'inicio' });
    const [{ r }] = await t.as(o, `SELECT create_sale('{"total":10,"payment_type":"FULL"}'::jsonb, $1::jsonb) r`,
      [JSON.stringify([{ product_name: 'Montagem', quantity: 1, unit_price: 10, category: 'Serviços' }])]);
    expect(r).toMatchObject({ ordens_producao: 0, lancamentos: 0 });
  });
});

describe('depósitos (056)', () => {
  it('transfere da loja para o depósito, mostra saldo por local e bloqueia saída que invade o depósito', async () => {
    const def = (await t.as(ownerA, `SELECT ensure_default_warehouse() id`))[0].id;
    const dep = (await t.as(ownerA, `SELECT upsert_warehouse('Depósito Centro') id`))[0].id;
    await t.as(ownerA, `SELECT stock_transfer($1, $2, $3, 6)`, [productA, def, dep]);
    const loc = await t.as(sellerA, `SELECT warehouse_name, quantity FROM stock_by_location($1)`, [productA]);
    expect(loc).toEqual([{ warehouse_name: 'Loja', quantity: 3 }, { warehouse_name: 'Depósito Centro', quantity: 6 }]);
    const [{ quantity }] = await t.sql(`SELECT quantity FROM products WHERE id = $1`, [productA]);
    expect(quantity).toBe(9);
    expect(await t.fails(ownerA, `SELECT stock_transfer($1, $2, $3, 4)`, [productA, def, dep])).toMatch(/Saldo insuficiente/);
    expect(await t.fails(ownerA, `UPDATE products SET quantity = 5 WHERE id = $1`, [productA])).toMatch(/ESTOQUE_DEPOSITO/);
    expect(await t.fails(sellerA, `SELECT stock_transfer($1, $2, $3, 1)`, [productA, dep, def])).toMatch(/dono ou gerente/);
    await t.as(managerA, `SELECT stock_transfer($1, $2, $3, 6)`, [productA, dep, def]);
  });

  it('loja B não vê depósitos da loja A', async () => {
    expect(await t.as(ownerB, `SELECT id FROM warehouses`)).toHaveLength(0);
  });
});

describe('push só para o dono (054)', () => {
  it('estoque baixo dispara um evento quando cruza o mínimo (módulo push ligado)', async () => {
    await t.sql(`INSERT INTO vault.decrypted_secrets VALUES ('push_webhook_secret', 'segredo-teste') ON CONFLICT DO NOTHING`);
    await t.sql(`DELETE FROM net.requests`);
    await t.as(ownerA, `UPDATE products SET quantity = 2 WHERE id = $1`, [productA]);
    await t.as(ownerA, `UPDATE products SET quantity = 1 WHERE id = $1`, [productA]);
    const reqs = await t.sql(`SELECT body FROM net.requests`);
    expect(reqs.map(r => r.body.type)).toEqual(['low_stock']);
  });

  it('loja sem o módulo push (Crescimento) não dispara', async () => {
    await t.sql(`DELETE FROM net.requests`);
    await t.as(ownerB, `UPDATE products SET min_stock = 3, quantity = 2 WHERE id = $1`, [productB]);
    expect(await t.sql(`SELECT id FROM net.requests`)).toHaveLength(0);
  });
});

import type { Page, Route } from '@playwright/test';

/**
 * Supabase falso, só em memória, para o E2E rodar sem banco (modo "mock").
 * Intercepta no navegador as chamadas para a URL falsa do Supabase (VITE_SUPABASE_URL do servidor de teste):
 * Auth (login), PostgREST (tabelas e RPCs) e Edge Functions (manage-users).
 * Nada sai da máquina; nenhuma loja real é tocada.
 *
 * As regras de negócio que o banco aplica (limite de vendedores, downgrade) são reproduzidas aqui
 * do jeito combinado com o Backend, para a tela poder ser testada. A prova de verdade dessas regras
 * é o teste do Backend no banco local; este mock só testa a tela.
 */

export const MOCK_SUPABASE_URL = 'https://e2e-mock.supabase.co';

type Row = Record<string, any>;
type RpcHandler = (args: Row, db: MockDb) => { status?: number; body: unknown };

export interface MockUser {
  id: string;
  email: string;
  password: string;
  name: string;
  isPlatformAdmin?: boolean;
}

export interface MockStore {
  id: string;
  name: string;
  status: 'trial' | 'active' | 'suspended' | 'expired';
  plan: string | null;
  ownerEmail: string;
  endsAt: string | null;
  createdAt: string;
}

export interface MockMember { storeId: string; userId: string; email: string; name: string; role: 'OWNER' | 'MANAGER' | 'SELLER'; permissions: string[] }

const PLAN_LIMITS: Record<string, number> = { inicio: 1, crescimento: 3, avancado: 6, trial: 6 };
const PLAN_RANK: Record<string, number> = { inicio: 0, crescimento: 1, avancado: 2 };
const CORE = new Set(['dashboard', 'sales', 'customers', 'inventory', 'settings']);
const PLAN_MODULES: Record<string, string[]> = {
  inicio: [...CORE],
  crescimento: [...CORE, 'financial', 'boletos', 'reports', 'production', 'quotes', 'suppliers', 'orders'],
  avancado: [...CORE, 'financial', 'boletos', 'reports', 'production', 'quotes', 'suppliers', 'orders', 'deliveries', 'push_notifications', 'custom_production', 'brand'],
};
PLAN_MODULES.trial = PLAN_MODULES.avancado;

let seq = 0;
export const uuid = () => {
  seq += 1;
  const hex = (seq + 0x1000).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex.slice(-12)}`;
};

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (sub: string, email: string) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;

export class MockDb {
  users: MockUser[] = [];
  stores: MockStore[] = [];
  members: MockMember[] = [];
  tables: Record<string, Row[]> = {};
  overrides: { storeId: string; module: string; enabled: boolean }[] = [];
  termsAccepted: { userId: string; version: string }[] = [];
  /** Usuário logado (pelo token da última chamada). */
  currentUserId: string | null = null;
  activeStore: Record<string, string> = {};
  calls: { name: string; args: Row }[] = [];

  table(name: string) {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name];
  }

  user() { return this.users.find(u => u.id === this.currentUserId) || null; }

  sellers(storeId: string) { return this.members.filter(m => m.storeId === storeId && m.role === 'SELLER'); }

  moduleEnabled(storeId: string, key: string) {
    if (CORE.has(key)) return true;
    const ov = this.overrides.find(o => o.storeId === storeId && o.module === key);
    if (ov) return ov.enabled;
    const st = this.stores.find(s => s.id === storeId);
    const plan = st?.status === 'trial' ? 'trial' : st?.plan || 'inicio';
    return (PLAN_MODULES[plan] || PLAN_MODULES.inicio).includes(key);
  }
}

/** Cenário padrão: admin do SaaS, um dono com loja no Crescimento e 3 vendedores, produtos e um cliente. */
export const seedDefault = (db = new MockDb()) => {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000).toISOString();
  db.users.push(
    { id: uuid(), email: 'admin@e2e.test', password: 'senha-admin', name: 'Admin SaaS', isPlatformAdmin: true },
    { id: uuid(), email: 'dono@e2e.test', password: 'senha-dono', name: 'Dona Teste' },
  );
  const owner = db.users[1];
  const store: MockStore = { id: uuid(), name: 'Loja E2E Móveis', status: 'active', plan: 'crescimento', ownerEmail: owner.email, endsAt: in30, createdAt: now.toISOString() };
  db.stores.push(store);
  db.members.push({ storeId: store.id, userId: owner.id, email: owner.email, name: owner.name, role: 'OWNER', permissions: [] });
  for (let i = 1; i <= 3; i += 1) {
    const u: MockUser = { id: uuid(), email: `vendedor${i}@e2e.test`, password: 'x', name: `Vendedor ${i}` };
    db.users.push(u);
    db.members.push({ storeId: store.id, userId: u.id, email: u.email, name: u.name, role: 'SELLER', permissions: [] });
  }
  db.activeStore[owner.id] = store.id;
  db.table('products').push(
    { id: uuid(), name: 'Sofá E2E 3 lugares', sku: 'E2E-SOF', price: 1500, cost: 700, quantity: 5, min_stock: 1, category: 'Sofás' },
    { id: uuid(), name: 'Mesa E2E', sku: 'E2E-MES', price: 800, cost: 300, quantity: 2, min_stock: 1, category: 'Mesas' },
  );
  // Taxas de cartão da loja (linha 0 = débito).
  db.table('card_fees').push(
    { id: uuid(), installments: 0, percentage: 1.5 },
    { id: uuid(), installments: 1, percentage: 3 },
    { id: uuid(), installments: 3, percentage: 4 },
  );
  db.table('customers').push({ id: uuid(), name: 'Cliente E2E', cpf_cnpj: '', phone: '', email: '', address: '' });
  db.table('company_settings').push({ id: uuid(), name: 'Loja E2E Móveis', cnpj: '', phone: '', address: '', receipt_message: '' });
  return db;
};

const storeRow = (db: MockDb, s: MockStore) => ({
  id: s.id,
  name: s.name,
  status: s.status,
  plano: s.plan,
  assinatura_status: s.plan ? 'active' : null,
  fim: s.endsAt,
  chave: s.endsAt,
  trial_ends_at: s.status === 'trial' ? s.endsAt : null,
  valid_until: s.status === 'trial' ? null : s.endsAt,
  created_at: s.createdAt,
  owner_email: s.ownerEmail,
  sellers_count: db.sellers(s.id).length,
  max_sellers: s.plan ? PLAN_LIMITS[s.plan] ?? null : null,
});

const requireAdmin = (db: MockDb) => {
  if (!db.user()?.isPlatformAdmin) return { status: 403, body: { code: '42501', message: 'Acesso negado: só o administrador da plataforma.' } };
  return null;
};

const RPC: Record<string, RpcHandler> = {
  my_stores: (_a, db) => {
    const uid = db.currentUserId;
    const u = db.user();
    const list = u?.isPlatformAdmin
      ? db.stores.map(s => ({ ...s, role: 'OWNER' }))
      : db.members.filter(m => m.userId === uid).map(m => ({ ...db.stores.find(s => s.id === m.storeId)!, role: m.role, permissions: m.permissions }));
    return { body: list.map(s => ({ id: s.id, name: s.name, role: (s as any).role, permissions: (s as any).permissions || [], is_active_store: db.activeStore[uid!] === s.id })) };
  },
  my_store_access: (_a, db) => ({
    body: db.stores.map(s => ({
      store_id: s.id, status: s.status, effective_status: s.status, plan: s.plan,
      trial_ends_at: s.status === 'trial' ? s.endsAt : null, valid_until: s.endsAt,
      seconds_remaining: s.endsAt ? Math.floor((new Date(s.endsAt).getTime() - Date.now()) / 1000) : null,
      access_ok: s.status === 'active' || s.status === 'trial',
    })),
  }),
  set_active_store: (a, db) => { db.activeStore[db.currentUserId!] = a.p_store; return { body: null }; },
  store_module_enabled: (a, db) => ({ body: db.moduleEnabled(a.p_store, a.p_module) }),
  store_brand_color: () => ({ body: null }),
  record_terms_acceptance: (a, db) => { db.termsAccepted.push({ userId: db.currentUserId!, version: a.p_version }); return { body: null }; },
  list_store_members: (a, db) => ({
    body: db.members.filter(m => m.storeId === a.p_store).map(m => ({ user_id: m.userId, email: m.email, name: m.name, role: m.role, permissions: m.permissions, created_at: new Date().toISOString() })),
  }),
  remove_store_member: (a, db) => {
    db.members = db.members.filter(m => !(m.storeId === a.p_store && m.userId === a.p_user));
    return { body: null };
  },
  admin_list_stores: (a, db) => {
    const deny = requireAdmin(db); if (deny) return deny;
    const f = a.p_filters || {};
    const items = db.stores
      .filter(s => !f.status || s.status === f.status)
      .filter(s => !f.plan || s.plan === f.plan)
      .map(s => storeRow(db, s));
    return { body: { items, count: items.length, has_more: false, next_after_key: null, next_after_id: null } };
  },
  admin_create_client: (a, db) => {
    const deny = requireAdmin(db); if (deny) return deny;
    const now = Date.now();
    const trial = a.p_mode === 'trial';
    const s: MockStore = {
      id: uuid(), name: a.p_store_name, status: trial ? 'trial' : 'active', plan: trial ? null : a.p_plan,
      ownerEmail: a.p_email, endsAt: new Date(now + (trial ? 3600000 : (a.p_days || 30) * 86400000)).toISOString(), createdAt: new Date(now).toISOString(),
    };
    db.stores.push(s);
    const existing = db.users.find(u => u.email === a.p_email);
    if (existing) db.members.push({ storeId: s.id, userId: existing.id, email: existing.email, name: existing.name, role: 'OWNER', permissions: [] });
    return { body: [{ store_id: s.id, account_exists: !!existing }] };
  },
  admin_extend_store: (a, db) => {
    const deny = requireAdmin(db); if (deny) return deny;
    const s = db.stores.find(x => x.id === a.p_store)!;
    const base = Math.max(Date.now(), s.endsAt ? new Date(s.endsAt).getTime() : 0);
    s.endsAt = new Date(base + (a.p_hours || 0) * 3600000 + (a.p_days || 0) * 86400000).toISOString();
    return { body: s.endsAt };
  },
  admin_set_status: (a, db) => {
    const deny = requireAdmin(db); if (deny) return deny;
    db.stores.find(x => x.id === a.p_store)!.status = a.p_status;
    return { body: null };
  },
  admin_close_store: (a, db) => {
    const deny = requireAdmin(db); if (deny) return deny;
    db.stores.find(x => x.id === a.p_store)!.status = 'expired';
    return { body: { status: 'expired' } };
  },
  admin_request_plan_change: (a, db) => {
    const deny = requireAdmin(db); if (deny) return deny;
    const s = db.stores.find(x => x.id === a.p_store)!;
    const sellers = db.sellers(s.id).length;
    const limit = PLAN_LIMITS[a.p_plan];
    const downgrade = s.plan && PLAN_RANK[a.p_plan] < PLAN_RANK[s.plan];
    if (downgrade && sellers > limit) {
      return { status: 400, body: { code: 'P0001', message: `LIMITE_VENDEDORES: a loja tem ${sellers} vendedores e o plano ${a.p_plan} aceita ${limit}.` } };
    }
    s.plan = a.p_plan;
    return { body: { kind: downgrade ? 'downgrade' : 'upgrade', status: 'aplicado', plan: a.p_plan } };
  },
  admin_store_modules: (a, db) => {
    const deny = requireAdmin(db); if (deny) return deny;
    const keys = ['dashboard', 'reports', 'financial', 'boletos', 'sales', 'quotes', 'customers', 'inventory', 'production', 'custom_production', 'suppliers', 'orders', 'deliveries', 'push_notifications', 'settings', 'brand'];
    return {
      body: keys.map(k => {
        const ov = db.overrides.find(o => o.storeId === a.p_store && o.module === k);
        return { module_key: k, enabled: db.moduleEnabled(a.p_store, k), core: CORE.has(k), override: ov ? (ov.enabled ? 'grant' : 'revoke') : null };
      }),
    };
  },
  admin_set_module_override: (a, db) => {
    const deny = requireAdmin(db); if (deny) return deny;
    if (CORE.has(a.p_module)) return { status: 400, body: { code: 'P0001', message: 'Módulo core não aceita override.' } };
    db.overrides = db.overrides.filter(o => !(o.storeId === a.p_store && o.module === a.p_module));
    db.overrides.push({ storeId: a.p_store, module: a.p_module, enabled: !!a.p_enabled });
    return { body: null };
  },
  admin_clear_module_override: (a, db) => {
    db.overrides = db.overrides.filter(o => !(o.storeId === a.p_store && o.module === a.p_module));
    return { body: null };
  },
  // create_sale (059 + 060): confere os valores como o banco e grava venda, itens, estoque e lançamentos.
  create_sale: (a, db) => {
    const fail = (message: string) => ({ status: 400, body: { code: 'P0001', message } });
    const sale: Row = { id: a.p_sale?.id || uuid(), ...a.p_sale };
    const items: Row[] = a.p_items || [];
    if (!items.length) return fail('Não é possível salvar uma venda sem itens.');
    if (items.some(i => !(Number(i.quantity) > 0) || !Number.isInteger(Number(i.quantity)))) return fail('A quantidade de cada item deve ser maior que zero.');
    if (items.some(i => i.product_id && !db.table('products').some(p => p.id === i.product_id))) return fail('Produto não pertence a esta loja.');
    if (items.some(i => Number(i.unit_price) < 0)) return fail('O preço unitário não pode ser negativo.');
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const subtotal = items.reduce((acc, i) => acc + Number(i.quantity) * Number(i.unit_price || 0), 0);
    const discount = Number(sale.discount || 0);
    if (discount < 0 || discount > subtotal + 0.005) return fail(`O desconto deve ficar entre 0 e o subtotal (${r2(subtotal)}).`);
    const total = r2(subtotal - discount);
    if ('total' in sale && Math.abs(Number(sale.total) - total) > 0.01) return fail(`O total da venda não confere com os itens (calculado: ${total}).`);
    if (!['FULL', 'PARTIAL'].includes(sale.payment_type)) return fail('Tipo de pagamento inválido.');
    const isCard = (m: unknown) => typeof m === 'string' && (['CREDIT_CARD', 'DEBIT_CARD'].includes(m) || /cart[ãa]o/i.test(m));
    const isDebit = (m: unknown) => typeof m === 'string' && (m === 'DEBIT_CARD' || /d[ée]bito/i.test(m));
    let down = Number(sale.down_payment || 0);
    let remaining = Number(sale.remaining_amount || 0);
    let cardAmount = 0;
    if (sale.payment_type === 'FULL') {
      if (down > 0.005 && Math.abs(down - total) > 0.01) return fail('A entrada deve ficar entre 0 e o total.');
      remaining = 0;
      cardAmount = isCard(sale.payment_method) ? total : 0;
    } else {
      if (down < 0 || down > total + 0.005) return fail('A entrada deve ficar entre 0 e o total.');
      if ('remaining_amount' in sale && Math.abs(remaining - (total - down)) > 0.01) return fail(`O restante deve ser o total menos a entrada (${r2(total - down)}).`);
      remaining = r2(total - down);
      cardAmount = (isCard(sale.down_payment_method) ? down : 0) + (isCard(sale.remaining_payment_method) ? remaining : 0);
    }
    const fee = Number(sale.card_fee_amount || 0);
    if (fee < 0 || fee > total + 0.005) return fail('A taxa de cartão deve ficar entre 0 e o total.');
    if (fee > 0.005 && cardAmount === 0) return fail('Taxa de cartão só em pagamento com cartão.');
    const fees = db.table('card_fees');
    if (cardAmount > 0 && fees.length) {
      if (sale.payment_type === 'FULL') {
        const inst = isDebit(sale.payment_method) ? 0 : Number(sale.card_installments || 0);
        const pct = Number(fees.find(f => Number(f.installments) === inst)?.percentage || 0);
        const expected = r2(total * pct / 100);
        if (Math.abs(fee - expected) > 0.01) return fail(`A taxa de cartão não confere com a taxa da loja (esperado: ${expected}).`);
      } else {
        const maxPct = Math.max(...fees.map(f => Number(f.percentage)));
        if (fee > r2(cardAmount * maxPct / 100) + 0.01) return fail('A taxa de cartão passa da taxa configurada da loja.');
      }
    } else if (fee > 0.005) {
      return fail('Loja sem taxa de cartão cadastrada: a taxa da venda deve ser 0.');
    }

    Object.assign(sale, { total, down_payment: down, remaining_amount: remaining });
    db.table('sales').push(sale);
    let movimentos = 0;
    for (const it of items) {
      db.table('sale_items').push({ id: uuid(), sale_id: sale.id, ...it });
      const prod = db.table('products').find(p => p.id === it.product_id);
      if (prod && !it.by_order && it.category !== 'Serviços') {
        prod.quantity = Number(prod.quantity) - Number(it.quantity);
        db.table('stock_movements').push({ id: uuid(), product_id: prod.id, quantity: -Number(it.quantity), type: 'SALE', date: sale.date });
        movimentos += 1;
      }
    }
    const store = db.stores.find(st => st.id === db.activeStore[db.currentUserId!]);
    let lancamentos = 0;
    if (store && db.moduleEnabled(store.id, 'financial')) {
      const push = (t: Row) => { db.table('transactions').push({ id: uuid(), sale_id: sale.id, date: sale.date, ...t }); lancamentos += 1; };
      if (fee > 0.005) push({ description: 'Taxa de Cartão', amount: fee, type: 'EXPENSE', status: 'PAID' });
      if (sale.payment_type === 'FULL') push({ description: 'Venda', amount: total, type: 'INCOME', status: 'PAID' });
      else {
        if (down > 0) push({ description: 'Entrada', amount: down, type: 'INCOME', status: 'PAID' });
        if (remaining > 0) push({ description: 'Restante', amount: remaining, type: 'INCOME', status: sale.remaining_status === 'PAID' ? 'PAID' : 'PENDING' });
      }
    }
    return { body: { sale_id: sale.id, itens: items.length, encomendas: 0, ordens_producao: 0, entregas: 0, lancamentos, movimentos_estoque: movimentos } };
  },
  edit_sale_items: () => ({ body: null }),
  start_self_trial: () => ({ body: null }),
};

/** Lê os filtros simples do PostgREST que o app usa (coluna=eq.valor). */
const eqFilters = (url: URL) => {
  const out: [string, string][] = [];
  url.searchParams.forEach((v, k) => {
    if (v.startsWith('eq.')) out.push([k, decodeURIComponent(v.slice(3))]);
  });
  return out;
};

const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: body === undefined ? '' : JSON.stringify(body) });

export const installSupabaseMock = async (page: Page, db: MockDb) => {
  await page.route(`${MOCK_SUPABASE_URL}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });

    const auth = req.headers()['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString() || '{}');
      db.currentUserId = payload.sub || null;
    } catch { db.currentUserId = null; }

    const body = (() => { try { return req.postDataJSON(); } catch { return null; } })();

    // ---------------- Auth
    if (path.startsWith('/auth/v1/')) {
      if (path === '/auth/v1/token') {
        const u = db.users.find(x => x.email === body?.email && x.password === body?.password);
        if (!u) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', message: 'Invalid login credentials' });
        const user = { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { full_name: u.name }, created_at: new Date().toISOString() };
        return json(route, 200, { access_token: fakeJwt(u.id, u.email), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${u.id}`, user });
      }
      if (path === '/auth/v1/user') {
        const u = db.user();
        if (!u) return json(route, 401, { message: 'not logged' });
        return json(route, 200, { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { full_name: u.name } });
      }
      if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      return json(route, 200, {});
    }

    // ---------------- Edge Functions
    if (path === '/functions/v1/manage-users') {
      db.calls.push({ name: 'manage-users', args: body || {} });
      if (body?.action === 'create_member') {
        if (body.role === 'SELLER') {
          const st = db.stores.find(s => s.id === body.store_id);
          const limit = st ? PLAN_LIMITS[st.status === 'trial' ? 'trial' : st.plan || 'inicio'] : 1;
          if (db.sellers(body.store_id).length >= limit) return json(route, 400, { error: `LIMITE_VENDEDORES: o plano permite ${limit} vendedor(es).` });
        }
        let u = db.users.find(x => x.email === body.email);
        const existing = !!u;
        if (!u) { u = { id: uuid(), email: body.email, password: body.password || '12345678', name: body.name || body.email }; db.users.push(u); }
        db.members.push({ storeId: body.store_id, userId: u.id, email: u.email, name: u.name, role: body.role, permissions: body.permissions || [] });
        // Contrato do Backend: sem senha e chamado pelo admin, a conta nova recebe a provisória 12345678.
        const temp = !existing && !body.password && db.user()?.isPlatformAdmin ? '12345678' : undefined;
        return json(route, 200, { existing_account: existing, temporary_password: temp });
      }
      return json(route, 200, {});
    }

    // ---------------- RPC
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.slice('/rest/v1/rpc/'.length);
      db.calls.push({ name, args: body || {} });
      const h = RPC[name];
      if (!h) return json(route, 404, { code: 'PGRST202', message: `Could not find the function public.${name}` });
      const res = h(body || {}, db);
      return json(route, res.status ?? 200, res.body);
    }

    // ---------------- Tabelas
    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      const rows = db.table(table);
      const filters = eqFilters(url);
      const match = (r: Row) => filters.every(([k, v]) => String(r[k]) === v);
      const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');

      if (table === 'profiles' && method === 'GET') {
        const u = db.user();
        const p = u ? [{ id: u.id, name: u.name, email: u.email, is_platform_admin: !!u.isPlatformAdmin, roles: [] }] : [];
        return wantsObject ? json(route, p.length ? 200 : 406, p[0] ?? { message: 'no rows' }) : json(route, 200, p);
      }

      if (method === 'GET' || method === 'HEAD') {
        const found = rows.filter(match);
        if (wantsObject) return found.length ? json(route, 200, found[0]) : json(route, 406, { code: 'PGRST116', message: 'no rows' });
        return json(route, 200, found, { 'content-range': `0-${Math.max(found.length - 1, 0)}/${found.length}` });
      }
      if (method === 'POST') {
        const list = (Array.isArray(body) ? body : [body]).map((r: Row) => ({ id: r.id || uuid(), ...r }));
        for (const r of list) {
          const i = rows.findIndex(x => x.id === r.id);
          if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push(r);
        }
        return json(route, 201, wantsObject ? list[0] : list);
      }
      if (method === 'PATCH') {
        const updated: Row[] = [];
        rows.forEach((r, i) => { if (match(r)) { rows[i] = { ...r, ...body }; updated.push(rows[i]); } });
        return json(route, 200, wantsObject ? updated[0] ?? null : updated);
      }
      if (method === 'DELETE') {
        db.tables[table] = rows.filter(r => !match(r));
        return json(route, 200, []);
      }
    }

    return json(route, 404, { message: `mock: rota sem resposta ${method} ${path}` });
  });
};

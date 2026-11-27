// Banco local PGlite para testar as migrações e o RLS. Nunca toca um banco remoto.
// Ordem: stubs do Supabase → base (MASTER_SCHEMA.sql.example) → database/migrations em ordem (ver load.mjs).
// As chamadas "como usuário" fazem SET LOCAL ROLE authenticated/anon/service_role (como o PostgREST), com
// auth.uid() vindo de request.jwt.claim.sub. Limite do PGlite: SET SESSION AUTHORIZATION não volta ao fim da
// transação, então session_user fica 'postgres'. As guardas "só servidor" são testadas pelo EXECUTE revogado.
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { loadSchema } from './load.mjs';

export type Who = string | null | 'service';

export interface TestDb {
  db: PGlite;
  /** Executa como superusuário (sem RLS): preparação dos dados. */
  sql<T = any>(q: string, params?: unknown[]): Promise<T[]>;
  /** Executa uma consulta como o usuário (uuid), anônimo (null) ou servidor ('service'). */
  as<T = any>(who: Who, q: string, params?: unknown[]): Promise<T[]>;
  /** Espera que a consulta falhe; devolve a mensagem do erro. */
  fails(who: Who, q: string, params?: unknown[]): Promise<string>;
  createUser(email: string, opts?: { platformAdmin?: boolean }): Promise<string>;
  /** Cria loja com dono (e opcionalmente plano), já como loja ativa do dono. */
  createStore(name: string, ownerId: string, opts?: { plan?: string; status?: 'trial' | 'active' }): Promise<string>;
  addMember(storeId: string, userId: string, role: 'OWNER' | 'MANAGER' | 'SELLER'): Promise<void>;
  close(): Promise<void>;
}

async function runAs<T>(tx: Transaction, who: Who, q: string, params?: unknown[]): Promise<T[]> {
  const role = who === 'service' ? 'service_role' : who ? 'authenticated' : 'anon';
  await tx.exec(`SET LOCAL ROLE ${role}`);
  await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`,
    [who && who !== 'service' ? who : '', role]);
  return (await tx.query<T>(q, params as any[])).rows;
}

export async function createTestDb(opts: { extra?: string[] } = {}): Promise<TestDb> {
  const db = await PGlite.create();
  await loadSchema(db, { extra: opts.extra });

  const sql = async <T>(q: string, params?: unknown[]) => (await db.query<T>(q, params as any[])).rows;
  const as = <T>(who: Who, q: string, params?: unknown[]) => db.transaction(tx => runAs<T>(tx, who, q, params));
  const fails = async (who: Who, q: string, params?: unknown[]) => {
    try {
      await as(who, q, params);
    } catch (e: any) {
      return String(e.message);
    }
    throw new Error(`era para falhar e passou: ${q}`);
  };

  const createUser = async (email: string, o: { platformAdmin?: boolean } = {}) => {
    const [u] = await sql<{ id: string }>(
      `INSERT INTO auth.users (email, email_confirmed_at, raw_user_meta_data) VALUES ($1::text, now(), jsonb_build_object('name', $1::text)) RETURNING id`,
      [email]);
    if (o.platformAdmin) await sql(`UPDATE public.profiles SET is_platform_admin = true WHERE id = $1`, [u.id]);
    return u.id;
  };

  const addMember = async (storeId: string, userId: string, role: 'OWNER' | 'MANAGER' | 'SELLER') => {
    await sql(`INSERT INTO public.store_members (store_id, user_id, role) VALUES ($1, $2, $3)`, [storeId, userId, role]);
    await sql(`UPDATE public.profiles SET active_store_id = $1 WHERE id = $2 AND active_store_id IS NULL`, [storeId, userId]);
  };

  const createStore = async (name: string, ownerId: string, o: { plan?: string; status?: 'trial' | 'active' } = {}) => {
    const status = o.status ?? 'active';
    const [s] = await sql<{ id: string }>(
      `INSERT INTO public.stores (name, created_by, status, plan, trial_ends_at, valid_until, billing_mode)
       VALUES ($1, $2, $3::text, $4::text, CASE WHEN $3::text = 'trial' THEN now() + interval '1 day' END, NULL, 'manual_contract') RETURNING id`,
      [name, ownerId, status, o.plan ?? null]);
    if (o.plan) {
      await sql(`INSERT INTO public.subscriptions (store_id, plan_id, status, price_cents)
                 SELECT $1::uuid, key, CASE WHEN $3::text = 'trial' THEN 'trialing' ELSE 'active' END, price_cents FROM public.plans WHERE key = $2::text`,
        [s.id, o.plan, status]);
    }
    await sql(`INSERT INTO public.company_settings (store_id, name) VALUES ($1, $2)`, [s.id, name]);
    await addMember(s.id, ownerId, 'OWNER');
    return s.id;
  };

  return { db, sql, as, fails, createUser, createStore, addMember, close: () => db.close() };
}

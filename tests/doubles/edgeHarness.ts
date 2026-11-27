// Executa o index.ts real da manage-users no Node, com dublês ligados ao banco local (PGlite):
//   caller = RPCs rodam como o usuário do token (RLS e checagens de admin reais);
//   admin  = Auth e Storage gravam em auth.users e storage.objects do banco local.
// Não prova: Auth/Storage reais, verify_jwt do gateway, CORS publicado e permissões do dono das funções em produção.
import type { TestDb } from '../db/harness';

export interface Faults {
  createUser?: boolean;
  deleteUser?: boolean;
  /** Bucket cujo remove falha. */
  storageError?: string;
  /** Remove responde sucesso sem apagar nada. */
  storageNoop?: boolean;
}

export async function loadManageUsers(t: TestDb) {
  const faults: Faults = {};
  const calls = { createUser: 0, deleteUser: 0, updateUser: 0, removed: [] as string[] };

  const rpcAs = (who: string) => async (name: string, params: Record<string, unknown> = {}) => {
    const keys = Object.keys(params);
    try {
      const rows = await t.as<any>(who, `SELECT * FROM public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`,
        keys.map(k => params[k] ?? null));
      const scalar = rows.length === 1 && Object.keys(rows[0]).length === 1 && name in rows[0];
      return { data: scalar ? rows[0][name] : rows, error: null };
    } catch (e: any) {
      return { data: null, error: { message: String(e.message), code: e.code } };
    }
  };

  const adminClient = {
    auth: {
      admin: {
        createUser: async (u: any) => {
          calls.createUser++;
          if (faults.createUser) return { data: { user: null }, error: { message: 'auth indisponível' } };
          try {
            const [row] = await t.sql<{ id: string }>(
              `INSERT INTO auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
               VALUES ($1, $2, now(), $3::jsonb, $4::jsonb) RETURNING id`,
              [u.email, u.password, JSON.stringify(u.user_metadata ?? {}), JSON.stringify(u.app_metadata ?? {})]);
            return { data: { user: { id: row.id } }, error: null };
          } catch (e: any) {
            return { data: { user: null }, error: { message: String(e.message) } };
          }
        },
        deleteUser: async (id: string) => {
          calls.deleteUser++;
          if (faults.deleteUser) return { error: { message: 'auth indisponível' } };
          try {
            await t.sql('DELETE FROM auth.users WHERE id = $1', [id]);
            return { error: null };
          } catch (e: any) {
            return { error: { message: String(e.message) } };
          }
        },
        updateUserById: async () => { calls.updateUser++; return { error: null }; },
      },
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (names: string[]) => {
          if (faults.storageError === bucket) return { data: null, error: { message: 'storage indisponível' } };
          if (!faults.storageNoop) {
            await t.sql('DELETE FROM storage.objects WHERE bucket_id = $1 AND name = ANY($2::text[])', [bucket, names]);
            calls.removed.push(...names.map(n => `${bucket}/${n}`));
          }
          return { data: [], error: null };
        },
      }),
    },
  };

  const g = globalThis as any;
  const env: Record<string, string> = { SUPABASE_URL: 'http://local', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  let handler!: (req: Request) => Promise<Response>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => { handler = h; } };
  g.__edgeCreateClient = (_url: string, key: string, opts: any) => {
    if (key === 'service') return adminClient;
    // No teste, o "token" é o id do usuário.
    const token = String(opts?.global?.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    return {
      auth: { getUser: async () => (token ? { data: { user: { id: token } }, error: null } : { data: { user: null }, error: {} }) },
      rpc: rpcAs(token),
    };
  };
  // import.meta.glob: o Vite carrega o index.ts (com o alias do esm.sh) e o tsc não segue para o código Deno.
  const entry = Object.values(import.meta.glob('../../supabase/functions/manage-users/index.ts'));
  await entry[0]();

  let ip = 0;
  /** Chama a função como o usuário `who` (cada chamada com um IP novo, para o limite de taxa não interferir). */
  const call = async (who: string | null, body: Record<string, unknown>) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${who}`;
    const res = await handler(new Request('http://local/manage-users', { method: 'POST', headers, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() as any };
  };

  return { call, faults, calls };
}

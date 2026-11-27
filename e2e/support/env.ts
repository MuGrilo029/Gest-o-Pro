/**
 * Modo do E2E e guardas contra banco de produção.
 *
 * - E2E_MODE=mock (padrão): Supabase falso em memória (e2e/support/supabaseMock.ts). Roda em qualquer máquina.
 * - E2E_MODE=env: contra um Supabase LOCAL ou de TESTE (E2E_SUPABASE_URL + E2E_SUPABASE_ANON_KEY),
 *   com as contas de teste em E2E_ADMIN_* e E2E_OWNER_*. Nunca contra produção.
 *
 * Guardas (decisão 54): o projeto de produção é recusado pelo ref; URL remota só com E2E_ALLOW_REMOTE_TEST=1;
 * ids de lojas reais podem ser listados em E2E_FORBIDDEN_STORE_IDS (separados por vírgula) e o teste para
 * se a conta de teste enxergar qualquer um deles.
 */

/** Ref do projeto Supabase de produção (lojas reais). */
export const PRODUCTION_PROJECT_REFS = ['yfyckreoprwfwhjadfkl'];

export type E2EMode = 'mock' | 'env';

export const e2eMode = (): E2EMode => (process.env.E2E_MODE === 'env' ? 'env' : 'mock');

export const assertSafeTarget = (url: string | undefined): string => {
  if (!url) throw new Error('E2E_MODE=env precisa de E2E_SUPABASE_URL (Supabase local ou de teste).');
  const lower = url.toLowerCase();
  if (PRODUCTION_PROJECT_REFS.some(ref => lower.includes(ref))) {
    throw new Error('E2E recusado: E2E_SUPABASE_URL aponta para o projeto de PRODUÇÃO (lojas reais).');
  }
  const host = new URL(url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  if (!local && process.env.E2E_ALLOW_REMOTE_TEST !== '1') {
    throw new Error(`E2E recusado: ${host} não é local. Para um projeto de TESTE remoto, defina E2E_ALLOW_REMOTE_TEST=1.`);
  }
  return url;
};

export const forbiddenStoreIds = (): string[] =>
  (process.env.E2E_FORBIDDEN_STORE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

export interface Account { email: string; password: string }

export const accounts = (): { admin: Account; owner: Account } => {
  if (e2eMode() === 'mock') {
    return { admin: { email: 'admin@e2e.test', password: 'senha-admin' }, owner: { email: 'dono@e2e.test', password: 'senha-dono' } };
  }
  const need = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`E2E_MODE=env precisa de ${k}.`);
    return v;
  };
  return {
    admin: { email: need('E2E_ADMIN_EMAIL'), password: need('E2E_ADMIN_PASSWORD') },
    owner: { email: need('E2E_OWNER_EMAIL'), password: need('E2E_OWNER_PASSWORD') },
  };
};

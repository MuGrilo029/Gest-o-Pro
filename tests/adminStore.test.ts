import { describe, expect, it } from 'vitest';
import { forgetRequest, requestIdFor, requestSignature } from '../lib/createStoreRequest';
import { confirmNameMatches, parseDeletionOutcome, parseDeletionPreview } from '../lib/storeDeletion';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};
const data = { storeName: 'Imperio R', ownerName: 'R', email: 'r@x.test', plan: 'inicio', mode: 'trial' as const };

describe('criar loja: chave de repetição', () => {
  it('mesmos dados reusam a chave (mesmo com espaços ou maiúsculas no e-mail) até o sucesso', () => {
    const s = memory();
    let n = 0;
    const id = () => `id-${++n}`;
    const first = requestIdFor(data, s, id);
    expect(requestIdFor({ ...data, email: ' R@X.TEST ', storeName: 'Imperio R ' }, s, id)).toBe(first);
    forgetRequest(data, s);
    expect(requestIdFor(data, s, id)).not.toBe(first);
  });

  it('dados diferentes geram outra chave; os dias só contam na loja paga', () => {
    const s = memory();
    let n = 0;
    const id = () => `id-${++n}`;
    expect(requestIdFor(data, s, id)).not.toBe(requestIdFor({ ...data, email: 'outro@x.test' }, s, id));
    expect(requestSignature({ ...data, days: 30 })).toBe(requestSignature(data));
    expect(requestSignature({ ...data, mode: 'paid', days: 30 })).not.toBe(requestSignature({ ...data, mode: 'paid', days: 60 }));
  });

  it('armazenamento corrompido não impede a criação', () => {
    const s = { getItem: () => '{quebrado', setItem: () => {} };
    expect(requestIdFor(data, s, () => 'novo')).toBe('novo');
  });
});

describe('excluir loja', () => {
  it('o nome tem de ser o exato; só os espaços das pontas são ignorados, como no servidor', () => {
    expect(confirmNameMatches('Imperio R', 'Imperio R')).toBe(true);
    expect(confirmNameMatches('  Imperio R ', 'Imperio R')).toBe(true);
    for (const t of ['imperio r', 'Imperio  R', 'Imperio', '']) expect(confirmNameMatches(t, 'Imperio R'), t).toBe(false);
    expect(confirmNameMatches('', '')).toBe(false);
  });

  it('prévia do servidor: registros, arquivos, logins e o que fica, sem linhas zeradas', () => {
    const p = parseDeletionPreview({
      store: { id: '1', name: 'Imperio R', status: 'active', deleted_at: null },
      rows: { sales: 3, quotes: 0, outra_tabela: 1 },
      storage: { products: 2, 'producao-anexos': 0 },
      logins: [
        { user_id: 'a', email: 'dono@x.test', role: 'OWNER', action: 'apagar', reason: null },
        { user_id: 'b', email: 'v@x.test', role: 'SELLER', action: 'manter', reason: 'tem_outra_loja' },
      ],
      retained: { admin_audit_logs: 4 },
      blocker: null,
    }, 'x');
    expect(p.storeName).toBe('Imperio R');
    expect(p.pending).toBe(false);
    expect(p.rows.map(i => [i.label, i.count])).toEqual([['Vendas', 3], ['outra tabela', 1]]);
    expect(p.files.map(i => i.count)).toEqual([2]);
    expect(p.logins.map(l => [l.remove, l.reason])).toEqual([[true, ''], [false, 'participa de outra loja']]);
    expect(p.retained[0].label).toBe('Registro de auditoria');
    expect(p.blocker).toBeNull();
  });

  it('resultado: só "concluida" termina; parcial informa o que sobrou, mesmo sem contagens', () => {
    expect(parseDeletionOutcome({ ok: true, status: 'concluida', logins_kept: [{ user_id: 'a' }] })).toMatchObject({ done: true, loginsKept: 1 });
    expect(parseDeletionOutcome({ ok: true, status: 'parcial', storage_remaining: 2, logins_remaining: 1, errors: ['x'] }))
      .toEqual({ done: false, filesRemaining: 2, loginsRemaining: 1, loginsKept: 0, errors: ['x'] });
    expect(parseDeletionOutcome({ ok: true, status: 'parcial', errors: [] }).done).toBe(false);
  });
});

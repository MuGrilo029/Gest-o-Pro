import { describe, expect, it } from 'vitest';
import { forgetRequest, requestIdFor, requestSignature } from '../lib/createStoreRequest';
import { confirmNameMatches, parseDeletionPreview } from '../lib/storeDeletion';

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
  it('o nome tem de ser exato', () => {
    expect(confirmNameMatches('Imperio R', 'Imperio R')).toBe(true);
    for (const t of ['imperio r', 'Imperio R ', ' Imperio R', 'Imperio', '']) expect(confirmNameMatches(t, 'Imperio R'), t).toBe(false);
    expect(confirmNameMatches('', '')).toBe(false);
  });

  it('prévia: contagens e arquivos, sem linhas zeradas; usa o nome do servidor', () => {
    const p = parseDeletionPreview({ store_name: 'Imperio R', counts: { sales: 3, quotes: 0, outra_tabela: 1 }, files: { products: 2, boletos: 1 } }, 'x');
    expect(p.storeName).toBe('Imperio R');
    expect(p.items.map(i => [i.label, i.count])).toEqual([['Vendas', 3], ['outra tabela', 1], ['Arquivos', 3]]);
    expect(parseDeletionPreview({}, 'Nome da lista')).toEqual({ storeName: 'Nome da lista', items: [] });
  });
});

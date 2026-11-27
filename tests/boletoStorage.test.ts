import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
const { BOLETO_MAX_BYTES, boletoContentType, boletoFileProblem, boletoPath, isExternalAttachment, orphanedAttachment } = await import('../lib/boletoStorage');

const STORE = '11111111-2222-4333-8444-555555555555';

describe('anexo de boleto (068)', () => {
  it('caminho na pasta da loja com nome seguro', () => {
    expect(boletoPath(STORE, 'Boleto Março (2ª via).PDF', () => 'abc')).toBe(`${STORE}/abc-Boleto_Marco_2_via_.pdf`);
    expect(() => boletoPath(null, 'a.pdf')).toThrow();
  });

  it('só PDF e imagem até 10 MB; SVG não', () => {
    expect(boletoFileProblem({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toBeNull();
    expect(boletoContentType({ name: 'foto.heic', type: '' })).toBe('image/heic');
    expect(boletoFileProblem({ name: 'x.svg', type: 'image/svg+xml', size: 10 })).toMatch(/PDF/);
    expect(boletoFileProblem({ name: 'x.pdf', type: 'text/html', size: 10 })).toMatch(/PDF/);
    expect(boletoFileProblem({ name: 'a.pdf', type: 'application/pdf', size: BOLETO_MAX_BYTES + 1 })).toMatch(/10 MB/);
  });

  it('endereço completo é anexo antigo', () => {
    expect(isExternalAttachment('https://x.test/a.pdf')).toBe(true);
    expect(isExternalAttachment(`${STORE}/a.pdf`)).toBe(false);
  });

  it('só apaga arquivo que ficou sem nenhum lançamento', () => {
    const p = `${STORE}/a.pdf`;
    const all = [{ id: '1', attachmentUrl: p }, { id: '2', attachmentUrl: '' }];
    expect(orphanedAttachment(p, `${STORE}/b.pdf`, '1', all)).toBe(p);
    expect(orphanedAttachment(p, p, '1', all)).toBeNull();
    expect(orphanedAttachment(p, null, '1', [...all, { id: '3', attachmentUrl: p }])).toBeNull();
    expect(orphanedAttachment('https://x.test/a.pdf', null, '1', all)).toBeNull();
  });
});

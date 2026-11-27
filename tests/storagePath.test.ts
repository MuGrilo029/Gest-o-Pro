import { describe, expect, it } from 'vitest';
import { fileExtension, storeFilePath } from '../lib/storagePath';

const STORE = '11111111-2222-4333-8444-555555555555';

describe('caminho no Storage (RLS por pasta da loja)', () => {
  it('sempre dentro de {store_id}/, sem espaços nem barras extras', () => {
    expect(storeFilePath(STORE, 'Foto do sofá.JPG ', '', () => 'abc')).toBe(`${STORE}/abc.jpg`);
    expect(storeFilePath(STORE, 'logo.png', 'company_logo_', () => 'abc')).toBe(`${STORE}/company_logo_abc.png`);
    expect(storeFilePath(STORE, '../../x/y', '../', () => 'abc')).toBe(`${STORE}/abc.bin`);
  });

  it('sem loja ativa válida não envia', () => {
    for (const bad of [null, undefined, '', 'legacy', 'a/b']) expect(() => storeFilePath(bad, 'a.png'), String(bad)).toThrow(/loja ativa/);
  });

  it('extensão', () => {
    expect(fileExtension('a.PDF')).toBe('pdf');
    expect(fileExtension('semextensao')).toBe('bin');
    expect(fileExtension('a.tar gz')).toBe('bin');
  });
});

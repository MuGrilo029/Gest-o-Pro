import { describe, expect, it } from 'vitest';
import { formatCpfCnpj, formatPhone } from '../components/UI';
import { getBrandInitials } from '../lib/brand';

describe('formatCpfCnpj', () => {
  it('formata CPF (11 dígitos) e parciais', () => {
    expect(formatCpfCnpj('12345678901')).toBe('123.456.789-01');
    expect(formatCpfCnpj('123')).toBe('123');
    expect(formatCpfCnpj('1234')).toBe('123.4');
    expect(formatCpfCnpj('123.456.789-01')).toBe('123.456.789-01');
  });

  it('formata CNPJ (14 dígitos) e parciais de 12 a 13 dígitos', () => {
    expect(formatCpfCnpj('12345678000195')).toBe('12.345.678/0001-95');
    expect(formatCpfCnpj('12.345.678/0001-95')).toBe('12.345.678/0001-95');
    expect(formatCpfCnpj('123456780001')).toBe('12.345.678/0001');
    expect(formatCpfCnpj('1234567800019')).toBe('12.345.678/0001-9');
  });

  it('nunca devolve undefined (regressão: CNPJ sem máscara apagava o campo)', () => {
    for (let n = 0; n <= 14; n++) {
      expect(typeof formatCpfCnpj('1234567890123456'.slice(0, n))).toBe('string');
    }
  });

  it('ignora letras e símbolos; mais de 14 dígitos é cortado', () => {
    expect(formatCpfCnpj('abc')).toBe('');
    expect(formatCpfCnpj('')).toBe('');
    expect(formatCpfCnpj('123456780001951234').length).toBeLessThanOrEqual(18);
  });
});

describe('formatPhone', () => {
  it('fixo e celular', () => {
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444');
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321');
    expect(formatPhone('')).toBe('');
  });
});

describe('getBrandInitials', () => {
  it('usa as iniciais das duas primeiras palavras, em maiúsculas', () => {
    expect(getBrandInitials('Com Stillo')).toBe('CS');
    expect(getBrandInitials('gestão pro max')).toBe('GP');
    expect(getBrandInitials('Stillo')).toBe('S');
  });

  it('palavras que começam com "s" não quebram o nome (regressão do regex /s+/)', () => {
    expect(getBrandInitials('Sapataria Sol')).toBe('SS');
  });

  it('espaços extras, nome vazio ou nulo usam o nome padrão', () => {
    expect(getBrandInitials('   Loja   Azul  ')).toBe('LA');
    expect(getBrandInitials('')).toBe('GP');
    expect(getBrandInitials(null)).toBe('GP');
    expect(getBrandInitials(undefined)).toBe('GP');
  });

  it('não parte caracteres especiais ao meio', () => {
    expect(getBrandInitials('Édna Ótica')).toBe('ÉÓ');
  });
});

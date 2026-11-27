import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMP_PASSWORD, PASSWORD_MIN_LENGTH, passwordProblem } from '../lib/utils';
import { normalizeWhatsappNumber, supportWhatsappUrl } from '../lib/support';

describe('senha (decisões 40 e 42)', () => {
  it('mínimo de 8 caracteres, sem exigir números', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(passwordProblem('abcdefgh')).toBeNull();
    expect(passwordProblem('abcdefg')).toMatch(/8 caracteres/);
    expect(passwordProblem('ABCDEFGH')).toBeNull();
  });

  it('vazio = senha provisória (quem chama decide) e a provisória padrão passa na regra', () => {
    expect(passwordProblem('')).toBeNull();
    expect(DEFAULT_TEMP_PASSWORD).toBe('12345678');
    expect(passwordProblem(DEFAULT_TEMP_PASSWORD)).toBeNull();
  });

  it('máximo de 72 caracteres (limite do bcrypt)', () => {
    expect(passwordProblem('a'.repeat(72))).toBeNull();
    expect(passwordProblem('a'.repeat(73))).toMatch(/72/);
  });
});

describe('suporte por WhatsApp (decisão 58)', () => {
  it('sem número: sem link (botão escondido)', () => {
    expect(supportWhatsappUrl(null)).toBeNull();
    expect(normalizeWhatsappNumber('')).toBeNull();
    expect(normalizeWhatsappNumber(undefined)).toBeNull();
  });

  it('número com máscara vira só dígitos; curto demais é recusado', () => {
    expect(normalizeWhatsappNumber('+55 (11) 99999-0000')).toBe('5511999990000');
    expect(normalizeWhatsappNumber('12345')).toBeNull();
  });

  it('link wa.me com mensagem', () => {
    const url = supportWhatsappUrl('5511999990000', 'Loja Teste');
    expect(url).toMatch(/^https:\/\/wa\.me\/5511999990000\?text=/);
    expect(decodeURIComponent(url!.split('text=')[1])).toContain('Loja Teste');
  });
});

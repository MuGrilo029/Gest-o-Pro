import { describe, expect, it } from 'vitest';
import { displayEmail, effectiveImpersonation, maskEmail, memberLabel } from '../lib/privacy';
import { assertCanImpersonate } from '../lib/modules';

describe('e-mail de colegas (decisão 32: mascaramento atual mantido)', () => {
  const m = { email: 'joana.silva@loja.com', name: 'Joana' };

  it('não-admin nunca recebe o e-mail completo na tela, em avisos ou aria-labels', () => {
    expect(displayEmail(m.email, false)).toBe('j***@loja.com');
    expect(displayEmail(m.email, false)).not.toContain('joana.silva');
    expect(memberLabel(m, false)).toBe('Joana');
    expect(memberLabel({ email: m.email, name: '  ' }, false)).toBe('j***@loja.com');
  });

  it('admin da plataforma vê o e-mail completo', () => {
    expect(displayEmail(m.email, true)).toBe(m.email);
    expect(memberLabel(m, true)).toBe(m.email);
  });

  it('e-mail sem @ vira só asteriscos', () => {
    expect(maskEmail('semarroba')).toBe('***');
  });
});

describe('impersonação só do dono do SaaS (decisões 33 e 36)', () => {
  const stored = { id: 'loja-1', name: 'Loja' };

  it('não-admin não abre outra loja e ignora valor salvo no navegador', () => {
    expect(() => assertCanImpersonate(false)).toThrow();
    expect(effectiveImpersonation(stored, false)).toBeNull();
  });

  it('admin abre e mantém a loja aberta', () => {
    expect(() => assertCanImpersonate(true)).not.toThrow();
    expect(effectiveImpersonation(stored, true)).toBe(stored);
  });
});

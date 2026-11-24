import { describe, expect, it } from 'vitest';
import {
  TRIAL_DURATION_MS,
  effectiveStatus,
  formatRemaining,
  hasAccess,
  secondsRemaining,
  trialEndsAt,
} from '../lib/subscription';

const t0 = new Date('2026-11-24T12:00:00.000Z');
const plus = (ms: number) => new Date(t0.getTime() + ms);
const HOUR = 3600_000;

describe('teste grátis de 3 horas', () => {
  it('dura exatamente 3 horas, com precisão de minuto e segundo', () => {
    expect(TRIAL_DURATION_MS).toBe(3 * HOUR);
    expect(trialEndsAt(t0).toISOString()).toBe('2026-11-24T15:00:00.000Z');
    expect(trialEndsAt(t0, 0.5).toISOString()).toBe('2026-11-24T12:30:00.000Z');
  });

  it('libera acesso até o último segundo e bloqueia no instante do vencimento', () => {
    const end = trialEndsAt(t0);
    const store = { isActiveStore: true, status: 'trial' as const, trialEnd: end, validUntil: null };
    expect(hasAccess(store, t0)).toBe(true);
    expect(hasAccess(store, new Date(end.getTime() - 1000))).toBe(true);
    expect(hasAccess(store, end)).toBe(false); // trial_ends_at <= now() => expirado
    expect(hasAccess(store, new Date(end.getTime() + 1))).toBe(false);
  });

  it('trial sem data de fim é tratado como expirado (falha fechada)', () => {
    expect(effectiveStatus('trial', null, null, t0)).toBe('expired');
  });

  it('contagem regressiva em segundos nunca fica negativa', () => {
    const end = trialEndsAt(t0);
    expect(secondsRemaining('trial', end, null, t0)).toBe(10800);
    expect(secondsRemaining('trial', end, null, plus(2 * HOUR + 59 * 60_000 + 30_000))).toBe(30);
    expect(secondsRemaining('trial', end, null, plus(5 * HOUR))).toBe(0);
  });
});

describe('status efetivo e assinatura paga', () => {
  it('ativo sem prazo (validade nula) nunca expira', () => {
    expect(effectiveStatus('active', null, null, plus(1000 * HOUR))).toBe('active');
    expect(secondsRemaining('active', null, null, t0)).toBeNull();
  });

  it('ativo com validade vencida vira expirado; vigente continua ativo', () => {
    expect(effectiveStatus('active', null, plus(HOUR), t0)).toBe('active');
    expect(effectiveStatus('active', null, plus(HOUR), plus(HOUR))).toBe('expired');
    expect(effectiveStatus('active', null, plus(HOUR), plus(2 * HOUR))).toBe('expired');
  });

  it('suspensa e expirada continuam bloqueadas mesmo com data futura', () => {
    expect(effectiveStatus('suspended', plus(HOUR), plus(HOUR), t0)).toBe('suspended');
    expect(effectiveStatus('expired', plus(HOUR), plus(HOUR), t0)).toBe('expired');
    for (const status of ['suspended', 'expired'] as const) {
      expect(hasAccess({ isActiveStore: true, status, trialEnd: plus(HOUR), validUntil: plus(HOUR) }, t0)).toBe(false);
    }
  });

  it('loja desativada (is_active = false) bloqueia mesmo com plano vigente', () => {
    expect(hasAccess({ isActiveStore: false, status: 'active', trialEnd: null, validUntil: plus(HOUR) }, t0)).toBe(false);
  });

  it('administrador da plataforma nunca é bloqueado', () => {
    expect(hasAccess({ isActiveStore: false, status: 'expired', trialEnd: null, validUntil: null, isPlatformAdmin: true }, t0)).toBe(true);
  });

  it('relógio do aparelho atrasado não estende o teste: o servidor decide por seconds_remaining', () => {
    // O app usa seconds_remaining do servidor; aqui só garantimos que a conta é feita sobre o "agora" informado.
    const end = trialEndsAt(t0);
    expect(secondsRemaining('trial', end, null, plus(-24 * HOUR))).toBe(24 * 3600 + 10800);
  });
});

describe('formatRemaining', () => {
  it.each([
    [0, '0min 00s'],
    [-5000, '0min 00s'],
    [59_000, '0min 59s'],
    [61_000, '1min 01s'],
    [3600_000, '1h 00min'],
    [2 * HOUR + 5 * 60_000, '2h 05min'],
    [3 * HOUR, '3h 00min'],
    [26 * HOUR, '1d 2h'],
  ])('%i ms => %s', (ms, expected) => {
    expect(formatRemaining(ms)).toBe(expected);
  });
});

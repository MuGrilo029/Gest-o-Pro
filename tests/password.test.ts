import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMP_PASSWORD, passwordProblem } from '../lib/utils';

describe('política de senha (decisão 42)', () => {
  it('mínimo 8, sem exigir números', () => {
    expect(passwordProblem('abcdefg')).toMatch(/8 caracteres/);
    expect(passwordProblem('abcdefgh')).toBeNull();
    expect(passwordProblem('a'.repeat(73))).toMatch(/72/);
  });
  it('senha provisória padrão do admin passa na regra', () => {
    expect(DEFAULT_TEMP_PASSWORD).toBe('12345678');
    expect(passwordProblem(DEFAULT_TEMP_PASSWORD)).toBeNull();
  });
});

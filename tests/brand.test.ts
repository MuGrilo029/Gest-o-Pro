import { describe, it, expect } from 'vitest';
import { normalizeHex, buildBrandPalette, DEFAULT_BRAND_COLOR } from '../lib/brand';

describe('cor da marca', () => {
  it('normaliza hex válido e recusa inválido', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex(' #1a2b3c ')).toBe('#1a2b3c');
    expect(normalizeHex('azul')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });

  it('gera a escala completa com 700 igual à cor escolhida', () => {
    const p = buildBrandPalette('#0a6cff')!;
    expect(Object.keys(p)).toHaveLength(11);
    expect(p[700]).toBe('10 108 255');
    const lum = (s: string) => s.split(' ').map(Number).reduce((a, b) => a + b, 0);
    expect(lum(p[50])).toBeGreaterThan(lum(p[500]));
    expect(lum(p[500])).toBeGreaterThan(lum(p[900]));
    expect(lum(p[900])).toBeGreaterThan(lum(p[950]));
  });

  it('devolve null para cor inválida', () => {
    expect(buildBrandPalette('xyz')).toBeNull();
  });

  it('cor padrão do sistema é válida e igual ao indigo-700 do index.css', () => {
    expect(normalizeHex(DEFAULT_BRAND_COLOR)).toBe(DEFAULT_BRAND_COLOR);
    expect(buildBrandPalette(DEFAULT_BRAND_COLOR)![700]).toBe('79 70 229');
  });
});

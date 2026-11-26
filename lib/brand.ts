/** Iniciais (até 2 letras) do nome da loja, usadas no logotipo do app mobile. */
export const getBrandInitials = (name: string | null | undefined, fallback = 'Gestão Pro'): string => {
  const base = (name || '').trim() || fallback;
  return base
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => Array.from(word)[0])
    .join('')
    .toUpperCase();
};

// ---------------------------------------------------------------------------
// Cor da marca por loja
// ---------------------------------------------------------------------------
// A escala `wine`/`primary` do Tailwind lê as variáveis CSS --brand-50..950
// (padrão em index.css). Cada loja pode definir uma cor principal; aqui ela é
// convertida em toda a escala. Sem cor (ou cor inválida) vale a paleta padrão.

export const BRAND_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/**
 * Cor padrão do sistema para lojas sem cor própria (sem linha `brand` em store_modules).
 * É o indigo-700 da paleta em index.css, então lojas sem cor continuam com a mesma aparência.
 */
export const DEFAULT_BRAND_COLOR = '#4f46e5';

/** Aceita #rgb ou #rrggbb; devolve #rrggbb minúsculo ou null. */
export const normalizeHex = (value: string | null | undefined): string | null => {
  const v = (value || '').trim().toLowerCase();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
};

const toRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const mix = (from: [number, number, number], to: [number, number, number], t: number): [number, number, number] =>
  [0, 1, 2].map(i => Math.round(from[i] + (to[i] - from[i]) * t)) as [number, number, number];

/** A cor escolhida vira o tom 700 (botões/realces); claros misturam com branco, escuros com preto. */
export const buildBrandPalette = (hex: string): Record<number, string> | null => {
  const clean = normalizeHex(hex);
  if (!clean) return null;
  const base = toRgb(clean);
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];
  const steps: Record<number, [number, number, number]> = {
    50: mix(base, white, 0.95),
    100: mix(base, white, 0.9),
    200: mix(base, white, 0.8),
    300: mix(base, white, 0.65),
    400: mix(base, white, 0.45),
    500: mix(base, white, 0.25),
    600: mix(base, white, 0.1),
    700: base,
    800: mix(base, black, 0.15),
    900: mix(base, black, 0.4),
    950: mix(base, black, 0.65),
  };
  const out: Record<number, string> = {};
  for (const s of BRAND_SHADES) out[s] = steps[s].join(' ');
  return out;
};

/** Aplica a cor da loja na página; null/inválida volta ao padrão. */
export const applyBrandColor = (hex: string | null | undefined): void => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const palette = hex ? buildBrandPalette(hex) : null;
  for (const s of BRAND_SHADES) {
    if (palette) root.style.setProperty(`--brand-${s}`, palette[s]);
    else root.style.removeProperty(`--brand-${s}`);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && palette) meta.setAttribute('content', `rgb(${palette[900]})`.replace(/ /g, ','));
};

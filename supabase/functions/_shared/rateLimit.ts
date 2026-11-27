// Limitador de taxa em memória para Edge Functions.
// Stateless por instância: protege contra abuso em uma mesma instância Deno.
// Para limites globais, combine com rate limiting no gateway/Cloudflare.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Remove buckets expirados periodicamente. */
const cleanup = () => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
};

/**
 * Verifica e consome uma unidade do limite.
 * @returns true se permitido, false se excedeu.
 */
export const allow = (key: string, limit: number, windowMs: number): boolean => {
  cleanup();
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
};

/** Chave por IP + rota (fallback quando não há usuário). */
export const clientKey = (req: Request, route: string): string => {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip')
    || 'unknown';
  return `${route}:${ip}`;
};
// Dublê do '@supabase/supabase-js' das Edge Functions: o teste registra a fábrica (ver edgeHarness.ts).
export const createClient = (url: string, key: string, opts?: unknown) =>
  (globalThis as any).__edgeCreateClient(url, key, opts);

// CORS restrito por lista de origens permitidas.
//
// Configure no Supabase (Edge Functions > Secrets):
//   ALLOWED_ORIGINS=https://seu-sistema.vercel.app,https://app.seudominio.com.br
//
// Sem a variável, só origens de desenvolvimento local são aceitas (fallback
// seguro: produção falha fechada em vez de abrir para "*").

const DEV_FALLBACK = ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];

const allowedOrigins = (): string[] => {
  const raw = Deno.env.get('ALLOWED_ORIGINS');
  const list = (raw || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter((o) => o && o !== '*');
  return list.length ? list : DEV_FALLBACK;
};

/** Cabeçalhos CORS para a origem da requisição; sem origem permitida, não libera nada. */
export const buildCorsHeaders = (req: Request, methods = 'POST, OPTIONS'): Record<string, string> => {
  const origin = (req.headers.get('Origin') || '').replace(/\/$/, '');
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': methods,
  };
  if (origin && allowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
};

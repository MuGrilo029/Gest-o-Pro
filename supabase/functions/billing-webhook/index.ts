// Edge Function: billing-webhook
//
// Recebe eventos de cobrança do gateway e aplica no banco pela RPC process_billing_event
// (idempotente pelo id do evento). Não há chave no código.
//
// Segredos (Supabase > Edge Functions > Secrets):
//   BILLING_WEBHOOK_TOKEN   token que o gateway envia no cabeçalho x-billing-token
//   BILLING_GRACE_DAYS      carência em dias para atraso (padrão 5)
//   SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados pelo Supabase.
//
// Regras:
//   - Token comparado em tempo constante. Sem o segredo configurado, a função recusa tudo (fail closed).
//   - Só POST. Payload mínimo: não registra o corpo bruto nem o token.
//   - Resposta rápida: o banco aplica o evento na mesma chamada e devolve 200 com o resultado.
//   - Evento repetido responde 200 com status "duplicado" (o gateway não reenvia por erro).
//
// Formato normalizado esperado (o mapeamento do payload do gateway escolhido fica em TODO abaixo):
//   { "id": "evt_...", "type": "confirmed|late|canceled|refunded", "store_id": "uuid",
//     "plan_key": "inicio|crescimento|avancado", "period_end": "ISO-8601",
//     "gateway_subscription_id": "opcional" }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TOKEN = Deno.env.get('BILLING_WEBHOOK_TOKEN') || '';
const GRACE_DAYS = Math.max(0, Number(Deno.env.get('BILLING_GRACE_DAYS') ?? '5') || 5);

const TYPES = ['confirmed', 'late', 'canceled', 'refunded'] as const;
const PLANS = ['inicio', 'crescimento', 'avancado'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comparação em tempo constante (tamanho e conteúdo). */
const safeEqual = (a: string, b: string): boolean => {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  // Sem segredo configurado: recusa tudo.
  if (!TOKEN) return json({ error: 'Webhook não configurado.' }, 503);

  const received = req.headers.get('x-billing-token') || '';
  if (!safeEqual(received, TOKEN)) return json({ error: 'Não autorizado.' }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Requisição inválida.' }, 400);
  }

  // Validação do payload normalizado (TODO: mapear o payload do gateway escolhido para este formato)
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  const type = typeof body?.type === 'string' ? body.type : '';
  const storeId = typeof body?.store_id === 'string' ? body.store_id : '';
  const planKey = typeof body?.plan_key === 'string' ? body.plan_key : '';
  const periodEnd = typeof body?.period_end === 'string' ? body.period_end : null;
  const gatewaySub = typeof body?.gateway_subscription_id === 'string' ? body.gateway_subscription_id.slice(0, 120) : null;

  if (!id || id.length > 128) return json({ error: 'Evento sem id válido.' }, 400);
  if (!(TYPES as readonly string[]).includes(type)) return json({ error: 'Tipo de evento inválido.' }, 400);
  if (!UUID_RE.test(storeId)) return json({ error: 'Loja inválida.' }, 400);
  if (type !== 'canceled' && type !== 'refunded' && !(PLANS as readonly string[]).includes(planKey)) {
    return json({ error: 'Plano inválido.' }, 400);
  }
  if ((type === 'confirmed' || type === 'late') && (!periodEnd || Number.isNaN(Date.parse(periodEnd)))) {
    return json({ error: 'Vencimento inválido.' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('process_billing_event', {
    p_event_id: id,
    p_type: type,
    p_store: storeId,
    p_plan: planKey || 'inicio',
    p_period_end: periodEnd,
    p_grace_days: GRACE_DAYS,
    p_gateway_subscription: gatewaySub,
  });

  if (error) {
    // Sem detalhes internos na resposta; o erro fica só no log do Supabase.
    console.error('billing-webhook: falha ao aplicar evento', id, error.code ?? '');
    return json({ error: 'Não foi possível aplicar o evento.' }, 500);
  }
  return json({ status: data });
});

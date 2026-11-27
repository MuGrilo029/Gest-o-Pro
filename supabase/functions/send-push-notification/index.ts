// Edge Function: send-push-notification
//
// Envia push SOMENTE para o DONO (OWNER) da loja do evento (decisão 28 do dono).
//
// Eventos (campo "type" do corpo; padrão "sale"):
//   sale          nova venda            record.id = sales.id
//   low_stock     estoque baixo         record.id = products.id
//   overdue_bill  conta vencida         record.id = transactions.id
//
// Dois chamadores aceitos:
//   1. Gatilho/job do banco (migração 054): cabeçalho x-webhook-secret igual a PUSH_WEBHOOK_SECRET.
//      O registro é relido do banco pelo id; o corpo nunca é confiado (nome, valor e loja vêm da tabela).
//   2. App (usuário logado, só "sale"): Authorization = JWT. A venda é lida com a identidade dele (RLS),
//      então só funciona para vendas da loja ativa dele.
//
// Segredos (Supabase > Edge Functions > Secrets): VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET, ALLOWED_ORIGINS.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import webpush from 'https://esm.sh/web-push@3.6.7';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { allow, clientKey } from '../_shared/rateLimit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') || '';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@comstillo.com.br',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_TYPES = ['sale', 'low_stock', 'overdue_bill'] as const;
type EventType = typeof EVENT_TYPES[number];

/** Comparação em tempo constante para o segredo do webhook. */
const safeEqual = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const clean = (v: unknown, max = 60) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);
const brl = (v: unknown) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface PushContent { storeId: string; title: string; body: string; url: string; tag: string }

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return respond({ error: 'Método não permitido.' }, 405);

  if (!allow(clientKey(req, 'send-push'), 30, 60_000)) {
    return respond({ error: 'Muitas requisições. Tente novamente em instantes.' }, 429);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return respond({ error: 'Requisição inválida.' }, 400);
    }

    const type: EventType = EVENT_TYPES.includes(body?.type) ? body.type : 'sale';
    const rawId = body?.record?.id ?? body?.saleData?.saleId ?? body?.saleData?.id ?? body?.saleId;
    const recordId = typeof rawId === 'string' ? rawId : '';
    if (!UUID_RE.test(recordId)) return respond({ error: 'Registro não informado.' }, 400);

    const fromDb = safeEqual(req.headers.get('x-webhook-secret') || '', WEBHOOK_SECRET);

    // --- 1. Autenticação do chamador e leitura do registro ------------------
    let content: PushContent | null = null;

    if (type === 'sale') {
      let sale: { id: string; store_id: string; customer_name: string | null; total: number | null } | null = null;
      if (fromDb) {
        const { data } = await admin.from('sales').select('id, store_id, customer_name, total').eq('id', recordId).maybeSingle();
        sale = data;
      } else {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return respond({ error: 'Faça login novamente.' }, 401);
        const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
          auth: { persistSession: false },
        });
        const { data: userData, error: userError } = await caller.auth.getUser();
        if (userError || !userData?.user) return respond({ error: 'Faça login novamente.' }, 401);
        const { data } = await caller.from('sales').select('id, store_id, customer_name, total').eq('id', recordId).maybeSingle();
        sale = data;
      }
      if (sale?.store_id) {
        content = {
          storeId: sale.store_id,
          title: `${clean(sale.customer_name || 'Cliente')} • Nova Venda`,
          body: `Venda no valor de ${brl(sale.total)} registrada com sucesso!`,
          url: '/',
          tag: `sale-${sale.id}`,
        };
      }
    } else {
      // Estoque baixo e conta vencida só chegam pelo banco.
      if (!fromDb) return respond({ error: 'Evento não permitido.' }, 403);
      if (type === 'low_stock') {
        const { data: p } = await admin.from('products').select('id, store_id, name, quantity, min_stock').eq('id', recordId).maybeSingle();
        if (p?.store_id) {
          content = {
            storeId: p.store_id,
            title: 'Estoque baixo',
            body: `${clean(p.name, 80)}: ${p.quantity ?? 0} em estoque (mínimo ${p.min_stock ?? 0}).`,
            url: '/',
            tag: `low_stock-${p.id}`,
          };
        }
      } else {
        const { data: t } = await admin.from('transactions').select('id, store_id, description, amount, due_date, status').eq('id', recordId).maybeSingle();
        if (t?.store_id && t.status !== 'PAID') {
          content = {
            storeId: t.store_id,
            title: 'Conta vencida',
            body: `${clean(t.description, 80)} — ${brl(t.amount)} venceu em ${String(t.due_date ?? '').split('-').reverse().join('/')}.`,
            url: '/',
            tag: `overdue_bill-${t.id}`,
          };
        }
      }
    }

    // Mesma resposta para "não existe" e "não é da sua loja": sem enumeração.
    if (!content) return respond({ error: 'Registro não encontrado.' }, 404);

    // --- 2. Destinatário: só o dono da loja ---------------------------------
    const { data: owners, error: ownerError } = await admin
      .from('store_members').select('user_id').eq('store_id', content.storeId).eq('role', 'OWNER');
    if (ownerError) throw ownerError;
    const recipientIds = (owners || []).map((m: any) => m.user_id as string);
    if (recipientIds.length === 0) return respond({ message: 'Loja sem dono cadastrado.', total: 0, sent: 0, failed: 0 });

    const { data: subscriptions, error: subError } = await admin
      .from('push_subscriptions').select('endpoint, p256dh, auth').in('user_id', recipientIds);
    if (subError) throw subError;
    if (!subscriptions?.length) return respond({ message: 'Nenhuma inscrição push encontrada.', total: 0, sent: 0, failed: 0 });

    // --- 3. Conteúdo vindo do banco, nunca do corpo da requisição ----------
    const pushPayload = JSON.stringify({
      title: content.title,
      body: content.body,
      icon: '/app-icon.jpg',
      badge: '/app-icon.jpg',
      tag: content.tag,
      metadata: { type, id: recordId, url: content.url },
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub: any) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, pushPayload);
        } catch (err: any) {
          // 410/404: inscrição revogada ou expirada.
          if (err.statusCode === 410 || err.statusCode === 404) {
            await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
          throw err;
        }
      }),
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    return respond({ success: true, type, total: subscriptions.length, sent, failed: subscriptions.length - sent });
  } catch (error) {
    console.error('Erro na Edge Function send-push-notification:', error);
    // Não devolve detalhes internos ao cliente.
    return respond({ error: 'Erro ao enviar notificações.' }, 500);
  }
});

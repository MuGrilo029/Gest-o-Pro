// Edge Function: send-push-notification
//
// Envia push de "nova venda" SOMENTE para quem pertence à loja da venda.
//
// Dois chamadores aceitos:
//   1. App (usuário logado): Authorization = JWT do usuário. A venda é lida com a
//      identidade dele (RLS), então só funciona para vendas da loja ativa dele.
//   2. Gatilho do banco (webhook): cabeçalho x-webhook-secret igual ao segredo
//      PUSH_WEBHOOK_SECRET. A venda é relida do banco pelo id; o corpo enviado
//      nunca é confiado (nome, valor e loja vêm sempre da tabela sales).
//
// Destinatários: dono e gerente da loja + quem criou a venda. Vendedores não
// recebem vendas de colegas (o RLS já esconde essas vendas deles).
//
// Segredos (Supabase > Edge Functions > Secrets): VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET, ALLOWED_ORIGINS.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import webpush from 'https://esm.sh/web-push@3.6.7';
import { buildCorsHeaders } from '../_shared/cors.ts';

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

/** Comparação em tempo constante para o segredo do webhook. */
const safeEqual = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return respond({ error: 'Método não permitido.' }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return respond({ error: 'Requisição inválida.' }, 400);
    }

    const rawId = body?.record?.id ?? body?.saleData?.saleId ?? body?.saleData?.id ?? body?.saleId;
    const saleId = typeof rawId === 'string' ? rawId : '';
    if (!UUID_RE.test(saleId)) return respond({ error: 'Venda não informada.' }, 400);

    // --- 1. Autenticação do chamador ---------------------------------------
    let sale: { id: string; store_id: string; customer_name: string | null; total: number | null; created_by: string | null } | null = null;

    if (safeEqual(req.headers.get('x-webhook-secret') || '', WEBHOOK_SECRET)) {
      // Gatilho do banco: relê a venda com service_role pelo id.
      const { data } = await admin
        .from('sales').select('id, store_id, customer_name, total, created_by').eq('id', saleId).maybeSingle();
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

      // Leitura com a identidade do usuário: o RLS só devolve vendas da loja
      // ativa dele (e, para vendedor, só as próprias). É o vínculo com a loja.
      const { data } = await caller
        .from('sales').select('id, store_id, customer_name, total, created_by').eq('id', saleId).maybeSingle();
      sale = data;
    }

    // Mesma resposta para "não existe" e "não é da sua loja": sem enumeração.
    if (!sale?.store_id) return respond({ error: 'Venda não encontrada.' }, 404);

    // --- 2. Destinatários: só da loja da venda -----------------------------
    const { data: members, error: memberError } = await admin
      .from('store_members').select('user_id, role').eq('store_id', sale.store_id);
    if (memberError) throw memberError;

    const recipientIds = new Set<string>();
    for (const m of members || []) {
      if (m.role === 'OWNER' || m.role === 'MANAGER') recipientIds.add(m.user_id);
    }
    if (sale.created_by && (members || []).some((m: any) => m.user_id === sale!.created_by)) {
      recipientIds.add(sale.created_by);
    }
    if (recipientIds.size === 0) return respond({ message: 'Nenhum destinatário nesta loja.', total: 0, sent: 0, failed: 0 });

    const { data: subscriptions, error: subError } = await admin
      .from('push_subscriptions').select('endpoint, p256dh, auth').in('user_id', [...recipientIds]);
    if (subError) throw subError;
    if (!subscriptions?.length) return respond({ message: 'Nenhuma inscrição push encontrada.', total: 0, sent: 0, failed: 0 });

    // --- 3. Conteúdo vindo do banco, nunca do corpo da requisição ----------
    const valorFormatado = Number(sale.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const clienteNome = String(sale.customer_name || 'Cliente').replace(/[\r\n]+/g, ' ').slice(0, 60);
    const pushPayload = JSON.stringify({
      title: `${clienteNome} • Nova Venda`,
      body: `Venda no valor de ${valorFormatado} registrada com sucesso!`,
      icon: '/app-icon.jpg',
      badge: '/app-icon.jpg',
      metadata: { saleId: sale.id, url: '/' },
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
    return respond({ success: true, total: subscriptions.length, sent, failed: subscriptions.length - sent });
  } catch (error) {
    console.error('Erro na Edge Function send-push-notification:', error);
    // Não devolve detalhes internos ao cliente.
    return respond({ error: 'Erro ao enviar notificações.' }, 500);
  }
});

/**
 * Exclusão de loja (pedido do dono de 27/11): só o admin da plataforma, com prévia e nome exato.
 * Formatos conforme a manage-users (delete_store_preview / delete_store, migração 066).
 */

/**
 * Regra do dono (27/11, atualizada): todos os logins da loja são apagados, mesmo que o login também
 * seja dono de outra loja; o aceite dos Termos vai junto. O servidor pode mandar um aviso listando as
 * lojas que ficarão sem dono (em vez de "logins mantidos").
 */
export const LOGIN_DELETION_TEXT = 'Todos os logins da loja serão apagados, inclusive os de quem também é dono de outra loja. O aceite dos Termos vai junto.';

/**
 * Confirmação: o nome digitado tem de ser o nome exato da loja. Como no servidor, só os espaços
 * do começo e do fim são ignorados.
 */
export const confirmNameMatches = (typed: string, storeName: string): boolean =>
  !!storeName.trim() && typed.trim() === storeName.trim();

const LABELS: Record<string, string> = {
  sales: 'Vendas', sale_items: 'Itens de venda', products: 'Produtos', customers: 'Clientes', suppliers: 'Fornecedores',
  transactions: 'Lançamentos financeiros', quotes: 'Orçamentos', quote_items: 'Itens de orçamento', orders: 'Encomendas',
  production_orders: 'Ordens de produção', deliveries: 'Entregas', stock_movements: 'Movimentos de estoque',
  categories: 'Categorias', category_groups: 'Grupos de categorias', card_fees: 'Taxas de cartão',
  store_members: 'Pessoas da equipe', store_modules: 'Módulos da loja', store_module_overrides: 'Ajustes de módulos',
  subscriptions: 'Assinatura', subscription_payments: 'Pagamentos', invoices: 'Faturas',
  company_settings: 'Dados da empresa', push_subscriptions: 'Aparelhos com notificação', warehouses: 'Depósitos',
  stock_balances: 'Saldos por depósito', simulations: 'Simulações', terms_acceptances: 'Aceites dos Termos',
  admin_audit_logs: 'Registro de auditoria',
};
const BUCKETS: Record<string, string> = { products: 'Imagens (produtos, orçamentos e logo)', 'producao-anexos': 'Anexos de produção', boletos: 'Anexos de boleto' };

export const deletionLabel = (key: string): string => LABELS[key] ?? key.replace(/_/g, ' ');

export interface CountLine { key: string; label: string; count: number }
export interface PreviewLogin { userId: string; email: string; role: string }

export interface DeletionPreview {
  /** Nome da loja como o servidor o conhece (é o que precisa ser digitado). */
  storeName: string;
  /** true: a exclusão já começou e falta concluir. */
  pending: boolean;
  rows: CountLine[];
  files: CountLine[];
  logins: PreviewLogin[];
  retained: CountLine[];
  /** Motivo que impede excluir (o botão fica desabilitado). */
  blocker: string | null;
  /** Aviso do servidor: lojas que ficarão sem dono (login apagado mesmo sendo dono de outra loja). */
  warning: string | null;
}

const lines = (map: unknown, label: (k: string) => string): CountLine[] =>
  Object.entries((map && typeof map === 'object' ? map : {}) as Record<string, unknown>)
    .map(([key, v]) => ({ key, label: label(key), count: Number(v) }))
    .filter(l => Number.isFinite(l.count) && l.count > 0);

/** Lê `preview` da resposta. Linhas com zero não aparecem. */
export const parseDeletionPreview = (preview: any, fallbackName: string): DeletionPreview => ({
  storeName: String(preview?.store?.name ?? fallbackName),
  pending: !!preview?.store?.deleted_at,
  rows: lines(preview?.rows, deletionLabel),
  files: lines(preview?.storage, k => BUCKETS[k] ?? k),
  logins: (Array.isArray(preview?.logins) ? preview.logins : []).map((l: any) => ({
    userId: String(l.user_id),
    email: String(l.email ?? ''),
    role: String(l.role ?? ''),
  })),
  retained: lines(preview?.retained, deletionLabel),
  blocker: preview?.blocker ? String(preview.blocker) : null,
  warning: (() => {
    if (preview?.warning) return String(preview.warning);
    const stores = Array.isArray(preview?.stores_without_owner) ? preview.stores_without_owner : [];
    if (stores.length) return `As seguintes lojas ficarão sem dono: ${stores.join(', ')}.`;
    return null;
  })(),
});

export interface DeletionOutcome {
  /** 'parcial': o banco já foi apagado, mas sobraram arquivos ou logins; repetir a mesma chamada. */
  done: boolean;
  filesRemaining: number;
  loginsRemaining: number;
  loginsKept: number;
  errors: string[];
}

const count = (v: unknown): number => {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).reduce<number>((a, b) => a + (Number(b) || 0), 0);
  return Number(v) || 0;
};

/** Lê a resposta de delete_store. Só 'concluida' conta como terminada. */
export const parseDeletionOutcome = (data: any): DeletionOutcome => ({
  done: data?.status === 'concluida',
  filesRemaining: count(data?.storage_remaining),
  loginsRemaining: count(data?.logins_remaining),
  loginsKept: count(data?.logins_kept),
  errors: Array.isArray(data?.errors) ? data.errors.map(String) : [],
});

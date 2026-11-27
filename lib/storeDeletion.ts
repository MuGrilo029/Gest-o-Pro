/**
 * Exclusão de loja (pedido do dono de 27/11): só o admin da plataforma, com prévia e nome exato.
 * Formatos conforme a manage-users (delete_store_preview / delete_store, migração 066).
 */

/**
 * Destino dos logins. A regra é aplicada no banco (a prévia diz, login a login, o que será apagado ou
 * mantido); este é só o texto explicativo. O dono ainda não confirmou a regra recomendada: quando
 * responder, troque LOGIN_DELETION_POLICY para o texto bater com o banco.
 */
export type LoginDeletionPolicy = 'exclusive_only' | 'keep_all';
export const LOGIN_DELETION_POLICY: LoginDeletionPolicy = 'exclusive_only';

export const LOGIN_DELETION_TEXT: Record<LoginDeletionPolicy, string> = {
  exclusive_only: 'Os logins que existem somente nesta loja são apagados. Quem também participa de outra loja mantém o login.',
  keep_all: 'Os logins das pessoas são mantidos; elas perdem o acesso a esta loja.',
};

const KEEP_REASON: Record<string, string> = {
  admin_da_plataforma: 'é administrador da plataforma',
  tem_outra_loja: 'participa de outra loja',
  autor_no_log_de_auditoria: 'aparece no registro de auditoria',
};
export const keepReasonLabel = (reason: string | null | undefined): string =>
  reason ? KEEP_REASON[reason] ?? reason.replace(/_/g, ' ') : '';

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
const BUCKETS: Record<string, string> = { products: 'Imagens (produtos, orçamentos e logo)', 'producao-anexos': 'Anexos de produção' };

export const deletionLabel = (key: string): string => LABELS[key] ?? key.replace(/_/g, ' ');

export interface CountLine { key: string; label: string; count: number }
export interface PreviewLogin { userId: string; email: string; role: string; remove: boolean; reason: string }

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
    remove: l.action === 'apagar',
    reason: keepReasonLabel(l.reason),
  })),
  retained: lines(preview?.retained, deletionLabel),
  blocker: preview?.blocker ? String(preview.blocker) : null,
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

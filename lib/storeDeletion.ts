/**
 * Exclusão de loja (pedido do dono de 27/11): só o admin da plataforma, com prévia e nome exato.
 */

/**
 * Destino dos logins. O dono ainda não respondeu; o recomendado (e o texto atual) é apagar só os
 * logins que existem apenas na loja excluída. A regra é aplicada no banco: quando a resposta chegar,
 * troque LOGIN_DELETION_POLICY para o texto bater com ela.
 */
export type LoginDeletionPolicy = 'exclusive_only' | 'keep_all';
export const LOGIN_DELETION_POLICY: LoginDeletionPolicy = 'exclusive_only';

export const LOGIN_DELETION_TEXT: Record<LoginDeletionPolicy, string> = {
  exclusive_only: 'Os logins que existem somente nesta loja são apagados. Quem também participa de outra loja mantém o login.',
  keep_all: 'Os logins das pessoas são mantidos; elas perdem o acesso a esta loja.',
};

/** Confirmação: o texto digitado tem de ser exatamente o nome da loja. */
export const confirmNameMatches = (typed: string, storeName: string): boolean => !!storeName && typed === storeName;

const LABELS: Record<string, string> = {
  sales: 'Vendas', sale_items: 'Itens de venda', products: 'Produtos', customers: 'Clientes', suppliers: 'Fornecedores',
  transactions: 'Lançamentos financeiros', quotes: 'Orçamentos', quote_items: 'Itens de orçamento', orders: 'Encomendas',
  production_orders: 'Ordens de produção', deliveries: 'Entregas', stock_movements: 'Movimentos de estoque',
  categories: 'Categorias', category_groups: 'Grupos de categorias', card_fees: 'Taxas de cartão',
  store_members: 'Pessoas da equipe', subscriptions: 'Assinatura', subscription_payments: 'Pagamentos',
  company_settings: 'Dados da empresa', push_subscriptions: 'Aparelhos com notificação', warehouses: 'Depósitos',
  stock_balances: 'Saldos por depósito', simulations: 'Simulações', files: 'Arquivos', logins: 'Logins apagados',
};

export const deletionLabel = (key: string): string => LABELS[key] ?? key.replace(/_/g, ' ');

export interface DeletionPreview {
  /** Nome da loja como o servidor o conhece (é o que precisa ser digitado). */
  storeName: string;
  items: { key: string; label: string; count: number }[];
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Lê a prévia do servidor: contagens por tabela e arquivos. Linhas com zero não aparecem. */
export const parseDeletionPreview = (data: any, fallbackName: string): DeletionPreview => {
  const counts: Record<string, unknown> = { ...(data?.counts ?? {}) };
  const files = data?.files;
  if (isCount(files)) counts.files = files;
  else if (Array.isArray(files)) counts.files = files.length;
  else if (files && typeof files === 'object') counts.files = Object.values(files).filter(isCount).reduce((a, b) => a + b, 0);
  if (isCount(data?.logins_to_delete)) counts.logins = data.logins_to_delete;
  const items = Object.entries(counts)
    .filter((e): e is [string, number] => isCount(e[1]) && e[1] > 0)
    .map(([key, count]) => ({ key, label: deletionLabel(key), count }));
  return { storeName: String(data?.store_name ?? data?.store?.name ?? fallbackName), items };
};

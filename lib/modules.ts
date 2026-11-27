import { AppView } from '../types';

/**
 * Registro central de módulos.
 *
 * Para criar um módulo novo:
 *   1. Adicione a chave em ModuleKey.
 *   2. Declare o módulo em MODULES (telas, dependências, papéis).
 *   3. Na página/rotina que depende dele, use isModuleEnabled('chave').
 *
 * Um módulo desligado some do menu, suas telas ficam bloqueadas e as
 * automações que ele dispara (ex.: venda -> entrega) não rodam.
 * Módulos "core" não podem ser desligados.
 */

export type ModuleKey =
  | 'dashboard'
  | 'sales'
  | 'customers'
  | 'inventory'
  | 'settings'
  | 'reports'
  | 'quotes'
  | 'financial'
  | 'boletos'
  | 'suppliers'
  | 'orders'
  | 'production'
  | 'custom_production'
  | 'deliveries'
  | 'push_notifications';

export type StoreRole = 'OWNER' | 'MANAGER' | 'SELLER';

export type ModuleCategory = 'geral' | 'financeiro' | 'comercial' | 'operacao' | 'sistema';

export interface ModuleView {
  view: AppView;
  label: string;
  /** Aparece no menu lateral. Telas acessadas só por dentro de outra (ex.: histórico de entradas) usam false. */
  inMenu?: boolean;
}

export interface ModuleDefinition {
  key: ModuleKey;
  name: string;
  description: string;
  category: ModuleCategory;
  /** Sempre ligado; não aparece como opcional. */
  core?: boolean;
  /** Estado inicial quando a loja nunca configurou o módulo. */
  defaultEnabled: boolean;
  /** Módulos que precisam estar ligados para este funcionar. */
  dependsOn?: ModuleKey[];
  views: ModuleView[];
  /** Telas que o vendedor recebe por padrão (quando o membro não tem permissões próprias). */
  sellerDefault?: boolean;
}

export const MODULES: ModuleDefinition[] = [
  {
    key: 'dashboard',
    name: 'Dashboard',
    description: 'Resumo de vendas, financeiro e estoque.',
    category: 'geral',
    core: true,
    defaultEnabled: true,
    sellerDefault: true,
    views: [{ view: 'DASHBOARD', label: 'Dashboard', inMenu: true }],
  },
  {
    key: 'reports',
    name: 'Relatórios',
    description: 'Relatórios gerenciais e projeções.',
    category: 'geral',
    defaultEnabled: true,
    views: [{ view: 'REPORTS', label: 'Relatórios', inMenu: true }],
  },
  {
    key: 'financial',
    name: 'Financeiro',
    description: 'Contas a pagar e a receber. As vendas geram lançamentos automaticamente.',
    category: 'financeiro',
    defaultEnabled: true,
    views: [
      { view: 'PAYABLES', label: 'Contas a Pagar', inMenu: true },
      { view: 'RECEIVABLES', label: 'Contas a Receber', inMenu: true },
    ],
  },
  {
    key: 'boletos',
    name: 'Boletos',
    description: 'Controle de boletos a pagar.',
    category: 'financeiro',
    defaultEnabled: true,
    dependsOn: ['financial'],
    views: [{ view: 'BOLETOS', label: 'Boletos', inMenu: true }],
  },
  {
    key: 'sales',
    name: 'Vendas / PDV',
    description: 'Frente de caixa e histórico de vendas.',
    category: 'comercial',
    core: true,
    defaultEnabled: true,
    sellerDefault: true,
    views: [
      { view: 'SALES', label: 'Vendas / PDV', inMenu: true },
      { view: 'SALES_HISTORY', label: 'Histórico de Vendas', inMenu: true },
    ],
  },
  {
    key: 'quotes',
    name: 'Orçamentos',
    description: 'Orçamentos que podem virar venda.',
    category: 'comercial',
    defaultEnabled: true,
    sellerDefault: true,
    views: [{ view: 'QUOTES', label: 'Orçamentos', inMenu: true }],
  },
  {
    key: 'customers',
    name: 'Clientes',
    description: 'Cadastro de clientes.',
    category: 'comercial',
    core: true,
    defaultEnabled: true,
    sellerDefault: true,
    views: [{ view: 'CUSTOMERS', label: 'Clientes', inMenu: true }],
  },
  {
    key: 'inventory',
    name: 'Estoque',
    description: 'Produtos, quantidades e entradas de estoque.',
    category: 'operacao',
    core: true,
    defaultEnabled: true,
    views: [
      { view: 'INVENTORY', label: 'Estoque', inMenu: true },
      { view: 'STOCK_LOGS', label: 'Histórico de Entradas', inMenu: false },
    ],
  },
  {
    key: 'production',
    name: 'Produção',
    description: 'Ordens de produção. Serviços vendidos geram OS automaticamente.',
    category: 'operacao',
    defaultEnabled: true,
    views: [{ view: 'PRODUCTION', label: 'Produção', inMenu: true }],
  },
  {
    key: 'custom_production',
    name: 'Produção sob medida',
    description: 'Ficha técnica detalhada da ordem de serviço (ex.: estofados e móveis sob medida: modelo, espuma, braços, assentos, encosto).',
    category: 'operacao',
    defaultEnabled: false,
    dependsOn: ['production'],
    views: [],
  },
  {
    key: 'suppliers',
    name: 'Fornecedores',
    description: 'Cadastro de fornecedores.',
    category: 'operacao',
    defaultEnabled: true,
    views: [{ view: 'SUPPLIERS', label: 'Fornecedores', inMenu: true }],
  },
  {
    key: 'orders',
    name: 'Encomendas',
    description: 'Itens sem estoque vendidos viram encomenda ao fornecedor.',
    category: 'operacao',
    defaultEnabled: true,
    views: [{ view: 'ORDERS', label: 'Encomendas', inMenu: true }],
  },
  {
    key: 'deliveries',
    name: 'Entregas',
    description: 'Roteiro de entregas. Vendas com entrega geram o agendamento.',
    category: 'operacao',
    defaultEnabled: true,
    views: [{ view: 'DELIVERIES', label: 'Entregas', inMenu: true }],
  },
  {
    key: 'push_notifications',
    name: 'Notificações no celular',
    description: 'Avisos de venda no celular (Web Push).',
    category: 'sistema',
    defaultEnabled: true,
    views: [],
  },
  {
    key: 'settings',
    name: 'Configurações',
    description: 'Dados da empresa, categorias, taxas e a gestão da loja.',
    category: 'sistema',
    core: true,
    defaultEnabled: true,
    views: [
      { view: 'SETTINGS', label: 'Configurações', inMenu: true },
      { view: 'TEAM', label: 'Equipe', inMenu: true },
    ],
  },
];

export const MODULE_CATEGORIES: { key: ModuleCategory; label: string }[] = [
  { key: 'geral', label: 'Geral' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'comercial', label: 'Comercial' },
  { key: 'operacao', label: 'Operação' },
  { key: 'sistema', label: 'Sistema' },
];

export const ROLE_LABELS: Record<StoreRole, string> = {
  OWNER: 'Dono',
  MANAGER: 'Gerente',
  SELLER: 'Vendedor',
};

/**
 * Telas só do administrador da plataforma (o dono do SaaS, is_platform_admin): o painel de assinaturas.
 * Não existe papel de suporte (decisão 33). Dono, gerente e vendedor de loja não acessam.
 */
export const PLATFORM_ADMIN_VIEWS: AppView[] = ['STORE_ADMIN'];

/** Telas que só dono/gerente acessam, mesmo que o vendedor tenha permissão marcada. */
export const MANAGER_ONLY_VIEWS: AppView[] = ['SETTINGS', 'STORE_ADMIN', 'TEAM', 'PAYABLES', 'RECEIVABLES', 'BOLETOS', 'REPORTS'];

export const getModule = (key: ModuleKey) => MODULES.find(m => m.key === key)!;

export const moduleForView = (view: AppView): ModuleDefinition | undefined =>
  MODULES.find(m => m.views.some(v => v.view === view));

/** Telas padrão de um vendedor sem permissões personalizadas. */
export const SELLER_DEFAULT_VIEWS: AppView[] = MODULES
  .filter(m => m.sellerDefault)
  .flatMap(m => m.views.map(v => v.view));

/** Telas que um vendedor pode receber (usado na tela de equipe). */
export const SELLER_ASSIGNABLE_VIEWS: ModuleView[] = MODULES
  .flatMap(m => m.views)
  .filter(v => !MANAGER_ONLY_VIEWS.includes(v.view));

/**
 * Resolve o estado final de cada módulo: aplica o padrão, força os módulos core
 * e desliga quem depende de um módulo desligado.
 */
export const resolveModuleStates = (stored: Partial<Record<ModuleKey, boolean>>): Record<ModuleKey, boolean> => {
  const states = {} as Record<ModuleKey, boolean>;
  for (const m of MODULES) {
    states[m.key] = m.core ? true : (stored[m.key] ?? m.defaultEnabled);
  }
  // Dependências podem encadear; repete até estabilizar.
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of MODULES) {
      if (states[m.key] && m.dependsOn?.some(dep => !states[dep])) {
        states[m.key] = false;
        changed = true;
      }
    }
  }
  return states;
};

/** Módulos que dependem (direta ou indiretamente) de `key`. */
export const dependentsOf = (key: ModuleKey): ModuleKey[] => {
  const result = new Set<ModuleKey>();
  const visit = (k: ModuleKey) => {
    for (const m of MODULES) {
      if (m.dependsOn?.includes(k) && !result.has(m.key)) {
        result.add(m.key);
        visit(m.key);
      }
    }
  };
  visit(key);
  return [...result];
};

/**
 * Regra de acesso a uma tela (pura, usada pelo StoreContext e pelos testes).
 * - Telas de administração da plataforma: só o administrador.
 * - Módulo desligado bloqueia suas telas para todos.
 * - Dono e gerente acessam o resto; vendedor só o que foi liberado e nunca telas de gestão.
 */
export const canAccessViewFor = (
  view: AppView,
  ctx: {
    role: StoreRole | null | undefined;
    isPlatformAdmin: boolean;
    moduleStates: Partial<Record<ModuleKey, boolean>>;
    permissions?: AppView[] | null;
  },
): boolean => {
  if (PLATFORM_ADMIN_VIEWS.includes(view)) return ctx.isPlatformAdmin;
  const mod = moduleForView(view);
  if (mod && !ctx.moduleStates[mod.key]) return false;
  if (!ctx.role) return false;
  if (ctx.role === 'OWNER' || ctx.role === 'MANAGER') return true;
  if (MANAGER_ONLY_VIEWS.includes(view)) return false;
  const allowed = ctx.permissions?.length ? ctx.permissions : SELLER_DEFAULT_VIEWS;
  return allowed.includes(view);
};

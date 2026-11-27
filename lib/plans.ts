import { ModuleKey } from './modules';

/**
 * Planos pagos oferecidos ao dono quando o teste grátis termina ou durante o teste.
 *
 * Fonte de verdade dos módulos por plano é o banco (`plan_modules`, migração 024).
 * Este arquivo espelha o mapeamento para a tela de escolha e não define acesso.
 * Se o mapeamento mudar, atualize os dois lados junto (ver tests/plans.test.ts).
 */

export type PlanCode = 'inicio' | 'crescimento' | 'avancado';

/** Chave especial: a cor da marca é do plano Avançado, mas não é um módulo de lib/modules.ts. */
export type PlanModuleKey = ModuleKey | 'brand';

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  /** Preço mensal em centavos. */
  priceCents: number;
  /** Limite de vendedores (decisão 1: 1, 3 e 6). null = ilimitado (nenhum plano usa hoje). */
  maxSellers: number | null;
  recommended?: boolean;
  /** Itens do plano em linguagem simples, na ordem da tela. */
  features: string[];
  /** Módulos ativados ao escolher o plano (espelha plan_modules). */
  modules: PlanModuleKey[];
}

/** Core fixo em todos os planos (decisão 14): não desliga por plano nem por override. */
export const CORE_MODULES: PlanModuleKey[] = ['dashboard', 'sales', 'inventory', 'customers', 'settings'];
const BASE_MODULES: PlanModuleKey[] = CORE_MODULES;
/** Boletos, Fornecedores e Encomendas entram a partir do Crescimento (decisão 15). */
const GROWTH_EXTRA: PlanModuleKey[] = ['financial', 'boletos', 'reports', 'production', 'quotes', 'suppliers', 'orders'];
const ADVANCED_EXTRA: PlanModuleKey[] = ['deliveries', 'push_notifications', 'custom_production', 'brand'];

export const PLANS: PlanDefinition[] = [
  {
    code: 'inicio',
    name: 'Início',
    priceCents: 4900,
    maxSellers: 1,
    features: [
      'Dashboard',
      'Vendas / PDV, com dados do cliente',
      'Estoque',
      'Produtos',
      'Clientes',
      'Configurações',
    ],
    modules: BASE_MODULES,
  },
  {
    code: 'crescimento',
    name: 'Crescimento',
    priceCents: 9900,
    maxSellers: 3,
    recommended: true,
    features: [
      'Tudo do Início',
      'Financeiro',
      'Relatórios',
      'Produção',
      'Orçamentos / Cotações',
      'Boletos',
      'Fornecedores',
      'Encomendas',
    ],
    modules: [...BASE_MODULES, ...GROWTH_EXTRA],
  },
  {
    code: 'avancado',
    name: 'Avançado',
    priceCents: 19900,
    maxSellers: 6,
    features: [
      'Tudo do Crescimento',
      'Entregas',
      'Cor da marca',
      'Sob medida (seção separada dentro de Produção)',
    ],
    modules: [...BASE_MODULES, ...GROWTH_EXTRA, ...ADVANCED_EXTRA],
  },
];

export const getPlan = (code: PlanCode): PlanDefinition => PLANS.find(p => p.code === code)!;

export const isPlanCode = (code: string | null | undefined): code is PlanCode =>
  !!code && PLANS.some(p => p.code === code);

/** Anual = 10 meses (decisão 1). */
export const ANNUAL_MONTHS_CHARGED = 10;
export const annualPriceCents = (plan: PlanDefinition): number => plan.priceCents * ANNUAL_MONTHS_CHARGED;

/** Ordem dos planos: usada para saber se a troca é upgrade ou downgrade. */
export const planRank = (code: PlanCode): number => PLANS.findIndex(p => p.code === code);

/**
 * Plano usado para o limite de vendedores da loja.
 * Trial lê o Avançado (migração 046). Plano desconhecido/legado: null (o banco decide).
 */
export const planForLimits = (code: string | null | undefined): PlanDefinition | null => {
  if (code === 'trial') return getPlan('avancado');
  return isPlanCode(code) ? getPlan(code) : null;
};

/** Limite de vendedores do plano da loja; null = sem limite conhecido no front (o banco decide). */
export const sellerLimitFor = (code: string | null | undefined): number | null => planForLimits(code)?.maxSellers ?? null;

/** Vendedores que precisam sair antes de trocar para `target` (0 = pode trocar). */
export const sellersToRemoveFor = (target: PlanCode, currentSellers: number): number => {
  const limit = getPlan(target).maxSellers;
  return limit === null ? 0 : Math.max(0, currentSellers - limit);
};

/** Formata centavos em reais: 4900 -> "R$ 49". */
export const formatPlanPrice = (cents: number): string => {
  const reais = cents / 100;
  return `R$ ${Number.isInteger(reais) ? reais : reais.toFixed(2).replace('.', ',')}`;
};

/** Texto do limite de vendedores para a tela. */
export const planSellersLabel = (plan: PlanDefinition): string =>
  plan.maxSellers === null
    ? 'Vendedores ilimitados'
    : plan.maxSellers === 1
      ? 'Até 1 vendedor'
      : `Até ${plan.maxSellers} vendedores`;

/**
 * Nome da função no banco que ativa o plano para a loja.
 * Ainda não existe: a migração 024 (apply_plan_modules + escolha pelo dono) não foi aplicada.
 */
export const CHOOSE_PLAN_RPC = 'choose_trial_plan';

/** Retorno da RPC: plano gravado e quantidade de módulos aplicados. Não ativa a loja. */
export interface ChoosePlanResult {
  plan: PlanCode;
  modules_applied: number;
}

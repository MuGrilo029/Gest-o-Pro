import { ModuleKey } from './modules';

/**
 * Planos pagos oferecidos ao dono quando o teste grátis termina ou durante o teste.
 *
 * Fonte de verdade dos módulos, limites e preços é o banco (`plans` e `plan_modules`, migração 048).
 * Este arquivo espelha o banco para a tela de escolha e não define acesso.
 * tests/plans.test.ts sobe o banco local (PGlite) e falha se os dois lados divergirem.
 * O plano custom ("Com Stillo") saiu do fluxo: não aparece aqui nem pode ser escolhido.
 */

export type PlanCode = 'inicio' | 'crescimento' | 'avancado';

/** Chave especial: a cor da marca é do plano Avançado, mas não é um módulo de lib/modules.ts. */
export type PlanModuleKey = ModuleKey | 'brand';

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  /** Preço mensal em centavos. */
  priceCents: number;
  /** Preço anual em centavos: 10× o mensal (decisão 1; espelha plans.annual_price_cents). */
  annualPriceCents: number;
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
/** Financeiro está em todos os planos (decisão de 27/11, migração 065); não é core: o override pode desligar. */
const START_EXTRA: PlanModuleKey[] = ['financial'];
/** Boletos, Fornecedores e Encomendas entram a partir do Crescimento (decisão 15). */
const GROWTH_EXTRA: PlanModuleKey[] = ['boletos', 'reports', 'production', 'quotes', 'suppliers', 'orders'];
const ADVANCED_EXTRA: PlanModuleKey[] = ['deliveries', 'push_notifications', 'custom_production', 'brand'];

export const PLANS: PlanDefinition[] = [
  {
    code: 'inicio',
    name: 'Início',
    priceCents: 4900,
    annualPriceCents: 49000,
    maxSellers: 1,
    features: [
      'Dashboard',
      'Vendas / PDV, com dados do cliente',
      'Estoque',
      'Produtos',
      'Clientes',
      'Financeiro (contas a pagar e a receber)',
      'Configurações',
    ],
    modules: [...BASE_MODULES, ...START_EXTRA],
  },
  {
    code: 'crescimento',
    name: 'Crescimento',
    priceCents: 9900,
    annualPriceCents: 99000,
    maxSellers: 3,
    recommended: true,
    features: [
      'Tudo do Início',
      'Relatórios',
      'Produção',
      'Orçamentos / Cotações',
      'Fornecedores',
      'Encomendas',
      'Boletos',
    ],
    modules: [...BASE_MODULES, ...START_EXTRA, ...GROWTH_EXTRA],
  },
  {
    code: 'avancado',
    name: 'Avançado',
    priceCents: 19900,
    annualPriceCents: 199000,
    maxSellers: 6,
    features: [
      'Tudo do Crescimento',
      'Entregas',
      'Cor da marca',
      'Sob medida (seção separada dentro de Produção)',
    ],
    modules: [...BASE_MODULES, ...START_EXTRA, ...GROWTH_EXTRA, ...ADVANCED_EXTRA],
  },
];

export const getPlan = (code: PlanCode): PlanDefinition => PLANS.find(p => p.code === code)!;

export const isPlanCode = (code: string | null | undefined): code is PlanCode =>
  !!code && PLANS.some(p => p.code === code);

/** Anual = 10 meses (decisão 1). O preço anual de cada plano está no campo `annualPriceCents`. */
export const ANNUAL_MONTHS_CHARGED = 10;

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

/** Nome da função no banco que grava o plano escolhido pelo dono durante o trial (migração 031). */
export const CHOOSE_PLAN_RPC = 'choose_trial_plan';

/** Retorno da RPC: plano gravado e quantidade de módulos aplicados. Não ativa a loja. */
export interface ChoosePlanResult {
  plan: PlanCode;
  modules_applied: number;
}

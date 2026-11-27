import { supabase } from './supabase';
import { MODULES, ModuleKey } from './modules';
import { PlanCode } from './plans';
import { callManageUsers } from './teamApi';
import type { CreateStoreData } from './createStoreRequest';
import { DeletionOutcome, DeletionPreview, parseDeletionOutcome, parseDeletionPreview } from './storeDeletion';

/**
 * Painel admin da plataforma (só o dono do SaaS, `is_platform_admin`; decisões 33–38 e 41).
 * Toda leitura e escrita passa por RPC do Backend; a checagem de admin é do banco.
 * Sem KPIs, sem motivo obrigatório, sem duas etapas. Nenhuma leitura de `stores.plan` nem valor fixo:
 * o plano vem da assinatura (`plano` da RPC admin_list_stores).
 *
 * Quando uma RPC ainda não existe no banco, a função devolve `{ available: false }` e a tela mostra
 * "aguardando Backend" em vez de quebrar.
 */
export type AdminCall<T> = { available: true; data: T } | { available: false };

export const isMissingFunction = (error: any) =>
  !!error && (error.code === 'PGRST202' || error.code === '42883' || /function .* does not exist|Could not find the function/i.test(error.message || ''));

/** Prefixos fixos das mensagens de erro do banco (ERRCODE P0001), combinados com o Backend. */
export const DB_ERROR_PREFIXES = [
  'LIMITE_VENDEDORES:', 'UMA_LOJA_POR_DONO:', 'MODULO_CORE:', 'ESTOQUE_DEPOSITO:',
  'REQUISICAO_REUTILIZADA:', 'CONTA_INEXISTENTE:', 'NOME_NAO_CONFERE:', 'ASSINATURA_NO_GATEWAY:',
  'TABELA_SEM_TRATAMENTO:', 'REFERENCIA_ENTRE_LOJAS:', 'LOJA_EXCLUIDA:',
];
/** O servidor já usou esta chave de repetição com outros dados: é preciso uma chave nova. */
export const REQUEST_REUSED_PREFIX = 'REQUISICAO_REUTILIZADA:';

/** Tira o prefixo técnico e deixa só a frase para a tela. */
export const friendlyDbError = (message: string): string => {
  const prefix = DB_ERROR_PREFIXES.find(p => message.startsWith(p));
  return prefix ? message.slice(prefix.length).trim() || message : message;
};

export const callAdminFunction = async <T>(name: string, params?: Record<string, unknown>): Promise<AdminCall<T>> => {
  const { data, error } = await supabase.rpc(name, params ?? {});
  if (error) {
    if (isMissingFunction(error)) return { available: false };
    throw new Error(friendlyDbError(error.message));
  }
  return { available: true, data: data as T };
};

/** Igual a callAdminFunction, mas trata "RPC ausente" como erro de tela. */
const requireAdminFunction = async <T>(name: string, params?: Record<string, unknown>): Promise<T> => {
  const res = await callAdminFunction<T>(name, params);
  if (!res.available) throw new Error(`Função ${name} ainda não existe no banco (aguardando Backend). Nada foi alterado.`);
  return res.data;
};

export type StoreStatus = 'trial' | 'active' | 'suspended' | 'expired';

export interface AdminStoreRow {
  id: string;
  name: string;
  status: StoreStatus;
  /** Plano da assinatura (subscriptions.plan_id); null = sem assinatura. */
  plan: string | null;
  subscriptionStatus: string | null;
  /** Fim do teste ou do período pago. */
  endsAt: Date | null;
  ownerEmail: string | null;
  sellersCount: number | null;
  maxSellers: number | null;
  createdAt: string | null;
  /** Exclusão começada e não concluída: o painel só oferece concluir. */
  deletionPending: boolean;
}

export interface AdminStorePage {
  items: AdminStoreRow[];
  next: { afterKey: string; afterId: string } | null;
}

export interface AdminStoreFilters {
  status?: StoreStatus | '';
  plan?: PlanCode | '';
  emTeste?: boolean;
  q?: string;
}

const toDate = (v: unknown) => (typeof v === 'string' && v ? new Date(v) : null);
const toNum = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

export const mapStoreRow = (r: any): AdminStoreRow => ({
  id: r.id ?? r.store_id,
  name: r.name ?? '',
  // effective_status considera prazo vencido; status é o gravado.
  status: (r.effective_status ?? r.status ?? 'active') as StoreStatus,
  plan: r.plano ?? r.plan_id ?? null,
  subscriptionStatus: r.assinatura_status ?? null,
  endsAt: toDate(r.fim) ?? toDate(r.current_period_end) ?? toDate(r.trial_ends_at) ?? toDate(r.valid_until),
  ownerEmail: r.owner_email ?? null,
  sellersCount: toNum(r.sellers_count),
  maxSellers: toNum(r.max_sellers),
  createdAt: r.created_at ?? null,
  deletionPending: r.exclusao_pendente === true,
});

/** Lista de assinaturas (RPC 034, paginada por cursor composto). */
export const listStores = async (
  filters: AdminStoreFilters,
  cursor?: { afterKey: string; afterId: string } | null,
  limit = 50,
): Promise<AdminStorePage> => {
  const f: Record<string, string> = {};
  if (filters.status) f.status = filters.status;
  if (filters.plan) f.plan = filters.plan;
  if (filters.emTeste) f.em_teste = 'true';
  if (filters.q?.trim()) f.q = filters.q.trim();
  const data = await requireAdminFunction<any>('admin_list_stores', {
    p_filters: f,
    p_limit: limit,
    p_after_key: cursor?.afterKey ?? null,
    p_after_id: cursor?.afterId ?? null,
  });
  const items = ((data?.items ?? []) as any[]).map(mapStoreRow);
  const next = data?.has_more && data?.next_after_key && data?.next_after_id
    ? { afterKey: String(data.next_after_key), afterId: String(data.next_after_id) }
    : null;
  return { items, next };
};

// ---------------------------------------------------------------- criação

export type CreateStoreInput = CreateStoreData;

export interface CreateStoreResult {
  storeId: string;
  accountCreated: boolean;
  /** Senha provisória: só vem (e só aparece) quando a conta do dono foi criada agora. */
  temporaryPassword: string | null;
  /** O servidor reconheceu a repetição do mesmo pedido: nada foi duplicado. */
  alreadyCreated: boolean;
}

/**
 * Cria loja e login do dono numa chamada só (Edge Function manage-users, action create_store).
 * `requestId` é a chave de repetição: reenviar o mesmo pedido não cria outra loja.
 */
export const createStore = async (input: CreateStoreInput, requestId: string): Promise<CreateStoreResult> => {
  const data = await callManageUsers({
    action: 'create_store',
    request_id: requestId,
    store_name: input.storeName.trim(),
    owner_name: input.ownerName.trim(),
    email: input.email.trim(),
    plan: input.plan,
    mode: input.mode,
    ...(input.mode === 'paid' ? { days: input.days ?? 30 } : {}),
  });
  if (!data?.store_id) throw new Error('O servidor não confirmou a criação da loja. Tente de novo.');
  const accountCreated = data.account_created === true;
  return {
    storeId: String(data.store_id),
    accountCreated,
    temporaryPassword: accountCreated ? (data.temporary_password as string) || null : null,
    alreadyCreated: data.already_created === true,
  };
};

// ---------------------------------------------------------------- exclusão

/** Chamada à manage-users com a mensagem do erro sem o prefixo técnico. */
const callStoreAction = async (body: Record<string, unknown>) => {
  try {
    return await callManageUsers(body);
  } catch (e: any) {
    throw new Error(friendlyDbError(String(e?.message || 'Falha ao falar com o servidor.')));
  }
};

/** Prévia do que a exclusão apaga (action delete_store_preview). */
export const previewDeleteStore = async (storeId: string, storeName: string): Promise<DeletionPreview> => {
  const data = await callStoreAction({ action: 'delete_store_preview', store_id: storeId });
  if (!data?.preview) throw new Error('O servidor não devolveu a prévia da exclusão.');
  return parseDeletionPreview(data.preview, storeName);
};

/**
 * Exclui a loja (action delete_store). Irreversível. O resultado pode ser parcial (`done: false`);
 * repetir a mesma chamada continua de onde parou.
 */
export const deleteStore = async (storeId: string, confirmName: string): Promise<DeletionOutcome> => {
  const data = await callStoreAction({ action: 'delete_store', store_id: storeId, confirm_name: confirmName });
  if (!data || data.ok !== true) throw new Error('A exclusão não terminou. Tente de novo: ela continua de onde parou.');
  return parseDeletionOutcome(data);
};

// ---------------------------------------------------------------- prazo e status

export const extendStore = (storeId: string, amount: { hours?: number; days?: number }) =>
  requireAdminFunction<string>('admin_extend_store', { p_store: storeId, p_hours: amount.hours ?? null, p_days: amount.days ?? null });

export const setStoreStatus = (storeId: string, status: 'active' | 'suspended') =>
  requireAdminFunction<void>('admin_set_status', { p_store: storeId, p_status: status, p_hours: null, p_days: null, p_unlimited: false });

export const closeStore = (storeId: string) =>
  requireAdminFunction<{ status: string }>('admin_close_store', { p_store: storeId, p_note: null });

// ---------------------------------------------------------------- plano

export interface PlanChangeResult { kind?: string; status?: string; effective?: string | null; plan?: string }

/**
 * Troca de plano (RPC 037). O banco recusa o downgrade enquanto houver vendedores acima do limite;
 * a tela já obriga a excluir os excedentes antes de chamar (decisão 4).
 */
export const changePlan = (storeId: string, plan: PlanCode) =>
  requireAdminFunction<PlanChangeResult>('admin_request_plan_change', { p_store: storeId, p_plan: plan });

// ---------------------------------------------------------------- módulos

export type OverrideState = 'grant' | 'revoke' | null;

export interface AdminModuleState {
  key: ModuleKey | 'brand';
  label?: string;
  enabled: boolean;
  /** O que o plano daria sem override. */
  planEnabled?: boolean;
  core: boolean;
  override: OverrideState;
}

const MODULE_KEYS: (ModuleKey | 'brand')[] = [...MODULES.map(m => m.key), 'brand'];

/**
 * Estado dos módulos de uma loja: RPC admin_store_modules (proposta ao Backend); se ainda não existir,
 * lê store_module_enabled por módulo e os overrides ativos.
 */
export const fetchStoreModules = async (storeId: string): Promise<AdminModuleState[]> => {
  const direct = await callAdminFunction<any[]>('admin_store_modules', { p_store: storeId });
  if (direct.available) {
    return (direct.data || []).map(r => ({
      key: r.module_key,
      label: r.label ?? undefined,
      planEnabled: r.plan_enabled ?? undefined,
      enabled: !!r.enabled,
      core: !!r.core,
      override: (r.override ?? null) as OverrideState,
    }));
  }
  const coreKeys = new Set(MODULES.filter(m => m.core).map(m => m.key as string));
  const enabled = await Promise.all(MODULE_KEYS.map(async key => {
    const { data, error } = await supabase.rpc('store_module_enabled', { p_store: storeId, p_module: key });
    if (error) throw new Error(error.message);
    return [key, !!data] as const;
  }));
  const overrides = new Map<string, OverrideState>();
  const { data: ov } = await supabase
    .from('store_module_overrides')
    .select('module_key, action')
    .eq('store_id', storeId)
    .is('revoked_at', null);
  for (const o of (ov as any[]) || []) overrides.set(o.module_key, o.action === 'grant' ? 'grant' : 'revoke');
  return enabled.map(([key, on]) => ({ key, enabled: on, core: coreKeys.has(key), override: overrides.get(key) ?? null }));
};

/** Override só liga/desliga, sem motivo nem validade (decisão 17). Core é recusado pelo banco. */
export const setModuleOverride = (storeId: string, module: ModuleKey | 'brand', enabled: boolean) =>
  requireAdminFunction<void>('admin_set_module_override', { p_store: storeId, p_module: module, p_enabled: enabled });

/** Volta o módulo ao que o plano define. */
export const clearModuleOverride = (storeId: string, module: ModuleKey | 'brand') =>
  requireAdminFunction<void>('admin_clear_module_override', { p_store: storeId, p_module: module });

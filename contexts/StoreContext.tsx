import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { AppView } from '../types';
import { applyBrandColor, normalizeHex } from '../lib/brand';
import {
  MANAGER_ONLY_VIEWS,
  PLATFORM_ADMIN_VIEWS,
  MODULES,
  ModuleKey,
  SELLER_DEFAULT_VIEWS,
  StoreRole,
  canAccessViewFor,
  dependentsOf,
  getModule,
  moduleForView,
  resolveModuleStates,
} from '../lib/modules';

export interface StoreSummary {
  id: string;
  name: string;
  role: StoreRole;
  permissions: AppView[];
}

export interface StoreMember {
  userId: string;
  email: string;
  name: string;
  role: StoreRole;
  permissions: AppView[];
  createdAt: string;
}

type StoreStatus = 'loading' | 'ready' | 'no_store';

export type SubscriptionStatus = 'trial' | 'active' | 'suspended' | 'expired';

/** Situação da assinatura da loja ativa. */
export interface Subscription {
  status: SubscriptionStatus;
  plan: string | null;
  /** Fim do teste (trial) ou da validade (pago). null = sem prazo. */
  endsAt: Date | null;
  /** false quando suspensa/expirada: o app mostra a tela de acesso expirado. */
  accessOk: boolean;
}

export interface ClientRow {
  storeId: string;
  name: string;
  contactEmail: string | null;
  ownerEmail: string | null;
  plan: string | null;
  notes: string | null;
  status: SubscriptionStatus;
  effectiveStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  validUntil: Date | null;
  modules: string[];
  createdAt: string;
}

export interface CreateClientInput {
  email: string;
  storeName: string;
  ownerName?: string;
  /** Senha inicial (10+ caracteres, letras e números); vazio = o servidor gera. Só vale se o e-mail ainda não tiver conta. */
  password?: string;
  modules: ModuleKey[];
  mode: 'trial' | 'paid';
  hours?: number;
  days?: number;
  plan?: string;
  notes?: string;
}

interface StoreContextValue {
  status: StoreStatus;
  /** true enquanto a migração 003 não foi aplicada: uma loja única, todos os módulos padrão. */
  legacyMode: boolean;
  stores: StoreSummary[];
  activeStore: StoreSummary | null;
  role: StoreRole | null;
  isManager: boolean;
  isPlatformAdmin: boolean;
  /** Cor da marca da loja ativa (#rrggbb) ou null = paleta padrão. */
  brandColor: string | null;
  setBrandColor: (hex: string | null) => Promise<void>;
  /** Assinatura da loja ativa (null no modo legado ou antes da migração 006). */
  subscription: Subscription | null;
  adminListClients: () => Promise<ClientRow[]>;
  adminCreateClient: (input: CreateClientInput) => Promise<{ storeId: string; accountCreated: boolean; temporaryPassword: string | null }>;
  adminExtend: (storeId: string, amount: { hours?: number; days?: number }) => Promise<void>;
  adminSetStatus: (storeId: string, status: SubscriptionStatus, opts?: { hours?: number; days?: number; unlimited?: boolean }) => Promise<void>;
  moduleStates: Record<ModuleKey, boolean>;
  isModuleEnabled: (key: ModuleKey) => boolean;
  canAccessView: (view: AppView) => boolean;
  switchStore: (storeId: string) => Promise<void>;
  createStore: (name: string, enabledModules?: ModuleKey[]) => Promise<string | null>;
  setModuleEnabled: (key: ModuleKey, enabled: boolean) => Promise<void>;
  listMembers: () => Promise<StoreMember[]>;
  /** Cria a conta (e-mail + senha) e coloca na loja ativa. Se o e-mail já tiver conta, só adiciona. */
  createMember: (input: { email: string; name: string; password: string; role: StoreRole; permissions: AppView[] }) => Promise<{ existingAccount: boolean; temporaryPassword: string | null }>;
  /** Senha vazia: o servidor gera uma provisória e devolve. */
  setMemberPassword: (userId: string, password: string) => Promise<string | null>;
  updateMember: (userId: string, role: StoreRole, permissions: AppView[]) => Promise<void>;
  removeMember: (userId: string) => Promise<void>;
  reload: () => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | undefined>(undefined);

const LEGACY_STORE_ID = 'legacy';
const BRAND_ROW_KEY = 'brand';

const isMissingFunction = (error: any) =>
  !!error && (error.code === 'PGRST202' || error.code === '42883' || /function .* does not exist|Could not find the function/i.test(error.message || ''));

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [status, setStatus] = useState<StoreStatus>('loading');
  const [legacyMode, setLegacyMode] = useState(false);
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [brandColor, setBrandColorState] = useState<string | null>(null);
  const [storedModules, setStoredModules] = useState<Partial<Record<ModuleKey, boolean>>>({});

  const loadModules = useCallback(async (storeId: string) => {
    const { data, error } = await supabase.from('store_modules').select('module_key, enabled, config').eq('store_id', storeId);
    if (error) {
      console.error('STORE: erro ao carregar módulos', error);
      setStoredModules({});
      setBrandColorState(null);
      return;
    }
    const map: Partial<Record<ModuleKey, boolean>> = {};
    let color: string | null = null;
    for (const row of data || []) {
      // A linha especial 'brand' guarda a cor da loja em config.color (não é um módulo).
      if (row.module_key === BRAND_ROW_KEY) color = normalizeHex((row.config as any)?.color);
      else map[row.module_key as ModuleKey] = !!row.enabled;
    }
    setStoredModules(map);
    setBrandColorState(color);
  }, []);

  /** Antes da migração: deriva papel de profiles.roles e liga os módulos padrão. */
  const loadLegacy = useCallback(async () => {
    const { data: profile } = await supabase.from('profiles').select('roles').eq('id', user!.id).maybeSingle();
    const roles: string[] = Array.isArray(profile?.roles) ? profile!.roles : [];
    const isAdmin = roles.includes('ADMIN');
    const legacyStore: StoreSummary = {
      id: LEGACY_STORE_ID,
      name: 'Loja',
      role: isAdmin ? 'OWNER' : 'SELLER',
      permissions: isAdmin ? [] : (roles as AppView[]),
    };
    setLegacyMode(true);
    setIsPlatformAdmin(isAdmin);
    setStores([legacyStore]);
    setActiveStoreId(LEGACY_STORE_ID);
    setStoredModules({});
    setSubscription(null);
    setStatus('ready');
  }, [user]);

  const reload = useCallback(async () => {
    if (!user) {
      setStores([]);
      setActiveStoreId(null);
      setStatus('loading');
      return;
    }

    const { data, error } = await supabase.rpc('my_stores');
    if (isMissingFunction(error)) {
      await loadLegacy();
      return;
    }
    if (error) {
      console.error('STORE: erro ao carregar lojas', error);
      setStatus('no_store');
      return;
    }

    setLegacyMode(false);
    const list: StoreSummary[] = (data || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      permissions: s.permissions || [],
    }));
    setStores(list);

    const { data: profile } = await supabase.from('profiles').select('is_platform_admin').eq('id', user.id).maybeSingle();
    setIsPlatformAdmin(!!profile?.is_platform_admin);

    if (list.length === 0) {
      setActiveStoreId(null);
      setStatus('no_store');
      return;
    }

    // Assinatura por loja (migração 006). Sem a função, nada é bloqueado.
    const { data: accessData, error: accessError } = await supabase.rpc('my_store_access');
    const accessByStore = new Map<string, any>();
    if (!accessError) for (const a of accessData || []) accessByStore.set(a.store_id, a);

    let active = (data || []).find((s: any) => s.is_active_store)?.id as string | undefined;
    // Loja ativa vencida/suspensa: se existir outra liberada, troca para ela.
    if (active && accessByStore.get(active)?.access_ok === false) {
      const alt = list.find(s => accessByStore.get(s.id)?.access_ok !== false);
      if (alt) {
        const { error: swErr } = await supabase.rpc('set_active_store', { p_store: alt.id });
        if (!swErr) active = alt.id;
      }
    }
    if (!active) {
      // Usuário sem loja ativa (ex.: acabou de ser adicionado): usa a primeira.
      active = list[0].id;
      await supabase.rpc('set_active_store', { p_store: active });
    }
    setActiveStoreId(active);

    const acc = accessByStore.get(active);
    if (acc) {
      const subStatus = (acc.effective_status || acc.status) as SubscriptionStatus;
      const end: string | null = subStatus === 'trial' ? acc.trial_ends_at : acc.valid_until;
      // Usa o tempo restante do servidor para não depender do relógio do computador.
      const endsAt = acc.seconds_remaining != null
        ? new Date(Date.now() + Number(acc.seconds_remaining) * 1000)
        : (end ? new Date(end) : null);
      setSubscription({ status: subStatus, plan: acc.plan ?? null, endsAt, accessOk: !!acc.access_ok });
    } else {
      setSubscription(null);
    }

    if (acc && acc.access_ok === false) {
      setStoredModules({});
      setBrandColorState(null);
    } else {
      await loadModules(active);
    }
    setStatus('ready');
  }, [user, loadLegacy, loadModules]);

  useEffect(() => {
    reload();
  }, [reload]);

  const activeStore = useMemo(() => stores.find(s => s.id === activeStoreId) || null, [stores, activeStoreId]);
  const role = activeStore?.role ?? null;
  const isManager = role === 'OWNER' || role === 'MANAGER';
  const moduleStates = useMemo(() => resolveModuleStates(storedModules), [storedModules]);

  const isModuleEnabled = useCallback((key: ModuleKey) => !!moduleStates[key], [moduleStates]);

  const canAccessView = useCallback((view: AppView) => canAccessViewFor(view, {
    role,
    isPlatformAdmin,
    moduleStates,
    permissions: activeStore?.permissions,
  }), [moduleStates, role, activeStore, isPlatformAdmin]);

  const switchStore = useCallback(async (storeId: string) => {
    if (legacyMode || storeId === activeStoreId) return;
    const { error } = await supabase.rpc('set_active_store', { p_store: storeId });
    if (error) throw new Error(error.message);
    await reload();
  }, [legacyMode, activeStoreId, reload]);

  const saveModules = useCallback(async (storeId: string, states: Partial<Record<ModuleKey, boolean>>) => {
    const rows = Object.entries(states).map(([module_key, enabled]) => ({
      store_id: storeId,
      module_key,
      enabled,
      updated_at: new Date().toISOString(),
    }));
    if (rows.length === 0) return;
    const { error } = await supabase.from('store_modules').upsert(rows, { onConflict: 'store_id,module_key' });
    if (error) throw new Error(error.message);
  }, []);

  const createStore = useCallback(async (name: string, enabledModules?: ModuleKey[]) => {
    if (legacyMode) throw new Error('Aplique a migração multi-loja antes de criar lojas.');
    const { data, error } = await supabase.rpc('create_store', { p_name: name });
    if (error) throw new Error(error.message);
    const storeId = data as string;
    if (enabledModules) {
      const states: Partial<Record<ModuleKey, boolean>> = {};
      for (const m of MODULES) if (!m.core) states[m.key] = enabledModules.includes(m.key);
      await saveModules(storeId, resolveModuleStates(states));
    }
    await reload();
    return storeId;
  }, [legacyMode, saveModules, reload]);

  const setModuleEnabled = useCallback(async (key: ModuleKey, enabled: boolean) => {
    if (legacyMode) throw new Error('Aplique a migração multi-loja para ligar e desligar módulos.');
    if (!activeStoreId) return;
    const mod = getModule(key);
    if (mod.core) return;

    const next: Partial<Record<ModuleKey, boolean>> = { ...moduleStates, [key]: enabled };
    if (enabled) {
      // Liga também o que este módulo precisa.
      for (const dep of mod.dependsOn || []) next[dep] = true;
    } else {
      // Desliga quem depende dele.
      for (const dep of dependentsOf(key)) next[dep] = false;
    }
    const resolved = resolveModuleStates(next);
    const changed: Partial<Record<ModuleKey, boolean>> = {};
    for (const m of MODULES) {
      if (!m.core && resolved[m.key] !== moduleStates[m.key]) changed[m.key] = resolved[m.key];
    }
    await saveModules(activeStoreId, changed);
    setStoredModules(prev => ({ ...prev, ...changed }));
  }, [legacyMode, activeStoreId, moduleStates, saveModules]);

  const requireStore = () => {
    if (legacyMode) throw new Error('Aplique a migração multi-loja para gerenciar a equipe.');
    if (!activeStoreId) throw new Error('Nenhuma loja selecionada.');
    return activeStoreId;
  };

  const listMembers = useCallback(async (): Promise<StoreMember[]> => {
    if (legacyMode || !activeStoreId) return [];
    const { data, error } = await supabase.rpc('list_store_members', { p_store: activeStoreId });
    if (error) throw new Error(error.message);
    return (data || []).map((m: any) => ({
      userId: m.user_id,
      email: m.email,
      name: m.name,
      role: m.role,
      permissions: m.permissions || [],
      createdAt: m.created_at,
    }));
  }, [legacyMode, activeStoreId]);

  /** Chama a Edge Function manage-users e devolve a mensagem de erro dela, se houver. */
  const callManageUsers = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('manage-users', { body });
    if (error) {
      let message = error.message;
      try {
        const payload = await (error as any).context?.json?.();
        if (payload?.error) message = payload.error;
      } catch { /* resposta sem JSON */ }
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const createMember = useCallback(async (input: { email: string; name: string; password: string; role: StoreRole; permissions: AppView[] }) => {
    const storeId = requireStore();
    const data = await callManageUsers({
      action: 'create_member',
      store_id: storeId,
      email: input.email,
      name: input.name,
      password: input.password,
      role: input.role,
      permissions: input.role === 'SELLER' ? input.permissions : [],
    });
    return { existingAccount: !!data?.existing_account, temporaryPassword: (data?.temporary_password as string) || null };
  }, [legacyMode, activeStoreId]);

  const setMemberPassword = useCallback(async (userId: string, password: string) => {
    const storeId = requireStore();
    const data = await callManageUsers({ action: 'set_password', store_id: storeId, user_id: userId, password });
    return (data?.temporary_password as string) || null;
  }, [legacyMode, activeStoreId]);

  const updateMember = useCallback(async (userId: string, memberRole: StoreRole, permissions: AppView[]) => {
    const storeId = requireStore();
    const { error } = await supabase.rpc('update_store_member', {
      p_store: storeId, p_user: userId, p_role: memberRole, p_permissions: permissions,
    });
    if (error) throw new Error(error.message);
    if (userId === user?.id) await reload();
  }, [legacyMode, activeStoreId, user, reload]);

  const removeMember = useCallback(async (userId: string) => {
    const storeId = requireStore();
    const { error } = await supabase.rpc('remove_store_member', { p_store: storeId, p_user: userId });
    if (error) throw new Error(error.message);
    if (userId === user?.id) await reload();
  }, [legacyMode, activeStoreId, user, reload]);

  // Quando o tempo acaba com o app aberto, recarrega e o app cai na tela de acesso expirado.
  useEffect(() => {
    if (!subscription?.accessOk || !subscription.endsAt) return;
    const wait = subscription.endsAt.getTime() - Date.now();
    const timer = window.setTimeout(() => { reload(); }, Math.min(Math.max(wait, 0) + 1500, 2_000_000_000));
    return () => window.clearTimeout(timer);
  }, [subscription, reload]);

  // Aplica a cor da loja ativa; ao sair/trocar para loja sem cor, volta ao padrão.
  useEffect(() => {
    applyBrandColor(brandColor);
  }, [brandColor]);
  useEffect(() => {
    if (!user) applyBrandColor(null);
  }, [user]);

  const setBrandColor = useCallback(async (hex: string | null) => {
    if (legacyMode || !activeStoreId) throw new Error('Aplique a migração multi-loja para personalizar a cor.');
    const clean = hex ? normalizeHex(hex) : null;
    if (hex && !clean) throw new Error('Cor inválida. Use o formato #rrggbb.');
    // A RPC valida dono/gerente/admin no banco (a tabela store_modules só aceita escrita do admin).
    const { error } = await supabase.rpc('set_store_brand', { p_store_id: activeStoreId, p_color: clean });
    if (error) throw new Error(error.message);
    setBrandColorState(clean);
  }, [legacyMode, activeStoreId]);

  const toDate = (v: string | null) => (v ? new Date(v) : null);

  const adminListClients = useCallback(async (): Promise<ClientRow[]> => {
    const { data, error } = await supabase.rpc('admin_list_clients');
    if (error) throw new Error(error.message);
    return (data || []).map((c: any) => ({
      storeId: c.store_id,
      name: c.name,
      contactEmail: c.contact_email,
      ownerEmail: c.owner_email,
      plan: c.plan,
      notes: c.notes,
      status: c.status,
      effectiveStatus: c.effective_status,
      trialEndsAt: toDate(c.trial_ends_at),
      validUntil: toDate(c.valid_until),
      modules: c.modules || [],
      createdAt: c.created_at,
    }));
  }, []);

  const adminCreateClient = useCallback(async (input: CreateClientInput) => {
    const { data, error } = await supabase.rpc('admin_create_client', {
      p_email: input.email.trim(),
      p_store_name: input.storeName.trim(),
      p_modules: input.modules,
      p_mode: input.mode,
      p_hours: input.hours ?? null,
      p_days: input.days ?? null,
      p_plan: input.plan?.trim() || null,
      p_notes: input.notes?.trim() || null,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    const storeId = row.store_id as string;
    let accountCreated = false;
    let temporaryPassword: string | null = null;
    if (!row.account_exists) {
      const created = await callManageUsers({
        action: 'create_member',
        store_id: storeId,
        email: input.email.trim(),
        name: input.ownerName?.trim() || input.storeName.trim(),
        password: input.password || undefined,
        role: 'OWNER',
        permissions: [],
      });
      accountCreated = true;
      temporaryPassword = (created?.temporary_password as string) || null;
    }
    return { storeId, accountCreated, temporaryPassword };
  }, []);

  const adminExtend = useCallback(async (storeId: string, amount: { hours?: number; days?: number }) => {
    const { error } = await supabase.rpc('admin_extend', {
      p_store: storeId, p_hours: amount.hours ?? null, p_days: amount.days ?? null,
    });
    if (error) throw new Error(error.message);
  }, []);

  const adminSetStatus = useCallback(async (
    storeId: string, status: SubscriptionStatus, opts?: { hours?: number; days?: number; unlimited?: boolean },
  ) => {
    const { error } = await supabase.rpc('admin_set_status', {
      p_store: storeId, p_status: status,
      p_hours: opts?.hours ?? null, p_days: opts?.days ?? null, p_unlimited: !!opts?.unlimited,
    });
    if (error) throw new Error(error.message);
  }, []);

  return (
    <StoreContext.Provider value={{
      status,
      legacyMode,
      stores,
      activeStore,
      role,
      isManager,
      isPlatformAdmin,
      brandColor,
      setBrandColor,
      subscription,
      adminListClients,
      adminCreateClient,
      adminExtend,
      adminSetStatus,
      moduleStates,
      isModuleEnabled,
      canAccessView,
      switchStore,
      createStore,
      setModuleEnabled,
      listMembers,
      createMember,
      setMemberPassword,
      updateMember,
      removeMember,
      reload,
    }}>
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within a StoreProvider');
  return ctx;
};

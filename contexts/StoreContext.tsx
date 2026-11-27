import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { AppView } from '../types';
import { applyBrandColor, normalizeHex } from '../lib/brand';
import { canImpersonate, effectiveImpersonation } from '../lib/privacy';
import {
  StoreMember,
  createStoreMember,
  listStoreMembers,
  removeStoreMember,
  setStoreMemberPassword,
  updateStoreMember,
} from '../lib/teamApi';
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

export type { StoreMember } from '../lib/teamApi';

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

interface StoreContextValue {
  status: StoreStatus;
  /** true enquanto a migração 003 não foi aplicada: uma loja única, todos os módulos padrão. */
  legacyMode: boolean;
  stores: StoreSummary[];
  activeStore: StoreSummary | null;
  role: StoreRole | null;
  isManager: boolean;
  isPlatformAdmin: boolean;
  impersonatedStore: StoreSummary | null;
  /** Só o dono do SaaS (is_platform_admin). Sem limite de tempo e sem log (decisão 36). */
  startImpersonation: (storeId: string, storeName?: string) => Promise<void>;
  stopImpersonation: () => Promise<void>;
  /** Cor da marca da loja ativa (#rrggbb) ou null = paleta padrão. */
  brandColor: string | null;
  setBrandColor: (hex: string | null) => Promise<void>;
  /** Assinatura da loja ativa (null no modo legado ou antes da migração 006). */
  subscription: Subscription | null;
  moduleStates: Record<ModuleKey, boolean>;
  isModuleEnabled: (key: ModuleKey) => boolean;
  canAccessView: (view: AppView) => boolean;
  switchStore: (storeId: string) => Promise<void>;
  createStore: (name: string, enabledModules?: ModuleKey[]) => Promise<string | null>;
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
  const [storedImpersonation, setImpersonatedStore] = useState<StoreSummary | null>(() => {
    if (typeof window === 'undefined') return null;
    const saved = sessionStorage.getItem('GESTAO_PRO_IMPERSONATED_STORE');
    if (saved) {
      try { return JSON.parse(saved); } catch (_) { return null; }
    }
    return null;
  });
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [brandColor, setBrandColorState] = useState<string | null>(null);
  const [storedModules, setStoredModules] = useState<Partial<Record<ModuleKey, boolean>>>({});

  const loadModules = useCallback(async (storeId: string) => {
    // Módulos: só pela RPC store_module_enabled (plano + overrides + core). Nunca pela tabela store_modules.
    const results = await Promise.all(MODULES.map(async m => {
      const { data, error } = await supabase.rpc('store_module_enabled', { p_store: storeId, p_module: m.key });
      if (error) throw error;
      return [m.key, !!data] as const;
    })).catch(err => {
      console.error('STORE: erro ao carregar módulos', err);
      return null;
    });
    setStoredModules(results ? (Object.fromEntries(results) as Partial<Record<ModuleKey, boolean>>) : {});

    // Cor da marca: acesso ('brand') por store_module_enabled e valor pela RPC store_brand_color (migração 047).
    const { data: brandOn, error: brandErr } = await supabase.rpc('store_module_enabled', { p_store: storeId, p_module: BRAND_ROW_KEY });
    if (brandErr || !brandOn) {
      setBrandColorState(null);
      return;
    }
    const { data: colorData, error: colorErr } = await supabase.rpc('store_brand_color', { p_store: storeId });
    setBrandColorState(!colorErr && colorData ? normalizeHex(String(colorData)) : null);
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

  // Valor salvo no navegador só vale para o dono do SaaS (decisão 36).
  const impersonatedStore = effectiveImpersonation(storedImpersonation, isPlatformAdmin);

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

  // Criação de loja: só cria a loja. Os módulos vêm do plano (no servidor), não de uma escrita direta.
  // O parâmetro de módulos é ignorado; a tela de Admin não escreve em store_modules.
  const createStore = useCallback(async (name: string, _enabledModules?: ModuleKey[]) => {
    if (legacyMode) throw new Error('Aplique a migração multi-loja antes de criar lojas.');
    const { data, error } = await supabase.rpc('create_store', { p_name: name });
    if (error) throw new Error(error.message);
    const storeId = data as string;
    await reload();
    return storeId;
  }, [legacyMode, reload]);

  const requireStore = () => {
    if (legacyMode) throw new Error('Aplique a migração multi-loja para gerenciar a equipe.');
    if (!activeStoreId) throw new Error('Nenhuma loja selecionada.');
    return activeStoreId;
  };

  const listMembers = useCallback(async (): Promise<StoreMember[]> => {
    if (legacyMode || !activeStoreId) return [];
    return listStoreMembers(activeStoreId);
  }, [legacyMode, activeStoreId]);

  const createMember = useCallback(async (input: { email: string; name: string; password: string; role: StoreRole; permissions: AppView[] }) => {
    return createStoreMember(requireStore(), input);
  }, [legacyMode, activeStoreId]);

  const setMemberPassword = useCallback(async (userId: string, password: string) => {
    return setStoreMemberPassword(requireStore(), userId, password);
  }, [legacyMode, activeStoreId]);

  const updateMember = useCallback(async (userId: string, memberRole: StoreRole, permissions: AppView[]) => {
    await updateStoreMember(requireStore(), userId, memberRole, permissions);
    if (userId === user?.id) await reload();
  }, [legacyMode, activeStoreId, user, reload]);

  const removeMember = useCallback(async (userId: string) => {
    await removeStoreMember(requireStore(), userId);
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

  const startImpersonation = useCallback(async (storeId: string, storeName?: string) => {
    if (!canImpersonate(isPlatformAdmin)) throw new Error('Só o administrador da plataforma abre outra loja.');
    await switchStore(storeId);
    const known = stores.find(s => s.id === storeId);
    const target: StoreSummary = known
      ? { ...known, name: storeName || known.name }
      : { id: storeId, name: storeName || 'Loja', role: 'OWNER', permissions: [] as AppView[] };
    setImpersonatedStore(target);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('GESTAO_PRO_IMPERSONATED_STORE', JSON.stringify(target));
    }
  }, [stores, switchStore, isPlatformAdmin]);

  const stopImpersonation = useCallback(async () => {
    setImpersonatedStore(null);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('GESTAO_PRO_IMPERSONATED_STORE');
    }
    await reload();
  }, [reload]);

  return (
    <StoreContext.Provider value={{
      status,
      legacyMode,
      stores,
      activeStore,
      role,
      isManager,
      isPlatformAdmin,
      impersonatedStore,
      startImpersonation,
      stopImpersonation,
      brandColor,
      setBrandColor,
      subscription,
      moduleStates,
      isModuleEnabled,
      canAccessView,
      switchStore,
      createStore,
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

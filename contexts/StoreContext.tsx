import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { AppView } from '../types';
import {
  MANAGER_ONLY_VIEWS,
  MODULES,
  ModuleKey,
  SELLER_DEFAULT_VIEWS,
  StoreRole,
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

interface StoreContextValue {
  status: StoreStatus;
  /** true enquanto a migração 003 não foi aplicada: uma loja única, todos os módulos padrão. */
  legacyMode: boolean;
  stores: StoreSummary[];
  activeStore: StoreSummary | null;
  role: StoreRole | null;
  isManager: boolean;
  isPlatformAdmin: boolean;
  moduleStates: Record<ModuleKey, boolean>;
  isModuleEnabled: (key: ModuleKey) => boolean;
  canAccessView: (view: AppView) => boolean;
  switchStore: (storeId: string) => Promise<void>;
  createStore: (name: string, enabledModules?: ModuleKey[]) => Promise<string | null>;
  setModuleEnabled: (key: ModuleKey, enabled: boolean) => Promise<void>;
  listMembers: () => Promise<StoreMember[]>;
  addMember: (email: string, role: StoreRole, permissions: AppView[]) => Promise<void>;
  updateMember: (userId: string, role: StoreRole, permissions: AppView[]) => Promise<void>;
  removeMember: (userId: string) => Promise<void>;
  reload: () => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | undefined>(undefined);

const LEGACY_STORE_ID = 'legacy';

const isMissingFunction = (error: any) =>
  !!error && (error.code === 'PGRST202' || error.code === '42883' || /function .* does not exist|Could not find the function/i.test(error.message || ''));

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [status, setStatus] = useState<StoreStatus>('loading');
  const [legacyMode, setLegacyMode] = useState(false);
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [storedModules, setStoredModules] = useState<Partial<Record<ModuleKey, boolean>>>({});

  const loadModules = useCallback(async (storeId: string) => {
    const { data, error } = await supabase.from('store_modules').select('module_key, enabled').eq('store_id', storeId);
    if (error) {
      console.error('STORE: erro ao carregar módulos', error);
      setStoredModules({});
      return;
    }
    const map: Partial<Record<ModuleKey, boolean>> = {};
    for (const row of data || []) map[row.module_key as ModuleKey] = !!row.enabled;
    setStoredModules(map);
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

    let active = (data || []).find((s: any) => s.is_active_store)?.id as string | undefined;
    if (!active) {
      // Usuário sem loja ativa (ex.: acabou de ser adicionado): usa a primeira.
      active = list[0].id;
      await supabase.rpc('set_active_store', { p_store: active });
    }
    setActiveStoreId(active);
    await loadModules(active);
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

  const canAccessView = useCallback((view: AppView) => {
    const mod = moduleForView(view);
    if (mod && !moduleStates[mod.key]) return false;
    if (!role) return false;
    if (role === 'OWNER' || role === 'MANAGER') return true;
    if (MANAGER_ONLY_VIEWS.includes(view)) return false;
    const allowed = activeStore?.permissions?.length ? activeStore.permissions : SELLER_DEFAULT_VIEWS;
    return allowed.includes(view);
  }, [moduleStates, role, activeStore]);

  const switchStore = useCallback(async (storeId: string) => {
    if (legacyMode || storeId === activeStoreId) return;
    const { error } = await supabase.rpc('set_active_store', { p_store: storeId });
    if (error) throw new Error(error.message);
    setActiveStoreId(storeId);
    await loadModules(storeId);
  }, [legacyMode, activeStoreId, loadModules]);

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

  const addMember = useCallback(async (email: string, memberRole: StoreRole, permissions: AppView[]) => {
    const storeId = requireStore();
    const { error } = await supabase.rpc('add_store_member', {
      p_store: storeId, p_email: email, p_role: memberRole, p_permissions: permissions,
    });
    if (error) throw new Error(error.message);
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

  return (
    <StoreContext.Provider value={{
      status,
      legacyMode,
      stores,
      activeStore,
      role,
      isManager,
      isPlatformAdmin,
      moduleStates,
      isModuleEnabled,
      canAccessView,
      switchStore,
      createStore,
      setModuleEnabled,
      listMembers,
      addMember,
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

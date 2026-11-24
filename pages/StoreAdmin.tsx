import React, { useCallback, useEffect, useState } from 'react';
import { Boxes, Users, Store, Trash2, Plus, Lock, AlertTriangle, Check } from 'lucide-react';
import { Card, Button, Input, Select, Badge } from '../components/UI';
import { useAppStore } from '../store';
import { useStore, StoreMember } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { AppView } from '../types';
import {
  MODULES,
  MODULE_CATEGORIES,
  ModuleKey,
  ROLE_LABELS,
  SELLER_ASSIGNABLE_VIEWS,
  SELLER_DEFAULT_VIEWS,
  StoreRole,
  dependentsOf,
  getModule,
} from '../lib/modules';

type Tab = 'MODULES' | 'TEAM' | 'STORES';

const ROLE_HELP: Record<StoreRole, string> = {
  OWNER: 'Acesso a todas as telas da loja (vendas, financeiro, configurações). Não cria lojas nem mexe em módulos ou equipe.',
  MANAGER: 'Mesmo acesso do dono dentro da loja.',
  SELLER: 'Vê só as próprias vendas e orçamentos e as telas marcadas.',
};

/** Caixas de seleção das telas liberadas para um vendedor. */
const PermissionPicker: React.FC<{
  value: AppView[];
  onChange: (v: AppView[]) => void;
  isViewAvailable: (v: AppView) => boolean;
}> = ({ value, onChange, isViewAvailable }) => {
  const toggle = (view: AppView) =>
    onChange(value.includes(view) ? value.filter(v => v !== view) : [...value, view]);
  return (
    <fieldset>
      <legend className="text-xs font-semibold text-wine-700 dark:text-slate-300 uppercase mb-2">
        Telas liberadas para o vendedor
      </legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SELLER_ASSIGNABLE_VIEWS.map(v => {
          const available = isViewAvailable(v.view);
          return (
            <label
              key={v.view}
              className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 border border-wine-100 dark:border-slate-700 ${available ? 'cursor-pointer text-wine-900 dark:text-slate-200' : 'opacity-50 cursor-not-allowed text-wine-500'}`}
              title={available ? undefined : 'Módulo desligado nesta loja'}
            >
              <input
                type="checkbox"
                checked={value.includes(v.view)}
                disabled={!available}
                onChange={() => toggle(v.view)}
                className="accent-wine-700"
              />
              {v.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};

export const StoreAdmin: React.FC = () => {
  const { addNotification } = useAppStore();
  const { user } = useAuth();
  const {
    legacyMode, stores, activeStore, isPlatformAdmin, moduleStates,
    setModuleEnabled, listMembers, addMember, updateMember, removeMember, switchStore, createStore,
  } = useStore();

  const [tab, setTab] = useState<Tab>('MODULES');
  const [busyModule, setBusyModule] = useState<ModuleKey | null>(null);

  // Equipe
  const [members, setMembers] = useState<StoreMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<StoreRole>('SELLER');
  const [newPermissions, setNewPermissions] = useState<AppView[]>(SELLER_DEFAULT_VIEWS);
  const [editing, setEditing] = useState<StoreMember | null>(null);

  // Lojas
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreModules, setNewStoreModules] = useState<ModuleKey[]>(
    MODULES.filter(m => !m.core && m.defaultEnabled).map(m => m.key)
  );
  const [creatingStore, setCreatingStore] = useState(false);

  const isViewAvailable = (view: AppView) => {
    const mod = MODULES.find(m => m.views.some(v => v.view === view));
    return !mod || moduleStates[mod.key];
  };

  const refreshMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      setMembers(await listMembers());
    } catch (err: any) {
      addNotification(err.message, 'error');
    } finally {
      setLoadingMembers(false);
    }
  }, [listMembers]);

  useEffect(() => {
    if (tab === 'TEAM') refreshMembers();
  }, [tab, activeStore?.id]);

  const handleToggleModule = async (key: ModuleKey, enabled: boolean) => {
    if (!enabled) {
      const affected = dependentsOf(key).filter(k => moduleStates[k]);
      if (affected.length > 0) {
        const names = affected.map(k => getModule(k).name).join(', ');
        if (!window.confirm(`Desligar ${getModule(key).name} também desliga: ${names}. Continuar?`)) return;
      }
    }
    setBusyModule(key);
    try {
      await setModuleEnabled(key, enabled);
      addNotification(`${getModule(key).name} ${enabled ? 'ligado' : 'desligado'}.`, 'success');
    } catch (err: any) {
      addNotification(err.message, 'error');
    } finally {
      setBusyModule(null);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addMember(newEmail.trim(), newRole, newRole === 'SELLER' ? newPermissions : []);
      addNotification(`${newEmail} adicionado à equipe.`, 'success');
      setNewEmail('');
      setNewRole('SELLER');
      setNewPermissions(SELLER_DEFAULT_VIEWS);
      refreshMembers();
    } catch (err: any) {
      addNotification(err.message, 'error');
    }
  };

  const handleSaveMember = async () => {
    if (!editing) return;
    try {
      await updateMember(editing.userId, editing.role, editing.role === 'SELLER' ? editing.permissions : []);
      addNotification('Permissões atualizadas.', 'success');
      setEditing(null);
      refreshMembers();
    } catch (err: any) {
      addNotification(err.message, 'error');
    }
  };

  const handleRemoveMember = async (m: StoreMember) => {
    if (!window.confirm(`Remover ${m.email} desta loja? A pessoa perde o acesso a ela.`)) return;
    try {
      await removeMember(m.userId);
      addNotification(`${m.email} removido.`, 'success');
      refreshMembers();
    } catch (err: any) {
      addNotification(err.message, 'error');
    }
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingStore(true);
    try {
      await createStore(newStoreName.trim(), newStoreModules);
      addNotification(`Loja "${newStoreName}" criada. Você já está usando ela.`, 'success');
      setNewStoreName('');
    } catch (err: any) {
      addNotification(err.message, 'error');
    } finally {
      setCreatingStore(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'MODULES', label: 'Módulos', icon: <Boxes size={18} /> },
    { id: 'TEAM', label: 'Equipe', icon: <Users size={18} /> },
    { id: 'STORES', label: 'Lojas', icon: <Store size={18} /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-wine-950 dark:text-white">Administração da Plataforma</h1>
        <p className="text-wine-600 dark:text-slate-400">
          Loja selecionada: <strong>{activeStore?.name}</strong>. Só o administrador da plataforma vê esta tela;
          donos e gerentes de loja não têm acesso.
        </p>
      </div>

      {legacyMode && (
        <div className="flex gap-3 items-start p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200">
          <AlertTriangle size={20} className="shrink-0 mt-0.5" />
          <p className="text-sm">
            O banco ainda não tem a estrutura multi-loja. Aplique a migração
            <code className="mx-1 font-mono">003_multi_store_modules.sql</code>
            no Supabase para ligar módulos, montar a equipe e criar lojas. Até lá,
            todos os módulos ficam ligados.
          </p>
        </div>
      )}

      <div className="flex gap-2 border-b border-wine-100 dark:border-slate-700 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-3 rounded-t-lg font-medium transition-colors whitespace-nowrap ${tab === t.id
              ? 'bg-white dark:bg-slate-800 text-wine-900 dark:text-white border border-b-0 border-wine-100 dark:border-slate-700'
              : 'text-wine-600 dark:text-slate-400 hover:text-wine-900 dark:hover:text-white'}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* MÓDULOS */}
      {tab === 'MODULES' && (
        <div className="space-y-6">
          <p className="text-sm text-wine-600 dark:text-slate-400">
            Desligar um módulo tira as telas dele do menu e para as automações que ele faz.
            Por exemplo, sem Entregas a venda vira sempre "retirada na loja" e nenhum agendamento é criado.
            Nenhum dado é apagado: ao religar, tudo volta.
          </p>
          {MODULE_CATEGORIES.map(cat => {
            const mods = MODULES.filter(m => m.category === cat.key);
            if (mods.length === 0) return null;
            return (
              <Card key={cat.key} title={cat.label}>
                <ul className="divide-y divide-wine-50 dark:divide-slate-700">
                  {mods.map(m => {
                    const enabled = moduleStates[m.key];
                    const missingDeps = (m.dependsOn || []).filter(d => !moduleStates[d]);
                    return (
                      <li key={m.key} className="flex items-start justify-between gap-4 py-4">
                        <div className="min-w-0">
                          <p className="font-semibold text-wine-950 dark:text-white flex items-center gap-2">
                            {m.name}
                            {m.core && <Badge color="gray">Essencial</Badge>}
                          </p>
                          <p className="text-sm text-wine-600 dark:text-slate-400">{m.description}</p>
                          {m.dependsOn && (
                            <p className="text-xs text-wine-500 dark:text-slate-500 mt-1">
                              Precisa de: {m.dependsOn.map(d => getModule(d).name).join(', ')}
                              {missingDeps.length > 0 && ' (ao ligar, ele também será ligado)'}
                            </p>
                          )}
                        </div>
                        {m.core ? (
                          <span className="flex items-center gap-1 text-xs text-wine-500 dark:text-slate-400 shrink-0 mt-1">
                            <Lock size={14} /> Sempre ligado
                          </span>
                        ) : (
                          <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={enabled}
                              disabled={legacyMode || busyModule === m.key}
                              onChange={e => handleToggleModule(m.key, e.target.checked)}
                              aria-label={`${enabled ? 'Desligar' : 'Ligar'} ${m.name}`}
                            />
                            <div className="w-11 h-6 bg-wine-200 dark:bg-slate-600 rounded-full peer-checked:bg-emerald-600 peer-disabled:opacity-50 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:after:translate-x-5" />
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {/* EQUIPE */}
      {tab === 'TEAM' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <Card title="Pessoas nesta loja" className="xl:col-span-2">
            {loadingMembers ? (
              <p className="text-sm text-wine-500">Carregando...</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-wine-500">{legacyMode ? 'Disponível após a migração multi-loja.' : 'Ninguém na equipe ainda.'}</p>
            ) : (
              <ul className="divide-y divide-wine-50 dark:divide-slate-700">
                {members.map(m => (
                  <li key={m.userId} className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-wine-950 dark:text-white truncate">
                          {m.name}{m.userId === user?.id && ' (você)'}
                        </p>
                        <p className="text-sm text-wine-600 dark:text-slate-400 truncate">{m.email}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge color={m.role === 'OWNER' ? 'red' : m.role === 'MANAGER' ? 'blue' : 'green'}>{ROLE_LABELS[m.role]}</Badge>
                          {m.role === 'SELLER' && (
                            <span className="text-xs text-wine-500 dark:text-slate-400">
                              {(m.permissions.length ? m.permissions : SELLER_DEFAULT_VIEWS)
                                .map(v => SELLER_ASSIGNABLE_VIEWS.find(x => x.view === v)?.label)
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button variant="outline" onClick={() => setEditing({ ...m, permissions: m.permissions.length ? m.permissions : SELLER_DEFAULT_VIEWS })}>
                          Editar
                        </Button>
                        <Button variant="danger" onClick={() => handleRemoveMember(m)} aria-label={`Remover ${m.email}`}>
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </div>

                    {editing?.userId === m.userId && (
                      <div className="mt-4 p-4 rounded-xl bg-wine-50/60 dark:bg-slate-900/40 space-y-4">
                        <Select
                          label="Papel"
                          value={editing.role}
                          onChange={e => setEditing({ ...editing, role: e.target.value as StoreRole })}
                        >
                          {(['OWNER', 'MANAGER', 'SELLER'] as StoreRole[]).map(r => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </Select>
                        <p className="text-xs text-wine-600 dark:text-slate-400">{ROLE_HELP[editing.role]}</p>
                        {editing.role === 'SELLER' && (
                          <PermissionPicker
                            value={editing.permissions}
                            onChange={permissions => setEditing({ ...editing, permissions })}
                            isViewAvailable={isViewAvailable}
                          />
                        )}
                        <div className="flex gap-2 justify-end">
                          <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
                          <Button onClick={handleSaveMember}><Check size={16} /> Salvar</Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Adicionar pessoa">
            <form onSubmit={handleAddMember} className="space-y-4">
              <Input
                label="E-mail"
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                required
                disabled={legacyMode}
              />
              <p className="text-xs text-wine-500 dark:text-slate-400 -mt-2">
                A pessoa precisa ter criado a conta na tela de login antes.
              </p>
              <Select label="Papel" value={newRole} onChange={e => setNewRole(e.target.value as StoreRole)} disabled={legacyMode}>
                {(['SELLER', 'MANAGER', 'OWNER'] as StoreRole[])
                  .map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </Select>
              <p className="text-xs text-wine-600 dark:text-slate-400">{ROLE_HELP[newRole]}</p>
              {newRole === 'SELLER' && (
                <PermissionPicker value={newPermissions} onChange={setNewPermissions} isViewAvailable={isViewAvailable} />
              )}
              <Button type="submit" className="w-full" disabled={legacyMode || !newEmail.trim()}>
                <Plus size={16} /> Adicionar
              </Button>
            </form>
          </Card>
        </div>
      )}

      {/* LOJAS */}
      {tab === 'STORES' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card title="Suas lojas">
            <ul className="divide-y divide-wine-50 dark:divide-slate-700">
              {stores.map(s => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-wine-950 dark:text-white truncate">{s.name}</p>
                    <p className="text-xs text-wine-500 dark:text-slate-400">{ROLE_LABELS[s.role]}</p>
                  </div>
                  {s.id === activeStore?.id ? (
                    <Badge color="green">Em uso</Badge>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          await switchStore(s.id);
                          addNotification(`Agora você está em ${s.name}.`, 'success');
                        } catch (err: any) {
                          addNotification(err.message, 'error');
                        }
                      }}
                    >
                      Usar esta loja
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {isPlatformAdmin && (
            <Card title="Criar nova loja">
              <form onSubmit={handleCreateStore} className="space-y-4">
                <Input
                  label="Nome da loja"
                  value={newStoreName}
                  onChange={e => setNewStoreName(e.target.value)}
                  required
                  disabled={legacyMode}
                />
                <fieldset>
                  <legend className="text-xs font-semibold text-wine-700 dark:text-slate-300 uppercase mb-2">
                    Módulos opcionais
                  </legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {MODULES.filter(m => !m.core).map(m => (
                      <label key={m.key} className="flex items-center gap-2 text-sm text-wine-900 dark:text-slate-200 rounded-lg px-3 py-2 border border-wine-100 dark:border-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          className="accent-wine-700"
                          checked={newStoreModules.includes(m.key)}
                          onChange={() => setNewStoreModules(prev =>
                            prev.includes(m.key) ? prev.filter(k => k !== m.key) : [...prev, m.key]
                          )}
                        />
                        {m.name}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-wine-500 dark:text-slate-400 mt-2">
                    Vendas, Clientes, Estoque, Dashboard e Configurações vêm sempre ligados.
                    Um módulo marcado sem a dependência dele fica desligado.
                  </p>
                </fieldset>
                <p className="text-xs text-wine-500 dark:text-slate-400">
                  Você passa a usar a loja nova na hora. Depois, em "Equipe", adicione o dono da loja pelo e-mail.
                </p>
                <Button type="submit" className="w-full" disabled={legacyMode || creatingStore || !newStoreName.trim()}>
                  <Plus size={16} /> {creatingStore ? 'Criando...' : 'Criar loja'}
                </Button>
              </form>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

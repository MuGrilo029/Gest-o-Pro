import React, { useState } from "react";
import { Boxes, Users, Store, Plus, Lock, AlertTriangle, Briefcase } from "lucide-react";
import { Card, Button, Input, Badge, confirmDialog } from '../components/UI';
import { TeamPanel } from "../components/TeamPanel";
import { ClientsPanel } from "../components/ClientsPanel";
import { useAppStore } from "../store";
import { useStore } from "../contexts/StoreContext";
import { MODULES, MODULE_CATEGORIES, ModuleKey, ROLE_LABELS, dependentsOf, getModule } from "../lib/modules";

type Tab = "CLIENTS" | "MODULES" | "TEAM" | "STORES";

export const StoreAdmin: React.FC = () => {
  const { addNotification } = useAppStore();
  const {
    legacyMode, stores, activeStore, isPlatformAdmin, moduleStates,
    setModuleEnabled, switchStore, createStore,
  } = useStore();

  const [tab, setTab] = useState<Tab>('CLIENTS');
  const [busyModule, setBusyModule] = useState<ModuleKey | null>(null);

  // Lojas
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreModules, setNewStoreModules] = useState<ModuleKey[]>(
    MODULES.filter(m => !m.core && m.defaultEnabled).map(m => m.key)
  );
  const [creatingStore, setCreatingStore] = useState(false);

  const handleToggleModule = async (key: ModuleKey, enabled: boolean) => {
    if (!enabled) {
      const affected = dependentsOf(key).filter(k => moduleStates[k]);
      if (affected.length > 0) {
        const names = affected.map(k => getModule(k).name).join(', ');
        if (!await confirmDialog(`Desligar ${getModule(key).name} também desliga: ${names}. Continuar?`)) return;
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
    { id: 'CLIENTS', label: 'Clientes', icon: <Briefcase size={18} /> },
    { id: 'MODULES', label: 'Módulos', icon: <Boxes size={18} /> },
    { id: 'TEAM', label: 'Equipe', icon: <Users size={18} /> },
    { id: 'STORES', label: 'Lojas', icon: <Store size={18} /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-wine-950 dark:text-white">Administração da Plataforma</h1>
        <p className="text-wine-600 dark:text-slate-400">
          Loja selecionada: <strong>{activeStore?.name}</strong> (as abas Módulos e Equipe valem para ela). Só o administrador da plataforma vê esta tela;
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

      {/* CLIENTES */}
      {tab === 'CLIENTS' && <ClientsPanel />}

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
      {tab === "TEAM" && <TeamPanel />}

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

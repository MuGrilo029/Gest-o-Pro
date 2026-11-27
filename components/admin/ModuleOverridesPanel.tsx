import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminModuleState, clearModuleOverride, fetchStoreModules, setModuleOverride } from '../../lib/adminApi';
import { MODULES } from '../../lib/modules';
import { alertDialog } from '../UI';

const NAME: Record<string, string> = { ...Object.fromEntries(MODULES.map(m => [m.key, m.name])), brand: 'Cor da marca' };

/**
 * Override de módulo por loja (decisão 17): só liga ou desliga, sem motivo nem validade.
 * Core (Dashboard, Vendas, Clientes, Estoque, Configurações) não muda (decisão 14).
 */
export const ModuleOverridesPanel: React.FC<{ storeId: string }> = ({ storeId }) => {
  const [mods, setMods] = useState<AdminModuleState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMods(await fetchStoreModules(storeId));
    } catch (e: any) {
      setMods(null);
      setError(e?.message || 'Não foi possível ler os módulos.');
    }
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const act = async (m: AdminModuleState, kind: 'on' | 'off' | 'plan') => {
    setBusyKey(m.key);
    try {
      if (kind === 'plan') await clearModuleOverride(storeId, m.key);
      else await setModuleOverride(storeId, m.key, kind === 'on');
      await load();
    } catch (e: any) {
      await alertDialog(e?.message || 'Não foi possível salvar. Nada foi alterado.', 'Erro');
    } finally {
      setBusyKey(null);
    }
  };

  if (error) return <p role="alert" className="text-red-700">{error}</p>;
  if (!mods) return <p className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Carregando módulos…</p>;

  return (
    <ul className="divide-y divide-wine-100 dark:divide-slate-700" data-testid="module-overrides">
      {mods.map(m => (
        <li key={m.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div className="min-w-0">
            <p className="font-medium text-wine-950 dark:text-white">{NAME[m.key] ?? m.key}</p>
            <p className="text-xs text-wine-500 dark:text-slate-400">
              {m.core ? 'Essencial: sempre ligado' : m.enabled ? 'Ligado' : 'Desligado'}
              {m.override === 'grant' && ' · ligado manualmente'}
              {m.override === 'revoke' && ' · desligado manualmente'}
            </p>
          </div>
          {!m.core && (
            <div className="flex gap-2">
              {m.enabled
                ? <button disabled={busyKey === m.key} onClick={() => act(m, 'off')} className="px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-semibold disabled:opacity-60" aria-label={`Desligar ${NAME[m.key] ?? m.key}`}>Desligar</button>
                : <button disabled={busyKey === m.key} onClick={() => act(m, 'on')} className="px-3 py-1.5 rounded-lg bg-wine-900 text-white text-xs font-semibold disabled:opacity-60" aria-label={`Ligar ${NAME[m.key] ?? m.key}`}>Ligar</button>}
              {m.override && (
                <button disabled={busyKey === m.key} onClick={() => act(m, 'plan')} className="px-3 py-1.5 rounded-lg border border-wine-200 dark:border-slate-600 text-xs disabled:opacity-60">Seguir o plano</button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
};

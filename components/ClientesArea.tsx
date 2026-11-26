import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCcw } from 'lucide-react';
import { useStore, ClientRow, SubscriptionStatus } from '../contexts/StoreContext';
import { confirmDialog, alertDialog } from './UI';
import { formatRemaining } from './SubscriptionBanner';

/**
 * Área de clientes (lojas) para o administrador da plataforma (rota #area-clientes).
 * Mostra status, tempo restante e plano; ações: Estender e Encerrar (suspender).
 * Usa as RPCs já existentes: admin_list_clients, admin_extend, admin_set_status.
 */

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trial: 'Teste',
  active: 'Ativo',
  expired: 'Vencido',
  suspended: 'Encerrado',
};

const STATUS_CLASS: Record<SubscriptionStatus, string> = {
  trial: 'bg-amber-100 text-amber-900',
  active: 'bg-emerald-100 text-emerald-900',
  expired: 'bg-red-100 text-red-900',
  suspended: 'bg-slate-200 text-slate-800',
};

const remainingLabel = (c: ClientRow, now: number): string => {
  const end = c.effectiveStatus === 'trial' ? c.trialEndsAt : c.validUntil;
  if (!end) return '—';
  const ms = end.getTime() - now;
  return ms <= 0 ? 'Terminou' : formatRemaining(ms);
};

export const ClientesArea: React.FC = () => {
  const { adminListClients, adminExtend, adminSetStatus } = useStore();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClients(await adminListClients());
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar as lojas.');
    } finally {
      setLoading(false);
    }
  }, [adminListClients]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);

  const extend = async (c: ClientRow) => {
    setBusyId(c.storeId);
    try {
      await adminExtend(c.storeId, { days: 7 });
      await load();
    } catch (e: any) {
      await alertDialog(e?.message || 'Não foi possível estender.', 'Erro');
    } finally {
      setBusyId(null);
    }
  };

  const close = async (c: ClientRow) => {
    const ok = await confirmDialog(`Encerrar o acesso de "${c.name}"? A loja fica bloqueada até ser reativada.`, { title: 'Encerrar loja', danger: true, confirmLabel: 'Encerrar' });
    if (!ok) return;
    setBusyId(c.storeId);
    try {
      await adminSetStatus(c.storeId, 'suspended');
      await load();
    } catch (e: any) {
      await alertDialog(e?.message || 'Não foi possível encerrar.', 'Erro');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-wine-50 dark:bg-slate-900 px-4 py-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-wine-950 dark:text-white">Clientes (lojas)</h1>
            <p className="text-sm text-wine-600 dark:text-slate-400">Área do administrador da plataforma.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-wine-200 dark:border-slate-600 text-sm text-wine-800 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800">
              <RefreshCcw size={14} aria-hidden="true" /> Atualizar
            </button>
            <button onClick={() => { window.location.hash = ''; }} className="px-3 py-2 rounded-lg text-sm text-wine-800 dark:text-slate-200 hover:underline">
              Voltar
            </button>
          </div>
        </header>

        {loading && (
          <p className="flex items-center gap-2 text-wine-600 dark:text-slate-400"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Carregando lojas...</p>
        )}
        {error && <p role="alert" className="text-sm text-red-600 mb-4">{error}</p>}
        {!loading && !error && clients.length === 0 && (
          <p className="text-wine-600 dark:text-slate-400">Nenhuma loja cadastrada.</p>
        )}

        {/* Celular: cartões. Desktop: tabela. */}
        <div className="space-y-3 md:hidden">
          {clients.map(c => (
            <article key={c.storeId} className="bg-white dark:bg-slate-800 rounded-xl border border-wine-100 dark:border-slate-700 p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-wine-950 dark:text-white">{c.name}</h2>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_CLASS[c.effectiveStatus]}`}>{STATUS_LABEL[c.effectiveStatus]}</span>
              </div>
              <dl className="mt-2 text-sm text-wine-700 dark:text-slate-300 space-y-1">
                <div><dt className="inline text-wine-500">Restante: </dt><dd className="inline">{remainingLabel(c, now)}</dd></div>
                <div><dt className="inline text-wine-500">Plano: </dt><dd className="inline">{c.plan || '—'}</dd></div>
              </dl>
              <div className="mt-3 flex gap-2">
                <button disabled={busyId === c.storeId} onClick={() => extend(c)} className="flex-1 py-2 rounded-lg bg-wine-900 text-white text-sm font-semibold disabled:opacity-60">Estender 7 dias</button>
                <button disabled={busyId === c.storeId} onClick={() => close(c)} className="flex-1 py-2 rounded-lg border border-red-300 text-red-700 text-sm font-semibold disabled:opacity-60">Encerrar</button>
              </div>
            </article>
          ))}
        </div>

        {clients.length > 0 && (
          <div className="hidden md:block overflow-x-auto bg-white dark:bg-slate-800 rounded-xl border border-wine-100 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-wine-50 dark:bg-slate-900 text-left text-wine-700 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-semibold">Loja</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Restante</th>
                  <th className="px-4 py-3 font-semibold">Plano</th>
                  <th className="px-4 py-3 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.storeId} className="border-t border-wine-100 dark:border-slate-700">
                    <td className="px-4 py-3 font-medium text-wine-950 dark:text-white">{c.name}</td>
                    <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_CLASS[c.effectiveStatus]}`}>{STATUS_LABEL[c.effectiveStatus]}</span></td>
                    <td className="px-4 py-3 text-wine-700 dark:text-slate-300">{remainingLabel(c, now)}</td>
                    <td className="px-4 py-3 text-wine-700 dark:text-slate-300">{c.plan || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button disabled={busyId === c.storeId} onClick={() => extend(c)} className="px-3 py-1.5 rounded-lg bg-wine-900 text-white text-xs font-semibold disabled:opacity-60">Estender 7 dias</button>
                        <button disabled={busyId === c.storeId} onClick={() => close(c)} className="px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-semibold disabled:opacity-60">Encerrar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

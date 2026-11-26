import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCcw, X } from 'lucide-react';
import { useStore, ClientRow, SubscriptionStatus } from '../contexts/StoreContext';
import { confirmDialog, alertDialog } from './UI';
import { formatRemaining } from './SubscriptionBanner';
import { MODULES } from '../lib/modules';

/**
 * Admin de lojas (rota #area-clientes, só admin da plataforma). Segue admin-plano/03-produto-ux.md.
 * Dados reais: admin_list_clients, admin_extend, admin_set_status.
 * Sem RPC ainda: overrides de módulo, pagamentos do Asaas e auditoria (mostram estado "indisponível").
 * O painel antigo (Clientes & Lojas) continua disponível e não foi alterado.
 */

type Tab = 'resumo' | 'plano' | 'assinatura' | 'teste' | 'auditoria';
const TABS: { id: Tab; label: string }[] = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'plano', label: 'Plano e módulos' },
  { id: 'assinatura', label: 'Assinatura e pagamentos' },
  { id: 'teste', label: 'Teste e prazo' },
  { id: 'auditoria', label: 'Auditoria' },
];

const PAGE_SIZE = 25;
const DAY = 86400000;

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trial: 'Em teste',
  active: 'Ativa',
  expired: 'Atrasada',
  suspended: 'Suspensa',
};
const STATUS_CLASS: Record<SubscriptionStatus, string> = {
  trial: 'bg-amber-100 text-amber-900',
  active: 'bg-emerald-100 text-emerald-900',
  expired: 'bg-red-100 text-red-900',
  suspended: 'bg-slate-200 text-slate-800',
};
const PLAN_LABEL: Record<string, string> = { inicio: 'Início', crescimento: 'Crescimento', avancado: 'Avançado', trial: 'Teste' };

const endOf = (c: ClientRow): Date | null => (c.effectiveStatus === 'trial' ? c.trialEndsAt : c.validUntil);

const remainingText = (c: ClientRow, now: number): string => {
  const end = endOf(c);
  if (!end) return 'Sem vencimento';
  const ms = end.getTime() - now;
  return ms <= 0 ? 'Vencido' : formatRemaining(ms);
};

const dueGroup = (c: ClientRow, now: number): number => {
  if (c.effectiveStatus === 'expired') return 0;
  const end = endOf(c);
  if (end && end.getTime() - now <= 7 * DAY) return 1;
  return 2;
};

const StatusBadge: React.FC<{ status: SubscriptionStatus }> = ({ status }) => (
  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
);

export const ClientesArea: React.FC = () => {
  const { adminListClients, adminExtend, adminSetStatus } = useStore();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | SubscriptionStatus>('');
  const [dueFilter, setDueFilter] = useState<'' | 'week' | 'expired' | 'none'>('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('resumo');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClients(await adminListClients());
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar as lojas. Verifique sua conexão.');
    } finally {
      setLoading(false);
    }
  }, [adminListClients]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = clients.filter(c => {
      if (q && !(c.name.toLowerCase().includes(q) || (c.ownerEmail || '').toLowerCase().includes(q))) return false;
      if (planFilter && (c.plan || '') !== planFilter) return false;
      if (statusFilter && c.effectiveStatus !== statusFilter) return false;
      if (dueFilter === 'expired' && c.effectiveStatus !== 'expired') return false;
      if (dueFilter === 'week' && dueGroup(c, now) !== 1) return false;
      if (dueFilter === 'none' && endOf(c) !== null) return false;
      return true;
    });
    // Ordem: atrasadas, vencem em até 7 dias, restante; dentro do grupo, por nome.
    return list.sort((a, b) => dueGroup(a, now) - dueGroup(b, now) || a.name.localeCompare(b.name, 'pt-BR'));
  }, [clients, search, planFilter, statusFilter, dueFilter, now]);

  const filtersActive = !!(search || planFilter || statusFilter || dueFilter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, planFilter, statusFilter, dueFilter]);

  const selected = clients.find(c => c.storeId === openId) || null;

  const runAction = async (c: ClientRow, label: string, fn: () => Promise<void>) => {
    setBusyId(c.storeId);
    try {
      await fn();
      await load();
      await alertDialog(`${label} feito em "${c.name}".`, 'Pronto');
    } catch {
      await alertDialog('Não foi possível salvar. Nada foi alterado.', 'Erro');
    } finally {
      setBusyId(null);
    }
  };

  const extendHours = async (c: ClientRow, hours: number) => {
    const ok = await confirmDialog(`Estender o acesso de "${c.name}" em ${hours === 1 ? '1 hora' : `${hours} horas`}?`, { title: 'Estender', confirmLabel: 'Estender' });
    if (!ok) return;
    await runAction(c, 'Prazo estendido', () => adminExtend(c.storeId, { hours }));
  };

  const endTrial = async (c: ClientRow) => {
    const ok = await confirmDialog(`O teste de "${c.name}" será encerrado e a loja fica sem acesso.`, { title: 'Encerrar teste', confirmLabel: 'Encerrar teste', danger: true });
    if (!ok) return;
    await runAction(c, 'Teste encerrado', () => adminSetStatus(c.storeId, 'suspended'));
  };

  const toggleSuspend = async (c: ClientRow) => {
    const suspending = c.effectiveStatus !== 'suspended';
    const ok = await confirmDialog(
      suspending ? `A loja "${c.name}" perde o acesso agora. Os usuários não conseguem operar.` : `Reativar o acesso de "${c.name}"?`,
      { title: suspending ? 'Suspender loja' : 'Reativar loja', confirmLabel: suspending ? 'Suspender loja' : 'Reativar', danger: suspending },
    );
    if (!ok) return;
    await runAction(c, suspending ? 'Loja suspensa' : 'Loja reativada', () => adminSetStatus(c.storeId, suspending ? 'suspended' : 'active'));
  };

  const openStore = (c: ClientRow) => { setOpenId(c.storeId); setTab('resumo'); };

  const rowActions = (c: ClientRow) => (
    <div className="flex flex-wrap justify-end gap-2">
      <button disabled={busyId === c.storeId} onClick={e => { e.stopPropagation(); extendHours(c, 24); }} className="px-3 py-1.5 rounded-lg bg-wine-900 text-white text-xs font-semibold disabled:opacity-60">Estender</button>
      <button disabled={busyId === c.storeId} onClick={e => { e.stopPropagation(); toggleSuspend(c); }} className="px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-semibold disabled:opacity-60">
        {c.effectiveStatus === 'suspended' ? 'Reativar' : 'Suspender'}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-wine-50 dark:bg-slate-900 px-4 py-6">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-wine-950 dark:text-white">Lojas</h1>
            <p className="text-sm text-wine-600 dark:text-slate-400">Área do administrador da plataforma.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-wine-200 dark:border-slate-600 text-sm text-wine-800 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800">
              <RefreshCcw size={14} aria-hidden="true" /> Atualizar
            </button>
            <button onClick={() => { window.location.hash = ''; }} className="px-3 py-2 rounded-lg text-sm text-wine-800 dark:text-slate-200 hover:underline">Voltar</button>
          </div>
        </header>

        {/* Filtros: barra em desktop; em celular ficam empilhados */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 mb-4 bg-white dark:bg-slate-800 p-3 rounded-xl border border-wine-100 dark:border-slate-700">
          <input aria-label="Buscar loja ou e-mail do dono" placeholder="Buscar loja ou e-mail do dono" value={search} onChange={e => setSearch(e.target.value)} className="rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2 text-sm bg-transparent" />
          <select aria-label="Plano" value={planFilter} onChange={e => setPlanFilter(e.target.value)} className="rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2 text-sm bg-transparent">
            <option value="">Todos os planos</option>
            <option value="inicio">Início</option>
            <option value="crescimento">Crescimento</option>
            <option value="avancado">Avançado</option>
          </select>
          <select aria-label="Status" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2 text-sm bg-transparent">
            <option value="">Todos os status</option>
            <option value="trial">Em teste</option>
            <option value="active">Ativa</option>
            <option value="expired">Atrasada</option>
            <option value="suspended">Suspensa</option>
          </select>
          <select aria-label="Vencimento" value={dueFilter} onChange={e => setDueFilter(e.target.value as any)} className="rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2 text-sm bg-transparent">
            <option value="">Qualquer vencimento</option>
            <option value="week">Vence em 7 dias</option>
            <option value="expired">Vencido</option>
            <option value="none">Sem vencimento</option>
          </select>
          {filtersActive && (
            <button onClick={() => { setSearch(''); setPlanFilter(''); setStatusFilter(''); setDueFilter(''); }} className="rounded-lg px-3 py-2 text-sm text-wine-800 dark:text-slate-200 underline">Limpar filtros</button>
          )}
        </div>

        {loading && <p className="flex items-center gap-2 text-wine-600 dark:text-slate-400"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Carregando…</p>}

        {!loading && error && (
          <div role="alert" className="bg-white dark:bg-slate-800 rounded-xl border border-red-200 p-6 text-center">
            <p className="text-red-700 mb-3">{error}</p>
            <button onClick={load} className="px-4 py-2 rounded-lg bg-wine-900 text-white text-sm font-semibold">Tentar de novo</button>
          </div>
        )}

        {!loading && !error && clients.length === 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-wine-100 p-6 text-center text-wine-600 dark:text-slate-400">Nenhuma loja cadastrada ainda.</div>
        )}

        {!loading && !error && clients.length > 0 && filtered.length === 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-wine-100 p-6 text-center">
            <p className="text-wine-600 dark:text-slate-400 mb-3">Nenhuma loja com esses filtros.</p>
            <button onClick={() => { setSearch(''); setPlanFilter(''); setStatusFilter(''); setDueFilter(''); }} className="px-4 py-2 rounded-lg border border-wine-300 text-sm">Limpar filtros</button>
          </div>
        )}

        {!loading && !error && pageRows.length > 0 && (
          <>
            {/* Celular: cartões */}
            <div className="space-y-3 md:hidden">
              {pageRows.map(c => (
                <article key={c.storeId} onClick={() => openStore(c)} className="bg-white dark:bg-slate-800 rounded-xl border border-wine-100 dark:border-slate-700 p-4 cursor-pointer">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-wine-950 dark:text-white break-words">{c.name}</h2>
                    <StatusBadge status={c.effectiveStatus} />
                  </div>
                  <p className="text-sm text-wine-700 dark:text-slate-300 mt-1">{PLAN_LABEL[c.plan || ''] || c.plan || '—'} · {remainingText(c, now)}</p>
                  <div className="mt-3">{rowActions(c)}</div>
                </article>
              ))}
            </div>

            {/* Desktop: tabela */}
            <div className="hidden md:block overflow-x-auto bg-white dark:bg-slate-800 rounded-xl border border-wine-100 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-wine-50 dark:bg-slate-900 text-left text-wine-700 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Loja</th>
                    <th className="px-4 py-3 font-semibold">Plano</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Vencimento</th>
                    <th className="px-4 py-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(c => (
                    <tr key={c.storeId} onClick={() => openStore(c)} className="border-t border-wine-100 dark:border-slate-700 hover:bg-wine-50/60 dark:hover:bg-slate-700/40 cursor-pointer">
                      <td className="px-4 py-3 font-medium text-wine-950 dark:text-white">{c.name}</td>
                      <td className="px-4 py-3 text-wine-700 dark:text-slate-300">{PLAN_LABEL[c.plan || ''] || c.plan || '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={c.effectiveStatus} /></td>
                      <td className="px-4 py-3 text-wine-700 dark:text-slate-300">{remainingText(c, now)}</td>
                      <td className="px-4 py-3">{rowActions(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4 text-sm text-wine-700 dark:text-slate-300">
              <span>Página {page} de {pageCount}</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border disabled:opacity-40">Anterior</button>
                <button disabled={page >= pageCount} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border disabled:opacity-40">Próxima</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Ficha da loja: painel lateral (desktop) ou tela cheia (celular) */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/30 md:flex md:justify-end" onClick={() => setOpenId(null)}>
          <aside role="dialog" aria-label={`Ficha de ${selected.name}`} onClick={e => e.stopPropagation()} className="bg-white dark:bg-slate-800 w-full md:w-[560px] h-full overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-wine-100 dark:border-slate-700">
              <div className="min-w-0">
                <h2 className="font-bold text-lg text-wine-950 dark:text-white truncate">{selected.name}</h2>
                <div className="flex gap-2 items-center text-sm"><StatusBadge status={selected.effectiveStatus} /><span className="text-wine-600 dark:text-slate-400">{remainingText(selected, now)}</span></div>
              </div>
              <button onClick={() => setOpenId(null)} aria-label="Fechar" className="p-2 rounded-lg hover:bg-wine-50 dark:hover:bg-slate-700"><X size={18} /></button>
            </div>

            <nav className="flex gap-1 overflow-x-auto px-3 pt-2 border-b border-wine-100 dark:border-slate-700">
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} className={`whitespace-nowrap px-3 py-2 text-sm rounded-t-lg ${tab === t.id ? 'font-semibold text-wine-950 dark:text-white border-b-2 border-wine-900' : 'text-wine-600 dark:text-slate-400'}`}>{t.label}</button>
              ))}
            </nav>

            <div className="p-4 space-y-3 text-sm text-wine-800 dark:text-slate-200">
              {tab === 'resumo' && (
                <dl className="space-y-2">
                  <div><dt className="text-wine-500">Dono</dt><dd>{selected.ownerEmail || '—'}</dd></div>
                  <div><dt className="text-wine-500">E-mail de contato</dt><dd>{selected.contactEmail || '—'}</dd></div>
                  <div><dt className="text-wine-500">Plano</dt><dd>{PLAN_LABEL[selected.plan || ''] || selected.plan || '—'}</dd></div>
                  <div><dt className="text-wine-500">Criada em</dt><dd>{new Date(selected.createdAt).toLocaleDateString('pt-BR')}</dd></div>
                  <div><dt className="text-wine-500">Módulos liberados</dt><dd>{selected.modules.length}</dd></div>
                </dl>
              )}

              {tab === 'plano' && (
                <div>
                  <p className="mb-2">Plano: <strong>{PLAN_LABEL[selected.plan || ''] || selected.plan || '—'}</strong></p>
                  <ul className="grid grid-cols-2 gap-1">
                    {MODULES.map(m => (
                      <li key={m.key} className="flex justify-between gap-2 border-b border-wine-50 dark:border-slate-700 py-1">
                        <span>{m.name}</span>
                        <span className="text-xs text-wine-500">{selected.modules.includes(m.key) ? 'Liberado' : 'Não liberado'}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-wine-500 mt-3">Liberações manuais e trocas de plano ainda não estão disponíveis nesta tela.</p>
                </div>
              )}

              {tab === 'assinatura' && (
                <div className="rounded-lg bg-wine-50 dark:bg-slate-900 p-4">
                  <p>Pagamentos indisponíveis no momento. Os dados da assinatura continuam válidos.</p>
                </div>
              )}

              {tab === 'teste' && (
                <div className="space-y-3">
                  {selected.effectiveStatus !== 'trial' && selected.effectiveStatus !== 'expired' ? (
                    <p>Não está em teste.</p>
                  ) : (
                    <>
                      <p>Fim: {endOf(selected) ? endOf(selected)!.toLocaleString('pt-BR') : '—'}</p>
                      <div className="flex flex-wrap gap-2">
                        <button disabled={busyId === selected.storeId} onClick={() => extendHours(selected, 1)} className="px-3 py-2 rounded-lg bg-wine-900 text-white text-sm font-semibold disabled:opacity-60">Estender +1 hora</button>
                        <button disabled={busyId === selected.storeId} onClick={() => extendHours(selected, 24)} className="px-3 py-2 rounded-lg bg-wine-900 text-white text-sm font-semibold disabled:opacity-60">Estender +24 horas</button>
                        <button disabled={busyId === selected.storeId} onClick={() => endTrial(selected)} className="px-3 py-2 rounded-lg border border-red-300 text-red-700 text-sm font-semibold disabled:opacity-60">Encerrar teste</button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab === 'auditoria' && (
                <div className="rounded-lg bg-wine-50 dark:bg-slate-900 p-4">
                  <p>Auditoria indisponível no momento.</p>
                </div>
              )}

              <div className="pt-4 border-t border-wine-100 dark:border-slate-700">
                <button disabled={busyId === selected.storeId} onClick={() => toggleSuspend(selected)} className="px-3 py-2 rounded-lg border border-red-300 text-red-700 text-sm font-semibold disabled:opacity-60">
                  {selected.effectiveStatus === 'suspended' ? 'Reativar loja' : 'Suspender loja'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCcw, X, Plus, Eye } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { confirmDialog, alertDialog } from '../UI';
import { formatRemaining } from '../SubscriptionBanner';
import {
  AdminStoreFilters, AdminStoreRow, StoreStatus, closeStore, extendStore, listStores, setStoreStatus,
} from '../../lib/adminApi';
import { PLANS, PlanCode, isPlanCode } from '../../lib/plans';
import { CreateStoreForm } from './CreateStoreForm';
import { PlanChangePanel } from './PlanChangePanel';
import { ModuleOverridesPanel } from './ModuleOverridesPanel';
import { DeleteStorePanel } from './DeleteStorePanel';
import { TeamPanel } from '../TeamPanel';

/**
 * Painel admin da plataforma: uma tela de assinaturas (decisões 33–38 e 41).
 * Substitui StoreAdmin, AdminDashboard e ClientesArea.
 * - Só o dono do SaaS (is_platform_admin): o App só monta esta tela para ele; o banco confere de novo.
 * - Sem KPIs (MRR, churn, totais), sem motivo obrigatório e sem duas etapas.
 * - Ações: criar loja, estender, suspender/reativar, encerrar, trocar plano, override de módulo, equipe.
 * - "Abrir loja" usa a impersonação (só o dono do SaaS, sem limite de tempo e sem log).
 * - Pagamento manual: adiado com a cobrança (decisões 5–12).
 */

const STATUS_LABEL: Record<StoreStatus, string> = {
  trial: 'Em teste',
  active: 'Ativa',
  suspended: 'Suspensa',
  expired: 'Encerrada / vencida',
};
const STATUS_CLASS: Record<StoreStatus, string> = {
  trial: 'bg-amber-100 text-amber-900',
  active: 'bg-emerald-100 text-emerald-900',
  suspended: 'bg-slate-200 text-slate-800',
  expired: 'bg-red-100 text-red-900',
};
const PLAN_LABEL: Record<string, string> = Object.fromEntries([...PLANS.map(p => [p.code, p.name]), ['trial', 'Teste']]);

export const planLabel = (plan: string | null) => (plan ? PLAN_LABEL[plan] ?? 'Plano legado' : 'Sem assinatura');

const StatusBadge: React.FC<{ status: StoreStatus }> = ({ status }) => (
  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_CLASS[status] ?? STATUS_CLASS.active}`}>
    {STATUS_LABEL[status] ?? status}
  </span>
);

const remainingText = (s: AdminStoreRow, now: number) => {
  if (!s.endsAt) return 'Sem vencimento';
  const ms = s.endsAt.getTime() - now;
  return ms <= 0 ? `Vencido em ${s.endsAt.toLocaleDateString('pt-BR')}` : `${formatRemaining(ms)} (${s.endsAt.toLocaleDateString('pt-BR')})`;
};

type Tab = 'assinatura' | 'plano' | 'modulos' | 'equipe' | 'excluir';
const TABS: { id: Tab; label: string }[] = [
  { id: 'assinatura', label: 'Assinatura' },
  { id: 'plano', label: 'Plano' },
  { id: 'modulos', label: 'Módulos' },
  { id: 'equipe', label: 'Equipe' },
  { id: 'excluir', label: 'Excluir' },
];

const btn = 'px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-60';
const btnPrimary = `${btn} bg-wine-900 text-white hover:bg-wine-800`;
const btnOutline = `${btn} border border-wine-200 dark:border-slate-600 text-wine-800 dark:text-slate-200 hover:bg-wine-50 dark:hover:bg-slate-700`;
const btnDanger = `${btn} border border-red-300 text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20`;
const field = 'rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2 text-sm bg-white dark:bg-slate-900 text-wine-950 dark:text-white';

export const AdminPanel: React.FC = () => {
  const { startImpersonation, stopImpersonation, impersonatedStore, activeStore, reload } = useStore();
  const [rows, setRows] = useState<AdminStoreRow[]>([]);
  const [next, setNext] = useState<{ afterKey: string; afterId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AdminStoreFilters>({ status: '', plan: '', q: '' });
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('assinatura');
  const [creating, setCreating] = useState(false);
  // Enquanto a criação está em andamento, o formulário não fecha.
  const [createBusy, setCreateBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customDays, setCustomDays] = useState('30');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listStores(filters);
      setRows(page.items);
      setNext(page.next);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar as lojas.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);
  // Busca: espera o usuário parar de digitar.
  useEffect(() => {
    const t = window.setTimeout(() => setFilters(f => (f.q === search ? f : { ...f, q: search })), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const loadMore = async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await listStores(filters, next);
      setRows(r => [...r, ...page.items]);
      setNext(page.next);
    } catch (e: any) {
      await alertDialog(e?.message || 'Não foi possível carregar mais lojas.', 'Erro');
    } finally {
      setLoadingMore(false);
    }
  };

  // Busca local complementa o filtro do servidor enquanto a RPC não aceitar `q`.
  const q = (filters.q || '').trim().toLowerCase();
  const visible = q
    ? rows.filter(r => r.name.toLowerCase().includes(q) || (r.ownerEmail || '').toLowerCase().includes(q))
    : rows;
  const selected = rows.find(r => r.id === openId) || null;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
      await alertDialog(label, 'Pronto');
    } catch (e: any) {
      await alertDialog(e?.message || 'Não foi possível salvar. Nada foi alterado.', 'Erro');
    } finally {
      setBusy(false);
    }
  };

  const extend = async (s: AdminStoreRow, amount: { hours?: number; days?: number }, text: string) => {
    if (!(await confirmDialog(`Estender o acesso de "${s.name}" em ${text}?`, { title: 'Estender', confirmLabel: 'Estender' }))) return;
    await run(`Prazo de "${s.name}" estendido em ${text}.`, () => extendStore(s.id, amount));
  };

  const toggleSuspend = async (s: AdminStoreRow) => {
    const suspend = s.status !== 'suspended';
    const ok = await confirmDialog(
      suspend ? `Suspender "${s.name}"? A loja perde o acesso agora.` : `Reativar o acesso de "${s.name}"?`,
      { title: suspend ? 'Suspender loja' : 'Reativar loja', confirmLabel: suspend ? 'Suspender' : 'Reativar', danger: suspend },
    );
    if (!ok) return;
    await run(suspend ? `"${s.name}" suspensa.` : `"${s.name}" reativada.`, () => setStoreStatus(s.id, suspend ? 'suspended' : 'active'));
  };

  const close = async (s: AdminStoreRow) => {
    const ok = await confirmDialog(`Encerrar "${s.name}"? A loja fica sem acesso.`, { title: 'Encerrar loja', confirmLabel: 'Encerrar', danger: true });
    if (!ok) return;
    await run(`"${s.name}" encerrada.`, () => closeStore(s.id));
  };

  const openStore = async (s: AdminStoreRow) => {
    try {
      await startImpersonation(s.id, s.name);
    } catch (e: any) {
      await alertDialog(e?.message || 'Não foi possível abrir a loja.', 'Erro');
    }
  };

  const openDetail = (s: AdminStoreRow) => { setOpenId(s.id); setTab('assinatura'); };
  const closeCreate = () => { if (!createBusy) setCreating(false); };
  const closeDetail = () => { if (!deleteBusy) setOpenId(null); };

  /** Loja excluída: fecha o painel, tira da lista e sai dela se era a loja aberta. */
  const afterDelete = async (s: AdminStoreRow) => {
    setDeleteBusy(false);
    setOpenId(null);
    setRows(r => r.filter(x => x.id !== s.id));
    await alertDialog(`A loja "${s.name}" foi excluída.`, 'Pronto');
    if (impersonatedStore?.id === s.id) await stopImpersonation();
    else if (activeStore?.id === s.id) await reload();
    else await load();
  };

  return (
    <div className="max-w-6xl mx-auto" data-testid="admin-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-wine-950 dark:text-white">Assinaturas</h1>
          <p className="text-sm text-wine-600 dark:text-slate-400">Lojas, planos e prazos. Só o dono do SaaS acessa esta tela.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCreating(true)} className={`${btnPrimary} flex items-center gap-1`}><Plus size={16} aria-hidden="true" /> Criar loja</button>
          <button onClick={load} className={`${btnOutline} flex items-center gap-2`}><RefreshCcw size={14} aria-hidden="true" /> Atualizar</button>
        </div>
      </header>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 mb-4 bg-white dark:bg-slate-800 p-3 rounded-xl border border-wine-100 dark:border-slate-700">
        <input aria-label="Buscar loja ou e-mail do dono" placeholder="Buscar loja ou e-mail do dono" value={search} onChange={e => setSearch(e.target.value)} className={field} />
        <select aria-label="Plano" value={filters.plan} onChange={e => setFilters(f => ({ ...f, plan: e.target.value as PlanCode | '' }))} className={field}>
          <option value="">Todos os planos</option>
          {PLANS.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
        </select>
        <select aria-label="Status" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value as StoreStatus | '' }))} className={field}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_LABEL) as StoreStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        {(filters.plan || filters.status || search) && (
          <button onClick={() => { setSearch(''); setFilters({ status: '', plan: '', q: '' }); }} className="text-sm underline text-wine-800 dark:text-slate-200 justify-self-start">Limpar filtros</button>
        )}
      </div>

      {loading && <p className="flex items-center gap-2 text-wine-600 dark:text-slate-400"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Carregando…</p>}

      {!loading && error && (
        <div role="alert" className="bg-white dark:bg-slate-800 rounded-xl border border-red-200 p-6 text-center">
          <p className="text-red-700 mb-3">{error}</p>
          <button onClick={load} className={btnPrimary}>Tentar de novo</button>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-wine-100 dark:border-slate-700 p-6 text-center text-wine-600 dark:text-slate-400">
          {rows.length === 0 ? 'Nenhuma loja encontrada.' : 'Nenhuma loja com esses filtros.'}
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <>
          {/* Celular: cartões */}
          <ul className="space-y-3 md:hidden">
            {visible.map(s => (
              <li key={s.id}>
                <button onClick={() => openDetail(s)} className="w-full text-left bg-white dark:bg-slate-800 rounded-xl border border-wine-100 dark:border-slate-700 p-4" data-testid="admin-store-card">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-wine-950 dark:text-white break-words">{s.name}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="text-sm text-wine-700 dark:text-slate-300 mt-1">{planLabel(s.plan)} · {remainingText(s, now)}</p>
                  {s.ownerEmail && <p className="text-xs text-wine-500 dark:text-slate-400 mt-1 break-all">{s.ownerEmail}</p>}
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop: tabela */}
          <div className="hidden md:block overflow-x-auto bg-white dark:bg-slate-800 rounded-xl border border-wine-100 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-wine-50 dark:bg-slate-900 text-left text-wine-700 dark:text-slate-300">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Loja</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Dono</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Plano</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Vendedores</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Vencimento</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(s => (
                  <tr key={s.id} className="border-t border-wine-100 dark:border-slate-700" data-testid="admin-store-row">
                    <td className="px-4 py-3 font-medium text-wine-950 dark:text-white">{s.name}</td>
                    <td className="px-4 py-3 text-wine-700 dark:text-slate-300 break-all">{s.ownerEmail || '—'}</td>
                    <td className="px-4 py-3 text-wine-700 dark:text-slate-300">{planLabel(s.plan)}</td>
                    <td className="px-4 py-3 text-wine-700 dark:text-slate-300">
                      {s.sellersCount ?? '—'}{s.maxSellers != null ? ` / ${s.maxSellers}` : ''}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-3 text-wine-700 dark:text-slate-300">{remainingText(s, now)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => openStore(s)} className={`${btnOutline} flex items-center gap-1`} aria-label={`Abrir a loja ${s.name}`}><Eye size={14} aria-hidden="true" /> Abrir</button>
                        <button onClick={() => openDetail(s)} className={btnPrimary}>Gerenciar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {next && (
            <div className="mt-4 text-center">
              <button onClick={loadMore} disabled={loadingMore} className={btnOutline}>{loadingMore ? 'Carregando…' : 'Carregar mais'}</button>
            </div>
          )}
        </>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 bg-black/30 md:flex md:justify-end" onClick={closeCreate}>
          <aside role="dialog" aria-modal="true" aria-label="Criar loja" onClick={e => e.stopPropagation()} className="bg-white dark:bg-slate-800 w-full md:w-[480px] h-full overflow-y-auto shadow-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-wine-950 dark:text-white">Criar loja</h2>
              <button onClick={closeCreate} disabled={createBusy} aria-label="Fechar" className="p-2 rounded-lg hover:bg-wine-50 dark:hover:bg-slate-700 disabled:opacity-40"><X size={18} /></button>
            </div>
            <CreateStoreForm onCancel={() => setCreating(false)} onCreated={() => load()} onBusyChange={setCreateBusy} />
          </aside>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/30 md:flex md:justify-end" onClick={closeDetail}>
          <aside role="dialog" aria-modal="true" aria-label={`Gerenciar ${selected.name}`} onClick={e => e.stopPropagation()} className="bg-white dark:bg-slate-800 w-full md:w-[640px] h-full overflow-y-auto shadow-xl">
            <div className="flex items-start justify-between gap-2 p-4 border-b border-wine-100 dark:border-slate-700">
              <div className="min-w-0">
                <h2 className="font-bold text-lg text-wine-950 dark:text-white break-words">{selected.name}</h2>
                <div className="flex flex-wrap gap-2 items-center text-sm mt-1">
                  <StatusBadge status={selected.status} />
                  <span className="text-wine-600 dark:text-slate-400">{planLabel(selected.plan)} · {remainingText(selected, now)}</span>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => openStore(selected)} className={`${btnOutline} flex items-center gap-1`}><Eye size={14} aria-hidden="true" /> Abrir loja</button>
                <button onClick={closeDetail} disabled={deleteBusy} aria-label="Fechar" className="p-2 rounded-lg hover:bg-wine-50 dark:hover:bg-slate-700 disabled:opacity-40"><X size={18} /></button>
              </div>
            </div>

            <nav className="flex gap-1 overflow-x-auto px-3 pt-2 border-b border-wine-100 dark:border-slate-700" role="tablist">
              {TABS.map(t => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} disabled={deleteBusy} onClick={() => setTab(t.id)} className={`whitespace-nowrap px-3 py-2 text-sm rounded-t-lg ${tab === t.id ? 'font-semibold text-wine-950 dark:text-white border-b-2 border-wine-900' : 'text-wine-600 dark:text-slate-400'}`}>{t.label}</button>
              ))}
            </nav>

            <div className="p-4 space-y-4 text-sm text-wine-800 dark:text-slate-200" role="tabpanel">
              {tab === 'assinatura' && (
                <>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><dt className="text-wine-500">Dono</dt><dd className="break-all">{selected.ownerEmail || '—'}</dd></div>
                    <div><dt className="text-wine-500">Plano</dt><dd>{planLabel(selected.plan)}</dd></div>
                    <div><dt className="text-wine-500">Vencimento</dt><dd>{selected.endsAt ? selected.endsAt.toLocaleString('pt-BR') : '—'}</dd></div>
                    <div><dt className="text-wine-500">Criada em</dt><dd>{selected.createdAt ? new Date(selected.createdAt).toLocaleDateString('pt-BR') : '—'}</dd></div>
                  </dl>

                  <section aria-labelledby="estender-h" className="space-y-2">
                    <h3 id="estender-h" className="font-semibold text-wine-950 dark:text-white">Estender prazo</h3>
                    <div className="flex flex-wrap gap-2">
                      <button disabled={busy} onClick={() => extend(selected, { hours: 1 }, '1 hora')} className={btnOutline}>+1 hora</button>
                      <button disabled={busy} onClick={() => extend(selected, { hours: 24 }, '24 horas')} className={btnOutline}>+24 horas</button>
                      <button disabled={busy} onClick={() => extend(selected, { days: 7 }, '7 dias')} className={btnOutline}>+7 dias</button>
                      <button disabled={busy} onClick={() => extend(selected, { days: 30 }, '30 dias')} className={btnOutline}>+30 dias</button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col text-xs text-wine-600 dark:text-slate-400">
                        Outro prazo (dias)
                        <input type="number" min={1} max={3650} value={customDays} onChange={e => setCustomDays(e.target.value)} className={`${field} w-28 mt-1`} />
                      </label>
                      <button
                        disabled={busy || !(Number(customDays) > 0)}
                        onClick={() => extend(selected, { days: Math.floor(Number(customDays)) }, `${Math.floor(Number(customDays))} dias`)}
                        className={btnPrimary}
                      >Estender</button>
                    </div>
                  </section>

                  <section aria-labelledby="status-h" className="space-y-2 pt-3 border-t border-wine-100 dark:border-slate-700">
                    <h3 id="status-h" className="font-semibold text-wine-950 dark:text-white">Acesso da loja</h3>
                    <div className="flex flex-wrap gap-2">
                      <button disabled={busy} onClick={() => toggleSuspend(selected)} className={selected.status === 'suspended' ? btnPrimary : btnDanger}>
                        {selected.status === 'suspended' ? 'Reativar loja' : 'Suspender loja'}
                      </button>
                      <button disabled={busy || selected.status === 'expired'} onClick={() => close(selected)} className={btnDanger}>Encerrar loja</button>
                    </div>
                  </section>

                  <p className="text-xs text-wine-500 dark:text-slate-400 pt-3 border-t border-wine-100 dark:border-slate-700">
                    Pagamento manual e cobrança: adiados pelo dono (decisões 5–12).
                  </p>
                </>
              )}

              {tab === 'plano' && (
                <PlanChangePanel
                  key={selected.id}
                  storeId={selected.id}
                  storeName={selected.name}
                  currentPlan={isPlanCode(selected.plan) ? selected.plan : null}
                  onChanged={load}
                />
              )}

              {tab === 'modulos' && <ModuleOverridesPanel key={selected.id} storeId={selected.id} />}

              {tab === 'excluir' && (
                <DeleteStorePanel key={selected.id} storeId={selected.id} storeName={selected.name} onBusyChange={setDeleteBusy} onDeleted={() => afterDelete(selected)} />
              )}

              {tab === 'equipe' && (
                <TeamPanel key={selected.id} store={{ id: selected.id, name: selected.name, plan: selected.plan }} onChanged={load} />
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert,
  Building2,
  DollarSign,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Plus,
  RefreshCcw,
  ExternalLink,
  ChevronRight,
  Search,
  UserCheck,
  FileText,
  PauseCircle,
  PlayCircle,
  Layers,
  ArrowUpRight,
  TrendingUp,
  CreditCard,
  Mail,
  Phone,
  Copy,
  Calendar,
} from 'lucide-react';
import { Card, Button, Input, StatusBadge, Drawer, confirmDialog, alertDialog } from './UI';
import { ClientRow, SubscriptionStatus, useStore } from '../contexts/StoreContext';
import { MODULES, ModuleKey } from '../lib/modules';
import { formatRemaining } from '../lib/subscription';
import { TempPasswordNotice } from './TempPasswordNotice';
import { passwordProblem } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { fetchAdminMetrics, AdminMetrics, requireAudit } from '../lib/adminApi';

interface InvoiceItem {
  id: string;
  store_id: string;
  amount_cents: number;
  status: 'paid' | 'pending' | 'failed' | 'refunded' | 'void';
  due_date: string;
  paid_at: string | null;
  payment_method: string | null;
  hosted_invoice_url: string | null;
}

interface AuditLogItem {
  id: string;
  store_id: string;
  action: string;
  details: any;
  created_at: string;
}

export const AdminDashboard: React.FC = () => {
  const {
    legacyMode,
    adminListClients,
    adminCreateClient,
    adminExtend,
    adminSetStatus,
    startImpersonation,
  } = useStore();

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'trial' | 'past_due' | 'suspended' | 'cancelled'>('all');
  
  // Drawer de Detalhes da Loja
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null);
  const [clientInvoices, setClientInvoices] = useState<InvoiceItem[]>([]);
  const [clientLogs, setClientLogs] = useState<AuditLogItem[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Modal de Nova Loja / Cliente
  const [isNewStoreModalOpen, setIsNewStoreModalOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newStoreName, setNewStoreName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newMode, setNewMode] = useState<'trial' | 'paid'>('trial');
  const [newAmount, setNewAmount] = useState(1);
  const [newUnit, setNewUnit] = useState<'hours' | 'days'>('hours');
  const [newNotes, setNewNotes] = useState('');
  const [newModules, setNewModules] = useState<ModuleKey[]>(
    MODULES.filter(m => !m.core && m.defaultEnabled).map(m => m.key)
  );
  const [creating, setCreating] = useState(false);
  const [serverMetrics, setServerMetrics] = useState<AdminMetrics | 'unavailable' | null>(null);
  const [tempCred, setTempCred] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminListClients();
      setClients(data);
    } catch (err: any) {
      console.error('Erro ao carregar clientes do admin:', err);
    } finally {
      setLoading(false);
    }
    try {
      const res = await fetchAdminMetrics();
      setServerMetrics(res.available ? res.data : 'unavailable');
    } catch (err) {
      console.warn('Métricas do admin indisponíveis:', err);
      setServerMetrics('unavailable');
    }
  }, [adminListClients]);

  useEffect(() => {
    if (!legacyMode) load();
    else setLoading(false);
  }, [legacyMode, load]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Carregar dados de faturas e auditoria ao selecionar um cliente no Drawer
  useEffect(() => {
    if (!selectedClient) {
      setClientInvoices([]);
      setClientLogs([]);
      return;
    }
    let cancelled = false;
    const fetchDetails = async () => {
      setLoadingDetails(true);
      try {
        // Faturas e auditoria da loja entram com a migração 018 (ver lib/adminApi.ts)
        if (!cancelled) {
          setClientInvoices([]);
          setClientLogs([]);
        }
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    };
    fetchDetails();
    return () => { cancelled = true; };
  }, [selectedClient]);

  // Métricas: contagens da lista de lojas; MRR calculado pelo banco a partir do valor mensal de cada loja
  const metrics = useMemo(() => {
    const total = clients.length;
    let active = 0;
    let trial = 0;
    let pastDue = 0;
    let suspended = 0;
    let nextTrialEnd: number | null = null;

    for (const c of clients) {
      const eff = c.effectiveStatus;
      if (eff === 'active') {
        active++;
      } else if (eff === 'trial') {
        trial++;
        const end = c.trialEndsAt ? c.trialEndsAt.getTime() : null;
        if (end !== null && end > now && (nextTrialEnd === null || end < nextTrialEnd)) nextTrialEnd = end;
      } else if (eff === 'expired') {
        pastDue++;
      } else if (eff === 'suspended') {
        suspended++;
      }
    }

    const mrrAvailable = serverMetrics !== null && serverMetrics !== 'unavailable';
    return {
      total,
      active,
      trial,
      pastDue,
      suspended,
      nextTrialEnd,
      mrrAvailable,
      mrrCents: mrrAvailable ? (serverMetrics as AdminMetrics).mrr_cents : null,
      churnRate: total > 0 ? ((suspended / total) * 100).toFixed(1) : '0.0',
    };
  }, [clients, now, serverMetrics]);

  // Clientes filtrados por busca e aba
  const filteredClients = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return clients.filter(c => {
      // Filtro de aba
      if (filterTab === 'active' && c.effectiveStatus !== 'active') return false;
      if (filterTab === 'trial' && c.effectiveStatus !== 'trial') return false;
      if (filterTab === 'past_due' && c.effectiveStatus !== 'expired') return false;
      if (filterTab === 'suspended' && c.effectiveStatus !== 'suspended') return false;
      if (filterTab === 'cancelled' && (c.status as any) !== 'cancelled') return false;

      // Filtro de busca
      if (!query) return true;
      const nameMatch = c.name.toLowerCase().includes(query);
      const emailMatch = (c.ownerEmail || c.contactEmail || '').toLowerCase().includes(query);
      const planMatch = (c.plan || '').toLowerCase().includes(query);
      return nameMatch || emailMatch || planMatch;
    });
  }, [clients, filterTab, searchQuery]);

  // Ação de Impersonação (Acessar como Loja) com log de auditoria
  const handleImpersonate = async (client: ClientRow) => {
    const ok = await confirmDialog(
      `Você entrará no modo de suporte visualizando a loja "${client.name}".\nUm registro de auditoria imutável será gravado.\n\nDeseja continuar?`,
      { title: 'Acessar Loja (Modo Suporte)' }
    );
    if (!ok) return;

    try {
      await requireAudit(client.storeId, 'impersonate_start', { store_name: client.name, started_at: new Date().toISOString() });
      await startImpersonation(client.storeId);
    } catch (err: any) {
      alertDialog(err.message || 'Erro ao alternar para a loja.', 'Erro');
    }
  };

  const handleExtend = async (storeId: string, days: number) => {
    try {
      await requireAudit(storeId, 'extend', { days });
      await adminExtend(storeId, { days });
      await load();
      alertDialog(`Prazo estendido em +${days} dias com sucesso.`, 'Sucesso');
    } catch (err: any) {
      alertDialog(err.message || 'Erro ao estender prazo.', 'Erro');
    }
  };

  const handleToggleStatus = async (client: ClientRow) => {
    const isSuspended = client.effectiveStatus === 'suspended';
    const targetStatus: SubscriptionStatus = isSuspended ? 'active' : 'suspended';
    const ok = await confirmDialog(
      isSuspended
        ? `Reativar o acesso da loja "${client.name}"?`
        : `Suspender o acesso da loja "${client.name}"? Os usuários serão impedidos de operar o sistema.`,
      { danger: !isSuspended }
    );
    if (!ok) return;

    try {
      await requireAudit(client.storeId, 'set_status', { status: targetStatus });
      await adminSetStatus(client.storeId, targetStatus);
      await load();
    } catch (err: any) {
      alertDialog(err.message || 'Erro ao alterar status.', 'Erro');
    }
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const pwdIssue = passwordProblem(newPassword);
      if (pwdIssue) throw new Error(pwdIssue);

      await requireAudit(null, 'create_store', { email: newEmail, storeName: newStoreName, mode: newMode });
      const res = await adminCreateClient({
        email: newEmail,
        storeName: newStoreName,
        password: newPassword,
        modules: newModules,
        mode: newMode,
        notes: newNotes,
        hours: newUnit === 'hours' ? newAmount : undefined,
        days: newUnit === 'days' ? newAmount : undefined,
      });

      if (res.temporaryPassword) {
        setTempCred({ email: newEmail, password: res.temporaryPassword });
      }

      setIsNewStoreModalOpen(false);
      setNewEmail('');
      setNewStoreName('');
      setNewPassword('');
      setNewNotes('');
      await load();
      alertDialog(`Cliente "${newStoreName}" cadastrado com sucesso!`, 'Concluído');
    } catch (err: any) {
      alertDialog(err.message || 'Erro ao cadastrar cliente.', 'Erro');
    } finally {
      setCreating(false);
    }
  };

  const fmtCurrency = (cents: number) =>
    (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-6">
      {/* Top Banner de Alertas */}
      {metrics.pastDue > 0 && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm font-medium">
              <strong>{metrics.pastDue} loja(s)</strong> com licença ou pagamento vencido requerem atenção imediata ({fmtCurrency(metrics.pastDueCents)} em risco).
            </p>
          </div>
          <button
            onClick={() => setFilterTab('past_due')}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
          >
            Ver Inadimplentes
          </button>
        </div>
      )}

      {/* Header do Painel SaaS */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Painel de Assinaturas & Lojas
            </h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-800/40">
              SuperAdmin
            </span>
          </div>
          <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Gestão executiva de tenants, faturamento SaaS, assinaturas e suporte da plataforma.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load} title="Atualizar dados">
            <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} />
          </Button>
          <Button onClick={() => setIsNewStoreModalOpen(true)}>
            <Plus size={16} /> Nova Loja / Cliente
          </Button>
        </div>
      </div>

      {tempCred && (
        <TempPasswordNotice
          email={tempCred.email}
          password={tempCred.password}
          onDismiss={() => setTempCred(null)}
        />
      )}

      {/* Visão geral: quatro cards calculados a partir da base (admin-spec.md, seção 2) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Lojas ativas</span>
            <CheckCircle2 size={18} className="text-emerald-500" />
          </div>
          <div className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 font-mono">{metrics.active}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">de {metrics.total} lojas</div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Em teste</span>
            <Clock size={18} className="text-indigo-500" />
          </div>
          <div className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 font-mono">{metrics.trial}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {metrics.nextTrialEnd !== null
              ? `próxima expira em ${formatRemaining(Math.max(0, metrics.nextTrialEnd - now))}`
              : 'teste de 1 hora'}
          </div>
        </Card>

        <button type="button" onClick={() => setFilterTab('past_due')} className="text-left" aria-label="Ver lojas atrasadas">
          <Card className="p-4 sm:p-5 h-full">
            <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Atrasadas</span>
              <AlertTriangle size={18} className="text-amber-500" />
            </div>
            <div className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 font-mono">{metrics.pastDue}</div>
            <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">vencidas, ver lista</div>
          </Card>
        </button>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">MRR</span>
            <DollarSign size={18} className="text-emerald-500" />
          </div>
          {metrics.mrrAvailable && metrics.mrrCents !== null ? (
            <>
              <div className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 font-mono">{fmtCurrency(metrics.mrrCents)}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">soma do valor mensal das ativas</div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mt-1">Aguardando valores</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">cálculo disponível após a migração 018</div>
            </>
          )}
        </Card>
      </div>

      {/* Controles da Tabela: Abas de Filtro + Barra de Pesquisa */}
      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row gap-3 justify-between items-center bg-zinc-50/50 dark:bg-zinc-900/50">
          {/* Pills de Filtro de Status */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 custom-scrollbar">
            {[
              { id: 'all', label: `Todas (${clients.length})` },
              { id: 'active', label: `Ativas (${metrics.active})` },
              { id: 'trial', label: `Em Teste (${metrics.trial})` },
              { id: 'past_due', label: `Atrasadas (${metrics.pastDue})` },
              { id: 'suspended', label: `Suspensas (${metrics.suspended})` },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setFilterTab(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  filterTab === tab.id
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Campo de Busca Rápida */}
          <div className="relative w-full sm:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar loja, e-mail ou plano..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-zinc-900 dark:text-zinc-100"
            />
          </div>
        </div>

        {/* Tabela Operacional */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="py-3 px-4 font-semibold uppercase tracking-wider">Loja / Cliente</th>
                <th className="py-3 px-4 font-semibold uppercase tracking-wider">Plano & Valor</th>
                <th className="py-3 px-4 font-semibold uppercase tracking-wider">Status</th>
                <th className="py-3 px-4 font-semibold uppercase tracking-wider">Validade / Prazo</th>
                <th className="py-3 px-4 font-semibold uppercase tracking-wider">Contato</th>
                <th className="py-3 px-4 font-semibold uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-zinc-900 dark:text-zinc-100">
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-400 dark:text-zinc-500">
                    Nenhuma loja encontrada com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredClients.map(client => {
                  const end = client.effectiveStatus === 'trial' ? client.trialEndsAt : client.validUntil;
                  const remaining = end ? formatRemaining(end.getTime() - now) : 'Sem prazo';

                  return (
                    <tr
                      key={client.storeId}
                      className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <button
                          onClick={() => setSelectedClient(client)}
                          className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400 text-left flex items-center gap-1.5 group"
                        >
                          <span>{client.name}</span>
                          <ChevronRight size={14} className="text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
                        </button>
                        <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                          ID: {client.storeId.substring(0, 8)}...
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span className="font-semibold uppercase text-zinc-700 dark:text-zinc-300">
                          {client.plan || 'Starter'}
                        </span>
                        <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                          R$ 199/mês
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <StatusBadge status={client.effectiveStatus} />
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-medium font-mono">{remaining}</div>
                        <div className="text-[11px] text-zinc-400">
                          {end ? end.toLocaleDateString('pt-BR') : 'Indeterminado'}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="truncate max-w-[180px] text-zinc-600 dark:text-zinc-300">
                          {client.ownerEmail || client.contactEmail || '-'}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => handleExtend(client.storeId, 30)}
                            title="Prorrogar 30 dias"
                          >
                            +30d
                          </Button>

                          <Button
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => handleToggleStatus(client)}
                            title={client.effectiveStatus === 'suspended' ? 'Reativar Loja' : 'Suspender Loja'}
                          >
                            {client.effectiveStatus === 'suspended' ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
                          </Button>

                          <Button
                            className="h-7 px-2.5 text-xs bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90"
                            onClick={() => handleImpersonate(client)}
                            title="Entrar como loja (Suporte)"
                          >
                            <ExternalLink size={13} className="mr-1" /> Acessar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Slide-over Drawer com Detalhes da Loja, Faturas e Timeline */}
      <Drawer
        isOpen={!!selectedClient}
        onClose={() => setSelectedClient(null)}
        title={selectedClient?.name || 'Detalhes da Loja'}
        subtitle={`Tenant ID: ${selectedClient?.storeId}`}
      >
        {selectedClient && (
          <div className="space-y-6 text-sm">
            {/* Bloco 1: Status e Ações Rápidas */}
            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60 flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-400 uppercase font-semibold">Status da Assinatura</p>
                <div className="mt-1">
                  <StatusBadge status={selectedClient.effectiveStatus} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="text-xs h-8"
                  onClick={() => handleExtend(selectedClient.storeId, 30)}
                >
                  Prorrogar +30d
                </Button>
                <Button
                  className="text-xs h-8 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  onClick={() => handleImpersonate(selectedClient)}
                >
                  <ExternalLink size={13} className="mr-1" /> Acessar Loja
                </Button>
              </div>
            </div>

            {/* Bloco 2: Informações de Contato do Dono */}
            <div>
              <h3 className="text-xs font-semibold uppercase text-zinc-500 tracking-wider mb-2">
                Contato do Proprietário
              </h3>
              <div className="space-y-2 bg-white dark:bg-zinc-800/40 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                  <Mail size={16} className="text-zinc-400" />
                  <span>{selectedClient.ownerEmail || selectedClient.contactEmail || 'E-mail não informado'}</span>
                </div>
                {selectedClient.notes && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 italic pt-2 border-t border-zinc-100 dark:border-zinc-800">
                    "{selectedClient.notes}"
                  </p>
                )}
              </div>
            </div>

            {/* Bloco 3: Histórico de Faturas & Cobranças */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold uppercase text-zinc-500 tracking-wider">
                  Histórico de Faturas
                </h3>
                <span className="text-xs text-zinc-400 font-mono">
                  {clientInvoices.length} faturas
                </span>
              </div>

              {loadingDetails ? (
                <p className="text-xs text-zinc-400 py-4 text-center">Carregando faturas...</p>
              ) : clientInvoices.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-400">
                  Nenhuma fatura registrada no momento.
                </div>
              ) : (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  {clientInvoices.map(inv => (
                    <div key={inv.id} className="p-3 flex items-center justify-between bg-white dark:bg-zinc-800/40">
                      <div>
                        <div className="font-mono font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                          {fmtCurrency(inv.amount_cents)}
                        </div>
                        <div className="text-[11px] text-zinc-400">
                          Vencimento: {new Date(inv.due_date).toLocaleDateString('pt-BR')}
                        </div>
                      </div>
                      <StatusBadge status={inv.status === 'paid' ? 'active' : 'past_due'} label={inv.status.toUpperCase()} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bloco 4: Timeline de Eventos / Auditoria */}
            <div>
              <h3 className="text-xs font-semibold uppercase text-zinc-500 tracking-wider mb-2">
                Eventos Recentes (Auditoria)
              </h3>
              {clientLogs.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-400">
                  Nenhum evento registrado nesta loja.
                </div>
              ) : (
                <div className="space-y-2">
                  {clientLogs.map(log => (
                    <div key={log.id} className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 text-xs">
                      <div className="font-semibold text-zinc-800 dark:text-zinc-200">
                        {log.action}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        {new Date(log.created_at).toLocaleString('pt-BR')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* Modal de Criação de Loja / Cliente */}
      {isNewStoreModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg p-6 border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-1">
              Cadastrar Nova Loja / Cliente
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
              Cria o tenant da loja e o acesso inicial do proprietário.
            </p>

            <form onSubmit={handleCreateStore} className="space-y-3.5">
              <Input
                label="Nome da Loja"
                value={newStoreName}
                onChange={e => setNewStoreName(e.target.value)}
                placeholder="Ex.: Loja Central"
                required
              />

              <Input
                label="E-mail do Dono (Login)"
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="dono@lojacentral.com.br"
                required
              />

              <Input
                label="Senha Inicial (Opcional - deixe vazio para gerar provisória)"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Mínimo 10 caracteres"
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                    Tipo de Acesso
                  </label>
                  <select
                    value={newMode}
                    onChange={e => {
                      const m = e.target.value as 'trial' | 'paid';
                      setNewMode(m);
                      setNewAmount(m === 'trial' ? 1 : 30);
                      setNewUnit(m === 'trial' ? 'hours' : 'days');
                    }}
                    className="w-full text-xs p-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="trial">Teste Grátis (Horas)</option>
                    <option value="paid">Tempo Pago (Dias)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                    Duração
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={newAmount}
                      onChange={e => setNewAmount(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 text-xs p-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100"
                    />
                    <select
                      value={newUnit}
                      onChange={e => setNewUnit(e.target.value as any)}
                      className="flex-1 text-xs p-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100"
                    >
                      <option value="hours">Horas</option>
                      <option value="days">Dias</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                <Button variant="outline" type="button" onClick={() => setIsNewStoreModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? 'Cadastrando...' : 'Criar Cliente'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCcw, Clock, PauseCircle, PlayCircle, ExternalLink } from 'lucide-react';
import { Card, Button, Input, Badge, Select, confirmDialog } from './UI';
import { useAppStore } from '../store';
import { ClientRow, SubscriptionStatus, useStore } from '../contexts/StoreContext';
import { MODULES, ModuleKey } from '../lib/modules';
import { formatRemaining } from './SubscriptionBanner';
import { TempPasswordNotice } from './TempPasswordNotice';
import { passwordProblem } from '../lib/utils';
import { requireAudit } from '../lib/adminApi';
import { TRIAL_DURATION_HOURS } from '../lib/subscription';

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trial: 'Teste grátis',
  active: 'Ativo',
  suspended: 'Suspenso',
  expired: 'Expirado',
};
const STATUS_COLOR: Record<SubscriptionStatus, 'green' | 'red' | 'yellow' | 'blue' | 'gray'> = {
  trial: 'blue',
  active: 'green',
  suspended: 'yellow',
  expired: 'red',
};

const endOf = (c: ClientRow): Date | null => (c.effectiveStatus === 'trial' || c.status === 'trial' ? c.trialEndsAt : c.validUntil);

const fmtDate = (d: Date | null) => (d ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Sem prazo');

/** Converte "1h", "30d" etc. escolhidos no formulário em horas/dias para o RPC. Teste grátis = 1 hora. */
type Unit = 'hours' | 'days';

export const ClientsPanel: React.FC = () => {
  const { addNotification } = useAppStore();
  const { legacyMode, adminListClients, adminCreateClient, adminExtend, adminSetStatus, startImpersonation } = useStore();

  // "Abrir loja": mesmo caminho do "Acessar" do painel admin (confirmação, auditoria obrigatória e modo suporte)
  const openStore = async (c: ClientRow) => {
    const ok = await confirmDialog(
      `Você entrará no modo de suporte visualizando a loja "${c.name}".\nUm registro de auditoria imutável será gravado.\n\nDeseja continuar?`,
      { title: 'Acessar Loja (Modo Suporte)' }
    );
    if (!ok) return;
    try {
      await requireAudit(c.storeId, 'impersonate_start', { store_name: c.name, started_at: new Date().toISOString() });
      await startImpersonation(c.storeId);
      addNotification(`Agora você está em ${c.name} (modo suporte).`, 'info');
    } catch (err: any) {
      addNotification(err.message || 'Erro ao alternar para a loja.', 'error');
    }
  };

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);

  // Formulário de cadastro
  const [email, setEmail] = useState('');
  const [storeName, setStoreName] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'trial' | 'paid'>('trial');
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState<Unit>('hours');
  const [notes, setNotes] = useState('');
  const [modules, setModules] = useState<ModuleKey[]>(
    MODULES.filter(m => !m.core && m.defaultEnabled).map(m => m.key)
  );
  const [creating, setCreating] = useState(false);
  const [tempCred, setTempCred] = useState<{ email: string; password: string } | null>(null);

  // Extensão por cliente
  const [extendAmount, setExtendAmount] = useState(30);
  const [extendUnit, setExtendUnit] = useState<Unit>('days');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClients(await adminListClients());
    } catch (err: any) {
      addNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [adminListClients, addNotification]);

  useEffect(() => { if (!legacyMode) load(); else setLoading(false); }, [legacyMode, load]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const changeMode = (m: 'trial' | 'paid') => {
    setMode(m);
    if (m === 'trial') { setAmount(1); setUnit('hours'); } else { setAmount(30); setUnit('days'); }
  };

  const toggleModule = (key: ModuleKey) => {
    setModules(prev => {
      if (prev.includes(key)) {
        // Desmarcar também desmarca quem depende dele.
        const dependents = MODULES.filter(m => m.dependsOn?.includes(key)).map(m => m.key);
        return prev.filter(k => k !== key && !dependents.includes(k));
      }
      const deps = MODULES.find(m => m.key === key)?.dependsOn || [];
      return [...new Set([...prev, key, ...deps])];
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const pwdIssue = passwordProblem(password);
      if (pwdIssue) throw new Error(pwdIssue);
      const res = await adminCreateClient({
        email, storeName, password, modules, mode, notes,
        // Teste grátis é sempre de 1 hora; a duração livre vale só para plano pago.
        hours: mode === 'trial' ? TRIAL_DURATION_HOURS : (unit === 'hours' ? amount : undefined),
        days: mode === 'trial' ? undefined : (unit === 'days' ? amount : undefined),
      });
      if (res.temporaryPassword) setTempCred({ email, password: res.temporaryPassword });
      addNotification(
        res.accountCreated
          ? `Cliente "${storeName}" cadastrado e conta criada para ${email}.`
          : `Cliente "${storeName}" cadastrado. ${email} já tinha conta e virou dono da loja.`,
        'success'
      );
      setEmail(''); setStoreName(''); setPassword(''); setNotes('');
      changeMode('trial');
      await load();
    } catch (err: any) {
      addNotification(err.message, 'error');
      await load();
    } finally {
      setCreating(false);
    }
  };

  const run = async (id: string, fn: () => Promise<void>, okMsg: string) => {
    setBusyId(id);
    try {
      await fn();
      addNotification(okMsg, 'success');
      await load();
    } catch (err: any) {
      addNotification(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const extendOpts = () => (extendUnit === 'hours' ? { hours: extendAmount } : { days: extendAmount });

  const remainingText = (c: ClientRow) => {
    if (c.effectiveStatus === 'suspended') return 'Suspenso';
    if (c.effectiveStatus === 'expired') return 'Encerrado';
    const end = endOf(c);
    if (!end) return 'Sem prazo';
    return formatRemaining(end.getTime() - now);
  };

  return (
    <div className="space-y-6">
      {tempCred && <TempPasswordNotice email={tempCred.email} password={tempCred.password} onClose={() => setTempCred(null)} />}
      {legacyMode && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-sm">
          Aplique as migrações <code className="font-mono">003</code> a <code className="font-mono">006</code> no Supabase para usar o painel de clientes.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card title="Cadastrar cliente" className="xl:col-span-1">
          <form onSubmit={handleCreate} className="space-y-4">
            <Input label="E-mail da loja (login do dono)" type="email" value={email}
              onChange={e => setEmail(e.target.value)} required disabled={legacyMode} />
            <Input label="Nome da loja" value={storeName} onChange={e => setStoreName(e.target.value)} required disabled={legacyMode} />
            <Input label="Senha inicial (opcional; 10+ com letras e números)" type="text" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="Vazio = gerar senha provisória" disabled={legacyMode} />
            <p className="text-xs text-wine-500 dark:text-slate-400 -mt-2">Só vale se o e-mail ainda não tiver conta; se já tiver, ela vira dona da loja e a senha não muda.</p>

            <div className="grid grid-cols-2 gap-2">
              {(['trial', 'paid'] as const).map(m => (
                <button
                  type="button" key={m} onClick={() => changeMode(m)}
                  className={`p-3 rounded-lg border-2 text-sm text-center transition-all ${mode === m
                    ? 'border-wine-900 bg-wine-100 text-wine-900 font-bold dark:bg-wine-800 dark:text-white dark:border-wine-500'
                    : 'border-wine-100 text-wine-500 dark:border-slate-600 dark:text-slate-400'}`}
                >
                  {m === 'trial' ? 'Teste grátis' : 'Tempo de uso pago'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {mode === 'paid' && (
                <>
                  <Input label="Duração" type="number" min={1} value={amount}
                    onChange={e => setAmount(Math.max(1, Number(e.target.value) || 1))} />
                  <Select label="Unidade" value={unit} onChange={e => setUnit(e.target.value as Unit)}>
                    <option value="hours">Horas</option>
                    <option value="days">Dias</option>
                  </Select>
                </>
              )}
            </div>
            <p className="text-xs text-wine-500 dark:text-slate-400">
              {mode === 'trial'
                ? 'Teste grátis fixo de 1 hora: conta a partir de agora e bloqueia o acesso ao terminar. Para mais tempo, use "Estender" depois.'
                : 'O tempo pago conta a partir de agora; você pode estender depois.'}
            </p>

            <fieldset>
              <legend className="text-xs font-semibold text-wine-700 dark:text-slate-300 uppercase mb-2">Módulos contratados</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {MODULES.filter(m => !m.core).map(m => (
                  <label key={m.key} className="flex items-center gap-2 text-sm text-wine-900 dark:text-slate-200 rounded-lg px-3 py-2 border border-wine-100 dark:border-slate-700 cursor-pointer">
                    <input type="checkbox" className="accent-wine-700" checked={modules.includes(m.key)} onChange={() => toggleModule(m.key)} />
                    {m.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-wine-500 dark:text-slate-400 mt-2">
                Dashboard, Vendas, Clientes, Estoque e Configurações vêm sempre ligados.
              </p>
            </fieldset>

            <Input label="Observações (opcional)" value={notes} onChange={e => setNotes(e.target.value)} />

            <Button type="submit" className="w-full" disabled={legacyMode || creating || !email.trim() || !storeName.trim()}>
              <Plus size={16} /> {creating ? 'Cadastrando...' : 'Cadastrar cliente'}
            </Button>
          </form>
        </Card>

        <Card title="Clientes" className="xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 text-sm text-wine-600 dark:text-slate-400">
              Estender por
              <input
                type="number" min={1} value={extendAmount}
                onChange={e => setExtendAmount(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 px-2 py-1 border border-wine-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-black dark:text-white"
                aria-label="Quantidade para estender"
              />
              <select
                value={extendUnit} onChange={e => setExtendUnit(e.target.value as Unit)}
                className="px-2 py-1 border border-wine-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-black dark:text-white"
                aria-label="Unidade para estender"
              >
                <option value="hours">horas</option>
                <option value="days">dias</option>
              </select>
            </div>
            <Button variant="outline" onClick={load} disabled={loading || legacyMode}>
              <RefreshCcw size={16} /> Atualizar
            </Button>
          </div>

          {loading ? (
            <p className="text-sm text-wine-500 dark:text-slate-400">Carregando clientes...</p>
          ) : clients.length === 0 ? (
            <p className="text-sm text-wine-500 dark:text-slate-400">Nenhum cliente cadastrado ainda.</p>
          ) : (
            <ul className="divide-y divide-wine-50 dark:divide-slate-700">
              {clients.map(c => {
                const busy = busyId === c.storeId;
                const eff = c.effectiveStatus;
                return (
                  <li key={c.storeId} className="py-4 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-wine-950 dark:text-white flex items-center gap-2 flex-wrap">
                          {c.name}
                          <Badge color={STATUS_COLOR[eff]}>{STATUS_LABEL[eff]}</Badge>
                        </p>
                        <p className="text-xs text-wine-500 dark:text-slate-400 break-all">
                          {c.ownerEmail || c.contactEmail || 'sem e-mail'}
                          {!c.ownerEmail && c.contactEmail && ' (conta ainda não criada)'}
                        </p>
                        {c.notes && <p className="text-xs text-wine-500 dark:text-slate-400">{c.notes}</p>}
                      </div>
                      <div className="text-right text-sm shrink-0">
                        <p className="font-semibold text-wine-900 dark:text-white flex items-center gap-1 justify-end">
                          <Clock size={14} /> {remainingText(c)}
                        </p>
                        <p className="text-xs text-wine-500 dark:text-slate-400">até {fmtDate(endOf(c))}</p>
                      </div>
                    </div>
                    <p className="text-xs text-wine-500 dark:text-slate-400">
                      Módulos: {c.modules.length ? c.modules.map(k => MODULES.find(m => m.key === k)?.name || k).join(', ') : 'só os essenciais'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" disabled={busy}
                        onClick={() => run(c.storeId, () => adminExtend(c.storeId, extendOpts()),
                          `Tempo de ${c.name} estendido em ${extendAmount} ${extendUnit === 'hours' ? 'hora(s)' : 'dia(s)'}.`)}>
                        <Plus size={14} /> Estender
                      </Button>
                      {c.status === 'suspended' ? (
                        <Button variant="outline" disabled={busy}
                          onClick={() => run(c.storeId, () => adminSetStatus(c.storeId, 'active', (endOf(c) && endOf(c)!.getTime() > Date.now()) || (!c.validUntil && !c.trialEndsAt) ? {} : extendOpts()),
                            `${c.name} reativado.`)}>
                          <PlayCircle size={14} /> Reativar
                        </Button>
                      ) : (
                        <Button variant="outline" disabled={busy}
                          onClick={async () => {
                            if (await confirmDialog(`Suspender ${c.name}? Ninguém da loja consegue entrar até reativar.`)) {
                              run(c.storeId, () => adminSetStatus(c.storeId, 'suspended'), `${c.name} suspenso.`);
                            }
                          }}>
                          <PauseCircle size={14} /> Suspender
                        </Button>
                      )}
                      {c.status !== 'trial' && (
                        <Button variant="outline" disabled={busy}
                          onClick={() => run(c.storeId, () => adminSetStatus(c.storeId, 'trial', { hours: 1 }), `Novo teste de 1 hora iniciado para ${c.name}.`)}>
                          Novo teste 1h
                        </Button>
                      )}
                      {c.status === 'trial' && (
                        <Button variant="outline" disabled={busy}
                          onClick={() => run(c.storeId, () => adminSetStatus(c.storeId, 'active', extendOpts()),
                            `${c.name} passou para plano pago (${extendAmount} ${extendUnit === 'hours' ? 'h' : 'dias'}).`)}>
                          Converter em pago
                        </Button>
                      )}
                      <Button variant="outline" disabled={busy}
                        onClick={() => openStore(c)}>
                        <ExternalLink size={14} /> Abrir loja
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ClientRow } from '../contexts/StoreContext';
import { MODULES, ModuleKey } from '../lib/modules';
import { requireAudit } from '../lib/adminApi';
import { alertDialog } from './UI';
import { MotivoDialog } from './MotivoDialog';

/**
 * Abas da ficha da loja que dependem de dados do banco: plano e módulos, pagamentos e auditoria.
 * Toda mudança passa por RPC (admin_set_plan, admin_set_module_override, admin_clear_module_override).
 * Sem ativação manual: nada aqui marca a loja como paga; isso depende do webhook do Asaas.
 * Quando um dado não pode ser lido, a aba mostra "indisponível", nunca zero.
 */

const PLAN_OPTIONS = [
  { code: 'inicio', label: 'Início' },
  { code: 'crescimento', label: 'Crescimento' },
  { code: 'avancado', label: 'Avançado' },
];

type Pending =
  | { kind: 'plan'; plan: string; value: number }
  | { kind: 'grant' | 'block'; module: ModuleKey }
  | { kind: 'clear'; overrideId: string };

interface Override { id: string; module_key: string; action: 'grant' | 'block'; reason: string; expires_at: string | null }
interface Payment { id: string; amount: number; method: string | null; paid_at: string | null; source: string | null }
interface AuditRow { id: string; action: string; details: unknown; created_at: string }

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const fmtMoney = (v: number) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const PlanoModulosTab: React.FC<{ client: ClientRow; onChanged: () => void }> = ({ client, onChanged }) => {
  const [enabled, setEnabled] = useState<Record<string, boolean> | null>(null);
  const [overrides, setOverrides] = useState<Override[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [plan, setPlan] = useState(client.plan || 'inicio');
  const [value, setValue] = useState('');
  const [moduleToGrant, setModuleToGrant] = useState<ModuleKey>('reports');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const entries = await Promise.all(MODULES.map(async m => {
        const { data, error: err } = await supabase.rpc('store_module_enabled', { p_store: client.storeId, p_module: m.key });
        if (err) throw err;
        return [m.key, !!data] as const;
      }));
      setEnabled(Object.fromEntries(entries));
      const { data: ov, error: ovErr } = await supabase
        .from('store_module_overrides')
        .select('id, module_key, action, reason, expires_at')
        .eq('store_id', client.storeId)
        .is('revoked_at', null);
      setOverrides(ovErr ? null : (ov as Override[]));
    } catch {
      setLoadError(true);
    }
  }, [client.storeId]);

  useEffect(() => { load(); }, [load]);

  const runRisk = async (reason: string, expiresAt?: string) => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.kind === 'plan') {
        await requireAudit(client.storeId, 'plan_changed', { reason, from: client.plan, to: pending.plan, monthly_value: pending.value });
        const { error: err } = await supabase.rpc('admin_set_plan', { p_store: client.storeId, p_plan: pending.plan, p_monthly_value: pending.value });
        if (err) throw err;
      } else if (pending.kind === 'clear') {
        const { error: err } = await supabase.rpc('admin_clear_module_override', { p_override_id: pending.overrideId, p_reason: reason });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.rpc('admin_set_module_override', {
          p_store: client.storeId,
          p_module: pending.module,
          p_action: pending.kind === 'grant' ? 'grant' : 'revoke',
          p_reason: reason,
          p_expires_at: expiresAt ?? null,
        });
        if (err) throw err;
      }
      setPending(null);
      await load();
      onChanged();
      await alertDialog('Alteração salva.', 'Pronto');
    } catch {
      setError('Não foi possível salvar. Nada foi alterado.');
    } finally {
      setBusy(false);
    }
  };

  const pendingCopy = (): { title: string; message: string; confirm: string; withExpiry: boolean } => {
    if (!pending) return { title: '', message: '', confirm: '', withExpiry: false };
    if (pending.kind === 'plan') {
      return { title: 'Trocar plano', message: `Trocar o plano de "${client.name}" para ${PLAN_OPTIONS.find(p => p.code === pending.plan)?.label}. O efeito e o valor seguem a regra do servidor.`, confirm: 'Trocar plano', withExpiry: false };
    }
    if (pending.kind === 'clear') {
      return { title: 'Remover liberação', message: 'A liberação deixa de valer agora. O histórico continua registrado.', confirm: 'Remover', withExpiry: false };
    }
    if (pending.kind === 'grant') {
      return { title: 'Liberar módulo fora do plano', message: `Liberar ${MODULES.find(m => m.key === pending.module)?.name} em "${client.name}". Validade obrigatória.`, confirm: 'Liberar módulo', withExpiry: true };
    }
    return { title: 'Bloquear módulo', message: `Bloquear ${MODULES.find(m => m.key === pending.module)?.name} em "${client.name}".`, confirm: 'Bloquear módulo', withExpiry: false };
  };

  const copy = pendingCopy();
  const valueNumber = Number(value);

  return (
    <div className="space-y-4">
      <section>
        <h3 className="font-semibold mb-2">Trocar plano</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs">Plano
            <select value={plan} onChange={e => setPlan(e.target.value)} className="block mt-1 rounded-lg border px-2 py-1.5 text-sm bg-transparent">
              {PLAN_OPTIONS.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select>
          </label>
          <label className="text-xs">Valor mensal (R$)
            <input inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} className="block mt-1 rounded-lg border px-2 py-1.5 text-sm bg-transparent w-32" />
          </label>
          <button
            disabled={busy || !(valueNumber > 0)}
            onClick={() => setPending({ kind: 'plan', plan, value: valueNumber })}
            className="px-3 py-2 rounded-lg bg-wine-900 text-white text-sm font-semibold disabled:opacity-50"
          >
            Trocar plano
          </button>
        </div>
      </section>

      <section>
        <h3 className="font-semibold mb-2">Módulos</h3>
        {loadError && <p className="text-red-700">Não foi possível carregar os módulos. Tentar de novo: <button onClick={load} className="underline">recarregar</button></p>}
        {!loadError && enabled === null && <p className="text-wine-600">Carregando módulos…</p>}
        {enabled && (
          <ul className="grid grid-cols-1 gap-1">
            {MODULES.map(m => (
              <li key={m.key} className="flex justify-between border-b py-1">
                <span>{m.name}</span>
                <span className="text-xs">{enabled[m.key] ? 'Liberado' : 'Bloqueado'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="font-semibold mb-2">Liberações e bloqueios manuais</h3>
        {overrides === null ? (
          <p className="text-wine-600">Liberações manuais indisponíveis no momento.</p>
        ) : overrides.length === 0 ? (
          <p className="text-wine-600">Nenhuma liberação manual ativa.</p>
        ) : (
          <ul className="space-y-2">
            {overrides.map(o => (
              <li key={o.id} className="rounded-lg border p-2 text-xs">
                <div><strong>{MODULES.find(m => m.key === o.module_key)?.name || o.module_key}</strong> · {o.action === 'grant' ? 'Liberado' : 'Bloqueado'}{o.expires_at ? ` até ${fmtDate(o.expires_at)}` : ''}</div>
                <div className="text-wine-600">Motivo: {o.reason}</div>
                <button onClick={() => setPending({ kind: 'clear', overrideId: o.id })} className="mt-1 underline">Remover</button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2 items-end">
          <label className="text-xs">Módulo
            <select value={moduleToGrant} onChange={e => setModuleToGrant(e.target.value as ModuleKey)} className="block mt-1 rounded-lg border px-2 py-1.5 text-sm bg-transparent">
              {MODULES.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}
            </select>
          </label>
          <button disabled={busy} onClick={() => setPending({ kind: 'grant', module: moduleToGrant })} className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50">Liberar módulo</button>
          <button disabled={busy} onClick={() => setPending({ kind: 'block', module: moduleToGrant })} className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50">Bloquear módulo</button>
        </div>
      </section>

      {pending && (
        <MotivoDialog
          title={copy.title}
          message={copy.message}
          confirmLabel={copy.confirm}
          withExpiry={copy.withExpiry}
          busy={busy}
          error={error}
          onCancel={() => { if (!busy) { setPending(null); setError(null); } }}
          onConfirm={runRisk}
        />
      )}
    </div>
  );
};

export const AssinaturaTab: React.FC<{ client: ClientRow }> = ({ client }) => {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [billing, setBilling] = useState<{ monthly_value: number | null; last_payment_at: string | null } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [bill, pay] = await Promise.all([
        supabase.rpc('admin_list_billing'),
        supabase.from('subscription_payments').select('id, amount, method, paid_at, source').eq('store_id', client.storeId).order('paid_at', { ascending: false }).limit(20),
      ]);
      if (!alive) return;
      if (bill.error) { setFailed(true); return; }
      const row = (bill.data as any[] | null)?.find(r => r.store_id === client.storeId);
      setBilling(row ? { monthly_value: row.monthly_value, last_payment_at: row.last_payment_at } : { monthly_value: null, last_payment_at: null });
      setPayments(pay.error ? null : (pay.data as Payment[]));
    })();
    return () => { alive = false; };
  }, [client.storeId]);

  return (
    <div className="space-y-3 text-sm">
      {failed && <p className="rounded-lg bg-wine-50 dark:bg-slate-900 p-3">Pagamentos indisponíveis no momento. Os dados da assinatura continuam válidos.</p>}
      {!failed && billing === null && <p>Carregando…</p>}
      {!failed && billing && (
        <dl className="space-y-1">
          <div><dt className="inline text-wine-500">Valor mensal: </dt><dd className="inline">{billing.monthly_value == null ? '—' : fmtMoney(billing.monthly_value)}</dd></div>
          <div><dt className="inline text-wine-500">Último pagamento: </dt><dd className="inline">{fmtDate(billing.last_payment_at)}</dd></div>
        </dl>
      )}
      {!failed && payments === null && billing && <p className="rounded-lg bg-wine-50 dark:bg-slate-900 p-3">Pagamentos indisponíveis no momento.</p>}
      {!failed && payments && payments.length === 0 && <p className="rounded-lg bg-wine-50 dark:bg-slate-900 p-3">Nenhum pagamento registrado ainda.</p>}
      {!failed && payments && payments.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-left text-wine-500"><tr><th>Data</th><th>Valor</th><th>Forma</th><th>Origem</th></tr></thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id} className="border-t"><td>{fmtDate(p.paid_at)}</td><td>{fmtMoney(p.amount)}</td><td>{p.method || '—'}</td><td>{p.source || '—'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-wine-500">Pagamentos são só leitura. Registro manual fica fora desta tela até a decisão D-A4.</p>
    </div>
  );
};

export const AuditoriaTab: React.FC<{ client: ClientRow }> = ({ client }) => {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('admin_audit_logs')
        .select('id, action, details, created_at')
        .eq('store_id', client.storeId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (!alive) return;
      if (error) setFailed(true);
      else setRows(data as AuditRow[]);
    })();
    return () => { alive = false; };
  }, [client.storeId]);

  if (failed) return <p className="rounded-lg bg-wine-50 dark:bg-slate-900 p-3 text-sm">Auditoria indisponível no momento.</p>;
  if (rows === null) return <p className="text-sm">Carregando…</p>;
  if (rows.length === 0) return <p className="rounded-lg bg-wine-50 dark:bg-slate-900 p-3 text-sm">Nenhuma ação registrada nesta loja.</p>;

  return (
    <ul className="space-y-2 text-xs">
      {rows.map(r => {
        const d = (r.details ?? {}) as Record<string, unknown>;
        return (
          <li key={r.id} className="border-b pb-2">
            <div><strong>{r.action}</strong> · {fmtDate(r.created_at)}</div>
            {typeof d.reason === 'string' && <div className="text-wine-600">Motivo: {d.reason}</div>}
          </li>
        );
      })}
    </ul>
  );
};

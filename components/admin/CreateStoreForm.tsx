import React, { useState } from 'react';
import { createStore } from '../../lib/adminApi';
import { PLANS, PlanCode, formatPlanPrice, planSellersLabel } from '../../lib/plans';
import { TempPasswordNotice } from '../TempPasswordNotice';

/**
 * Criar loja pelo admin (decisões 30 e 34): em teste ou paga, pela mesma RPC de criação do cadastro.
 * Duração do teste: padrão do servidor (decisão 3 pendente com o dono).
 * Conta nova do dono: senha provisória 12345678 (decisão 40), mostrada uma vez.
 */
export const CreateStoreForm: React.FC<{ onCreated: () => void; onCancel: () => void }> = ({ onCreated, onCancel }) => {
  const [storeName, setStoreName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<PlanCode>('inicio');
  const [mode, setMode] = useState<'trial' | 'paid'>('trial');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; password: string | null; accountCreated: boolean } | null>(null);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const daysNum = Math.floor(Number(days));
  const valid = storeName.trim().length >= 2 && ownerName.trim().length >= 2 && emailOk && (mode === 'trial' || daysNum > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) { setError('Preencha nome da loja, nome do dono, um e-mail válido e o prazo.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await createStore({ storeName, ownerName, email, plan, mode, days: mode === 'paid' ? daysNum : undefined });
      setDone({ email: email.trim(), password: res.temporaryPassword, accountCreated: res.accountCreated });
      onCreated();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível criar a loja.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'mt-1 w-full rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2 text-sm bg-white dark:bg-slate-900 text-wine-950 dark:text-white';

  if (done) {
    return (
      <div className="space-y-4 text-sm text-wine-800 dark:text-slate-200" data-testid="create-store-done">
        <p className="font-semibold">Loja criada.</p>
        {done.accountCreated && done.password
          ? <TempPasswordNotice email={done.email} password={done.password} onClose={onCancel} />
          : <p>O e-mail {done.email} já tinha conta: a pessoa entra com a senha que já usa.</p>}
        <button onClick={onCancel} className="w-full py-2 rounded-lg border border-wine-200 dark:border-slate-600">Fechar</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-sm text-wine-800 dark:text-slate-200" noValidate>
      <label className="block">Nome da loja *<input className={input} value={storeName} onChange={e => setStoreName(e.target.value)} /></label>
      <label className="block">Nome do dono *<input className={input} value={ownerName} onChange={e => setOwnerName(e.target.value)} /></label>
      <label className="block">E-mail do dono *<input type="email" autoComplete="off" className={input} value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="block">Plano
        <select className={input} value={plan} onChange={e => setPlan(e.target.value as PlanCode)}>
          {PLANS.map(p => <option key={p.code} value={p.code}>{p.name} — {formatPlanPrice(p.priceCents)}/mês · {planSellersLabel(p).toLowerCase()}</option>)}
        </select>
      </label>
      <fieldset className="space-y-1">
        <legend className="font-medium">Tipo</legend>
        <label className="flex gap-2"><input type="radio" name="modo" checked={mode === 'trial'} onChange={() => setMode('trial')} /> Em teste (prazo padrão do sistema)</label>
        <label className="flex gap-2"><input type="radio" name="modo" checked={mode === 'paid'} onChange={() => setMode('paid')} /> Paga</label>
      </fieldset>
      {mode === 'paid' && (
        <label className="block">Prazo pago (dias) *<input type="number" min={1} max={3650} className={input} value={days} onChange={e => setDays(e.target.value)} /></label>
      )}
      <p className="text-xs text-wine-500 dark:text-slate-400">Se o e-mail ainda não tiver conta, ela é criada com a senha provisória 12345678; o dono troca depois.</p>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={busy || !valid} className="flex-1 py-2 rounded-lg bg-wine-900 text-white font-semibold disabled:opacity-50">{busy ? 'Criando…' : 'Criar loja'}</button>
        <button type="button" onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-lg border border-wine-200 dark:border-slate-600">Cancelar</button>
      </div>
    </form>
  );
};

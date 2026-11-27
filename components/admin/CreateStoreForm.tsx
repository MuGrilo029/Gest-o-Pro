import React, { useRef, useState } from 'react';
import { CreateStoreInput, CreateStoreResult, createStore } from '../../lib/adminApi';
import { PLANS, PlanCode, formatPlanPrice, planSellersLabel } from '../../lib/plans';
import { forgetRequest, requestIdFor } from '../../lib/createStoreRequest';
import { TempPasswordNotice } from '../TempPasswordNotice';

/**
 * Criar loja pelo admin (decisões 30 e 34; pedido do dono de 27/11): uma chamada só no servidor,
 * que cria loja e login juntos, sem deixar loja órfã.
 * - Um envio por vez (trava imediata, além do botão desabilitado).
 * - Tentar de novo com os mesmos dados reusa a mesma chave de repetição: não duplica.
 * - Senha provisória aparece só quando a conta é nova.
 * Duração do teste: padrão do servidor (decisão 3 pendente com o dono).
 */
export const CreateStoreForm: React.FC<{
  onCreated: () => void;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
}> = ({ onCreated, onCancel, onBusyChange }) => {
  const [storeName, setStoreName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<PlanCode>('inicio');
  const [mode, setMode] = useState<'trial' | 'paid'>('trial');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<(CreateStoreResult & { email: string }) | null>(null);
  // Trava síncrona: dois cliques no mesmo instante não viram dois pedidos.
  const sending = useRef(false);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const daysNum = Math.floor(Number(days));
  const valid = storeName.trim().length >= 2 && ownerName.trim().length >= 2 && emailOk && (mode === 'trial' || daysNum > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending.current) return;
    if (!valid) { setError('Preencha nome da loja, nome do dono, um e-mail válido e o prazo.'); return; }
    sending.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    const input: CreateStoreInput = { storeName, ownerName, email, plan, mode, days: mode === 'paid' ? daysNum : undefined };
    try {
      const res = await createStore(input, requestIdFor(input));
      forgetRequest(input);
      setDone({ ...res, email: email.trim() });
      onCreated();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível criar a loja.');
    } finally {
      sending.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const input = 'mt-1 w-full rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2 text-sm bg-white dark:bg-slate-900 text-wine-950 dark:text-white disabled:opacity-60';

  if (done) {
    return (
      <div className="space-y-4 text-sm text-wine-800 dark:text-slate-200" data-testid="create-store-done">
        <p className="font-semibold">Loja criada.</p>
        {done.alreadyCreated && <p>Este pedido já tinha criado a loja: nada foi duplicado.</p>}
        {done.accountCreated
          ? done.temporaryPassword
            ? <TempPasswordNotice email={done.email} password={done.temporaryPassword} onClose={onCancel} />
            : <p>A conta de {done.email} foi criada. Se a pessoa não tiver a senha, troque em Gerenciar → Equipe.</p>
          : <p>O e-mail {done.email} já tinha conta: a pessoa entra com a senha que já usa.</p>}
        <button onClick={onCancel} className="w-full py-2 rounded-lg border border-wine-200 dark:border-slate-600">Fechar</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-sm text-wine-800 dark:text-slate-200" noValidate aria-busy={busy}>
      <fieldset disabled={busy} className="space-y-3">
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
      </fieldset>
      <p className="text-xs text-wine-500 dark:text-slate-400">Se o e-mail ainda não tiver conta, ela é criada com uma senha provisória, mostrada uma vez; o dono troca depois.</p>
      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 p-3 text-red-700 dark:text-red-300">
          <p className="font-semibold">A loja não foi confirmada.</p>
          <p>{error}</p>
          <p className="text-xs mt-1">Pode tentar de novo: repetir o mesmo pedido não cria uma segunda loja.</p>
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={busy || !valid} className="flex-1 py-2 rounded-lg bg-wine-900 text-white font-semibold disabled:opacity-50">
          {busy ? 'Criando…' : error ? 'Tentar de novo' : 'Criar loja'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-lg border border-wine-200 dark:border-slate-600 disabled:opacity-50">Cancelar</button>
      </div>
    </form>
  );
};

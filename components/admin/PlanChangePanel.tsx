import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { changePlan } from '../../lib/adminApi';
import { StoreMember, listStoreMembers, removeStoreMember } from '../../lib/teamApi';
import { PLANS, PlanCode, formatPlanPrice, getPlan, planRank, planSellersLabel, sellersToRemoveFor } from '../../lib/plans';
import { alertDialog, confirmDialog } from '../UI';

/**
 * Trocar plano (decisões 1, 4 e 34).
 * Downgrade: a tela avisa e obriga excluir os vendedores excedentes ANTES de trocar.
 * O botão de troca só libera quando a loja cabe no plano de destino; o banco confere de novo.
 */
export const PlanChangePanel: React.FC<{
  storeId: string;
  storeName: string;
  currentPlan: PlanCode | null;
  onChanged: () => void;
}> = ({ storeId, storeName, currentPlan, onChanged }) => {
  const [target, setTarget] = useState<PlanCode>(currentPlan ?? 'inicio');
  const [members, setMembers] = useState<StoreMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setMembers(await listStoreMembers(storeId));
    } catch (e: any) {
      setMembers(null);
      setLoadError(e?.message || 'Não foi possível ler a equipe da loja.');
    }
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const sellers = (members || []).filter(m => m.role === 'SELLER');
  const isDowngrade = currentPlan !== null && planRank(target) < planRank(currentPlan);
  const excess = members ? sellersToRemoveFor(target, sellers.length) : 0;
  const same = target === currentPlan;
  const canChange = !!members && !same && excess === 0 && !busy;

  const removeSeller = async (m: StoreMember) => {
    if (!(await confirmDialog(`Excluir ${m.name || m.email} da loja "${storeName}"? A pessoa perde o acesso.`, { title: 'Excluir vendedor', confirmLabel: 'Excluir', danger: true }))) return;
    setBusy(true);
    try {
      await removeStoreMember(storeId, m.userId);
      await load();
    } catch (e: any) {
      await alertDialog(e?.message || 'Não foi possível excluir.', 'Erro');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    const plan = getPlan(target);
    if (!(await confirmDialog(`Trocar o plano de "${storeName}" para ${plan.name}?`, { title: 'Trocar plano', confirmLabel: 'Trocar plano' }))) return;
    setBusy(true);
    try {
      const res = await changePlan(storeId, target);
      onChanged();
      const when = res?.status === 'agendado' && res.effective ? ` A troca vale a partir de ${new Date(res.effective).toLocaleString('pt-BR')}.` : '';
      await alertDialog(`Plano de "${storeName}": ${plan.name}.${when}`, 'Pronto');
    } catch (e: any) {
      await alertDialog(e?.message || 'Não foi possível trocar o plano. Nada foi alterado.', 'Erro');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="plan-change">
      <p>Plano atual: <strong>{currentPlan ? getPlan(currentPlan).name : 'sem assinatura'}</strong>{members && <> · {sellers.length} vendedor(es)</>}</p>

      <fieldset className="space-y-2">
        <legend className="font-semibold text-wine-950 dark:text-white mb-1">Novo plano</legend>
        {PLANS.map(p => (
          <label key={p.code} className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer ${target === p.code ? 'border-wine-700 bg-wine-50 dark:bg-slate-700/50' : 'border-wine-100 dark:border-slate-700'}`}>
            <input type="radio" name="novo-plano" checked={target === p.code} onChange={() => setTarget(p.code)} className="mt-1" />
            <span>
              <span className="font-semibold">{p.name}</span> — {formatPlanPrice(p.priceCents)}/mês · {planSellersLabel(p).toLowerCase()}
              {p.code === currentPlan && <span className="ml-1 text-xs text-wine-500">(atual)</span>}
            </span>
          </label>
        ))}
      </fieldset>

      {loadError && <p role="alert" className="text-red-700">{loadError}</p>}
      {!members && !loadError && <p className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Lendo a equipe…</p>}

      {members && isDowngrade && excess > 0 && (
        <div role="alert" className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 space-y-2" data-testid="downgrade-warning">
          <p className="font-semibold">
            O plano {getPlan(target).name} aceita {getPlan(target).maxSellers} vendedor(es) e a loja tem {sellers.length}.
            Exclua {excess} vendedor(es) antes de trocar.
          </p>
          <ul className="divide-y divide-amber-200 dark:divide-amber-800">
            {sellers.map(m => (
              <li key={m.userId} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 break-all">{m.name || '—'} · {m.email}</span>
                <button disabled={busy} onClick={() => removeSeller(m)} aria-label={`Excluir vendedor ${m.email}`} className="shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-red-300 text-red-700 text-xs font-semibold disabled:opacity-60">
                  <Trash2 size={14} aria-hidden="true" /> Excluir
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {members && isDowngrade && excess === 0 && !same && (
        <p className="text-sm text-wine-600 dark:text-slate-400">A loja cabe no plano {getPlan(target).name}: módulos fora dele deixam de aparecer para a loja.</p>
      )}

      <button onClick={apply} disabled={!canChange} className="px-4 py-2 rounded-lg bg-wine-900 text-white text-sm font-semibold disabled:opacity-50">
        {busy ? 'Salvando…' : 'Trocar plano'}
      </button>
    </div>
  );
};

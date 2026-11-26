import React, { useState } from 'react';
import { Check, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useStore } from '../contexts/StoreContext';
import { PLANS, PlanCode, CHOOSE_PLAN_RPC, formatPlanPrice, planSellersLabel } from '../lib/plans';
import { alertDialog, confirmDialog } from './UI';

/**
 * Escolha de plano para o dono durante o teste grátis.
 * Só aparece para o dono da loja com teste ativo. Escolher um plano ativa os módulos
 * dele no servidor (a RPC decide tudo); esta tela não liga módulo por conta própria.
 * Pagamento online (Asaas) fica desligado até as chaves existirem: não há checkout aqui.
 */
export const PlanChoice: React.FC = () => {
  const { activeStore, subscription, isPlatformAdmin, reload } = useStore();
  const [busy, setBusy] = useState<PlanCode | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (isPlatformAdmin || activeStore?.role !== 'OWNER' || subscription?.status !== 'trial') return null;

  const choose = async (code: PlanCode, name: string, priceCents: number) => {
    const ok = await confirmDialog(
      `Ativar o plano ${name} (${formatPlanPrice(priceCents)}/mês) nesta loja? Os módulos do plano serão liberados.`,
      { title: 'Escolher plano', confirmLabel: 'Ativar plano' },
    );
    if (!ok) return;
    setBusy(code);
    setMessage(null);
    const { error } = await supabase.rpc(CHOOSE_PLAN_RPC, { p_store: activeStore.id, p_plan: code });
    setBusy(null);
    if (error) {
      const missing = error.code === 'PGRST202' || error.code === '42883' || /could not find the function|does not exist/i.test(error.message || '');
      setMessage(missing
        ? 'A ativação de planos ainda não está disponível. Seu teste grátis continua normal.'
        : 'Não foi possível ativar o plano agora. Tente de novo em instantes.');
      return;
    }
    await reload();
    await alertDialog(`Plano ${name} ativado. Os módulos já estão liberados.`, 'Plano ativado');
  };

  return (
    <section className="mb-6 rounded-xl border border-wine-200 dark:border-slate-700 bg-wine-50/60 dark:bg-slate-900/40 p-5" aria-labelledby="plan-choice-title">
      <div className="flex items-center gap-2 mb-1">
        <Clock size={16} className="text-wine-700 dark:text-slate-300" aria-hidden="true" />
        <h3 id="plan-choice-title" className="text-lg font-semibold text-wine-900 dark:text-white">Escolha seu plano</h3>
      </div>
      <p className="text-sm text-wine-600 dark:text-slate-400 mb-4">
        Seus dados continuam os mesmos durante o teste. Ao escolher um plano, a loja recebe os módulos dele.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map(plan => (
          <article
            key={plan.code}
            className={`flex flex-col rounded-xl bg-white dark:bg-slate-800 p-5 border ${plan.recommended ? 'border-wine-700 ring-2 ring-wine-200 dark:ring-wine-900' : 'border-wine-100 dark:border-slate-700'}`}
          >
            {plan.recommended && (
              <span className="self-start mb-2 text-xs font-semibold uppercase tracking-wide text-wine-700 dark:text-wine-300">Recomendado</span>
            )}
            <h4 className="text-xl font-bold text-wine-950 dark:text-white">{plan.name}</h4>
            <p className="text-2xl font-bold text-wine-900 dark:text-white mt-1">
              {formatPlanPrice(plan.priceCents)}<span className="text-sm font-normal text-wine-500 dark:text-slate-400">/mês</span>
            </p>
            <p className="text-sm text-wine-600 dark:text-slate-400 mb-3">{planSellersLabel(plan)}</p>

            <ul className="space-y-2 mb-5 text-sm text-wine-800 dark:text-slate-200 flex-1">
              {plan.features.map(item => (
                <li key={item} className="flex gap-2">
                  <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => choose(plan.code, plan.name, plan.priceCents)}
              disabled={busy !== null}
              className="w-full py-2.5 rounded-lg bg-wine-900 text-white font-semibold hover:bg-wine-800 disabled:opacity-60 transition-colors"
            >
              {busy === plan.code ? 'Ativando...' : `Escolher ${plan.name}`}
            </button>
          </article>
        ))}
      </div>

      {message && (
        <p role="status" className="mt-4 text-sm text-wine-800 dark:text-slate-200">{message}</p>
      )}
    </section>
  );
};

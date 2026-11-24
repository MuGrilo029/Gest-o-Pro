import React from 'react';
import { Clock, LogOut, RefreshCcw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';

/**
 * Tela exibida quando a loja ativa está com o teste encerrado, a validade
 * vencida ou o acesso suspenso. O bloqueio real é feito no banco (RLS);
 * esta tela só explica o motivo e como renovar.
 */
export const AccessExpired: React.FC = () => {
  const { user, signOut } = useAuth();
  const { activeStore, subscription, reload, stores, switchStore } = useStore();

  const suspended = subscription?.status === 'suspended';
  const wasTrial = subscription?.status === 'expired' && subscription.plan === 'trial';
  const title = suspended ? 'Acesso suspenso' : wasTrial ? 'Seu teste grátis terminou' : 'Seu acesso expirou';
  const text = suspended
    ? 'O acesso desta loja foi suspenso. Fale com o suporte para regularizar.'
    : wasTrial
      ? 'O período de teste desta loja chegou ao fim. Seus dados continuam guardados: assim que o plano for ativado, tudo volta ao normal.'
      : 'O tempo de uso contratado desta loja acabou. Seus dados continuam guardados: assim que o acesso for renovado, tudo volta ao normal.';

  const otherStores = stores.filter(s => s.id !== activeStore?.id);

  return (
    <div className="min-h-screen flex items-center justify-center bg-wine-50 dark:bg-slate-900 px-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-wine-100 dark:border-slate-700 p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-50 dark:bg-slate-700 flex items-center justify-center text-amber-600">
          <Clock size={32} />
        </div>
        <h1 className="text-2xl font-bold text-wine-950 dark:text-white mb-2">{title}</h1>
        {activeStore && (
          <p className="text-sm text-wine-500 dark:text-slate-400 mb-3">Loja: <strong>{activeStore.name}</strong></p>
        )}
        <p className="text-wine-600 dark:text-slate-400 mb-6">{text}</p>
        <p className="text-xs text-wine-500 dark:text-slate-500 mb-6">
          Conta: {user?.email}. Para renovar, entre em contato com o responsável pelo sistema.
        </p>

        <button
          onClick={() => reload()}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-wine-900 text-white font-semibold hover:bg-wine-800 transition-colors"
        >
          <RefreshCcw size={18} /> Já renovei, verificar de novo
        </button>

        {otherStores.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-wine-500 dark:text-slate-400">Ou use outra loja:</p>
            {otherStores.map(s => (
              <button
                key={s.id}
                onClick={() => { switchStore(s.id).catch(() => undefined); }}
                className="w-full py-2 rounded-lg border border-wine-200 dark:border-slate-600 text-wine-800 dark:text-slate-200 text-sm hover:bg-wine-50 dark:hover:bg-slate-700"
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => signOut()}
          className="mt-4 w-full flex items-center justify-center gap-2 py-2 text-sm text-wine-600 dark:text-slate-400 hover:text-red-600 transition-colors"
        >
          <LogOut size={16} /> Sair
        </button>
      </div>
    </div>
  );
};

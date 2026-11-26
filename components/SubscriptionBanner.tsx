import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';

import { formatRemaining } from '../lib/subscription';
export { formatRemaining };

/**
 * Aviso de tempo restante: sempre no teste grátis; no plano pago só nos
 * últimos 7 dias. O administrador da plataforma não vê.
 */
export const SubscriptionBanner: React.FC<{ floating?: boolean }> = ({ floating = false }) => {
  const { subscription, isPlatformAdmin, isManager } = useStore();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Vendedor não vê assinatura nem prazo do plano (só dono e gerente)
  if (isPlatformAdmin || !isManager || !subscription?.accessOk || !subscription.endsAt) return null;
  const remaining = subscription.endsAt.getTime() - now;
  const isTrial = subscription.status === 'trial';
  if (!isTrial && remaining > 7 * 86400 * 1000) return null;

  const urgent = remaining < 30 * 60 * 1000;
  const text = isTrial
    ? `Teste grátis: restam ${formatRemaining(remaining)}`
    : `Seu acesso vence em ${formatRemaining(remaining)}`;

  const color = urgent
    ? 'bg-red-600 text-white'
    : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100';

  if (floating) {
    return (
      <div className={`fixed top-2 left-1/2 -translate-x-1/2 z-[60] px-3 py-1 rounded-full text-xs font-semibold shadow flex items-center gap-1 ${color}`}>
        <Clock size={12} /> {text}
      </div>
    );
  }
  return (
    <div className={`px-4 py-1.5 text-sm font-medium flex items-center justify-center gap-2 print:hidden ${color}`}>
      <Clock size={14} /> {text}
    </div>
  );
};

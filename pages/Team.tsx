import React from 'react';
import { TeamPanel } from '../components/TeamPanel';
import { useStore } from '../contexts/StoreContext';

/** Equipe da loja: dono e gerente criam e gerenciam os vendedores. */
export const Team: React.FC = () => {
  const { activeStore, isPlatformAdmin } = useStore();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-wine-950 dark:text-white">Equipe</h1>
        <p className="text-wine-600 dark:text-slate-400">
          {isPlatformAdmin
            ? `Pessoas com acesso a ${activeStore?.name}.`
            : `Crie o acesso dos vendedores de ${activeStore?.name} com e-mail e senha e escolha as telas de cada um.`}
        </p>
      </div>
      <TeamPanel />
    </div>
  );
};

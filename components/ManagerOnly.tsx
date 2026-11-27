import React from 'react';
import { useStore } from '../contexts/StoreContext';

/**
 * Mostra o conteúdo só para quem o banco deixa executar a ação: dono ou gerente da loja,
 * ou o dono do SaaS. Usado nos botões de excluir (o vendedor não exclui; ver docs/matriz-papeis.md).
 * É só a camada visual: a regra de verdade fica no RLS/RPC.
 */
export const useCanManageStore = () => {
  const { isManager, isPlatformAdmin } = useStore();
  return isManager || isPlatformAdmin;
};

/** Só o dono da loja (ou o dono do SaaS): marca, dados da loja e plano (`stores_update` e `choose_trial_plan` só OWNER). */
export const useIsStoreOwner = () => {
  const { role, isPlatformAdmin } = useStore();
  return role === 'OWNER' || isPlatformAdmin;
};

export const ManagerOnly: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  useCanManageStore() ? <>{children}</> : null;

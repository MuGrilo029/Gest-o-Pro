import { useStore } from '../contexts/StoreContext';
import { hideBoletoUi } from '../lib/boletos';

/** Esconde as opções de boleto na loja Início sem o módulo Boletos. */
export const useHideBoleto = (): boolean => {
  const { subscription, isModuleEnabled } = useStore();
  return hideBoletoUi(subscription?.plan, isModuleEnabled('boletos'));
};

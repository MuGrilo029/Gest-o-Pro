import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../contexts/StoreContext';

/**
 * Pode enviar e abrir anexos de boleto na loja ativa? Pergunta ao banco (can_access_boletos, 068).
 * Em dúvida (erro ou função ausente), não mostra.
 */
export const useBoletoAccess = (): boolean => {
  const { activeStore, isModuleEnabled } = useStore();
  const storeId = activeStore?.id;
  const modules = isModuleEnabled('boletos') && isModuleEnabled('financial');
  const [allowed, setAllowed] = useState<{ storeId: string; value: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    if (!storeId) return;
    supabase.rpc('can_access_boletos').then(({ data, error }) => {
      if (alive) setAllowed({ storeId, value: !error && data === true });
    });
    return () => { alive = false; };
  }, [storeId, modules]);

  return !!allowed && allowed.storeId === storeId && allowed.value;
};

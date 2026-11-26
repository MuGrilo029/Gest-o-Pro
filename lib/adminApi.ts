import { supabase } from './supabase';

/**
 * Ponto único de acesso às funções do painel admin da plataforma.
 * As funções da migração 018 (ainda não aplicada) ficam aqui: enquanto não existirem no banco,
 * cada chamada devolve { available: false } e a tela mostra o estado "aguardando".
 */
export type AdminCall<T> = { available: true; data: T } | { available: false };

const isMissingFunction = (error: any) =>
  !!error && (error.code === 'PGRST202' || error.code === '42883' || /function .* does not exist|Could not find the function/i.test(error.message || ''));

export const callAdminFunction = async <T>(name: string, params?: Record<string, unknown>): Promise<AdminCall<T>> => {
  const { data, error } = await supabase.rpc(name, params ?? {});
  if (error) {
    if (isMissingFunction(error)) return { available: false };
    throw error;
  }
  return { available: true, data: data as T };
};

export interface AdminMetrics {
  ativas: number;
  em_teste: number;
  atrasadas: number;
  mrr_cents: number;
  ativas_sem_valor: number;
}

/** Métricas calculadas no banco (MRR a partir do valor mensal de cada loja). */
export const fetchAdminMetrics = () => callAdminFunction<AdminMetrics>('admin_metrics');

/**
 * Registro de auditoria OBRIGATÓRIO: a ação administrativa só pode acontecer depois que o registro
 * for gravado. Se o registro falhar (ou a função não existir), lança erro e a ação não é executada.
 */
export const requireAudit = async (storeId: string | null, action: string, details: Record<string, unknown>) => {
  const res = await callAdminFunction<unknown>('admin_log_audit', {
    p_store_id: storeId,
    p_action: action,
    p_details: details,
  });
  if (!res.available) {
    throw new Error('Registro de auditoria indisponível. A ação não foi executada.');
  }
};

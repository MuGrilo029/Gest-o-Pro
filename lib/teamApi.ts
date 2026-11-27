import { supabase } from './supabase';
import { AppView } from '../types';
import { StoreRole } from './modules';

/**
 * Equipe de uma loja por id: usado pela tela de Equipe (loja ativa) e pelo painel admin
 * (qualquer loja, sem trocar a loja ativa). As regras de quem pode o quê ficam no banco
 * (list_store_members / update_store_member / remove_store_member) e na Edge Function manage-users.
 */

export interface StoreMember {
  userId: string;
  email: string;
  name: string;
  role: StoreRole;
  permissions: AppView[];
  createdAt: string;
}

/** Prefixos combinados com o Backend (ERRCODE P0001; o manage-users devolve 409 com a mesma mensagem). */
export const SELLER_LIMIT_ERROR_PREFIX = 'LIMITE_VENDEDORES:';
const TEAM_ERROR_PREFIXES = [SELLER_LIMIT_ERROR_PREFIX, 'UMA_LOJA_POR_DONO:'];

/** Troca o código técnico do erro por uma frase para a tela. */
export const friendlyTeamError = (message: string): string => {
  const prefix = TEAM_ERROR_PREFIXES.find(p => message.startsWith(p));
  if (!prefix) return message;
  const rest = message.slice(prefix.length).trim();
  if (rest) return rest;
  return prefix === SELLER_LIMIT_ERROR_PREFIX ? 'O plano da loja atingiu o limite de vendedores.' : 'Este dono já tem uma loja.';
};

export const listStoreMembers = async (storeId: string): Promise<StoreMember[]> => {
  const { data, error } = await supabase.rpc('list_store_members', { p_store: storeId });
  if (error) throw new Error(error.message);
  return (data || []).map((m: any) => ({
    userId: m.user_id,
    email: m.email,
    name: m.name,
    role: m.role,
    permissions: m.permissions || [],
    createdAt: m.created_at,
  }));
};

/** Chama a Edge Function manage-users e devolve a mensagem de erro dela, se houver. */
export const callManageUsers = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke('manage-users', { body });
  if (error) {
    let message = error.message;
    try {
      const payload = await (error as any).context?.json?.();
      if (payload?.error) message = payload.error;
    } catch { /* resposta sem JSON */ }
    throw new Error(friendlyTeamError(message));
  }
  if (data?.error) throw new Error(friendlyTeamError(data.error));
  return data;
};

export const createStoreMember = async (
  storeId: string,
  input: { email: string; name: string; password: string; role: StoreRole; permissions: AppView[] },
) => {
  const data = await callManageUsers({
    action: 'create_member',
    store_id: storeId,
    email: input.email,
    name: input.name,
    password: input.password,
    role: input.role,
    permissions: input.role === 'SELLER' ? input.permissions : [],
  });
  return { existingAccount: !!data?.existing_account, temporaryPassword: (data?.temporary_password as string) || null };
};

export const setStoreMemberPassword = async (storeId: string, userId: string, password: string) => {
  const data = await callManageUsers({ action: 'set_password', store_id: storeId, user_id: userId, password });
  return (data?.temporary_password as string) || null;
};

export const updateStoreMember = async (storeId: string, userId: string, role: StoreRole, permissions: AppView[]) => {
  const { error } = await supabase.rpc('update_store_member', {
    p_store: storeId, p_user: userId, p_role: role, p_permissions: permissions,
  });
  if (error) throw new Error(friendlyTeamError(error.message));
};

export const removeStoreMember = async (storeId: string, userId: string) => {
  const { error } = await supabase.rpc('remove_store_member', { p_store: storeId, p_user: userId });
  if (error) throw new Error(friendlyTeamError(error.message));
};

/** Mascara o e-mail para quem não é admin da plataforma (ex.: j***@dominio.com). */
export const maskEmail = (email: string): string => {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
};

/** Quantos vendedores a loja tem (o limite do plano conta só o papel SELLER). */
export const countSellers = (members: StoreMember[]) => members.filter(m => m.role === 'SELLER').length;

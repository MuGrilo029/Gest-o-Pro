import { supabase } from './supabase';

/**
 * Links dos documentos legais exibidos no cadastro.
 * Política de Privacidade: seção #privacidade da página pública.
 * Termos de Uso: NÃO publicados (decisão 47: rascunho do Produto, publicação fora desta entrega).
 * TERMS_URL continua null até a aprovação; enquanto isso o link aponta para o rascunho
 * (VITE_TERMS_DRAFT_URL), se configurado. Nada aqui publica os Termos.
 */
export const PRIVACY_URL = 'https://gest-o-pro-three.vercel.app/#privacidade';
export const TERMS_URL: string | null = null;

const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;

/** Rascunho dos Termos (link interno de revisão). Vazio = sem link. */
export const TERMS_DRAFT_URL: string | null = env.VITE_TERMS_DRAFT_URL?.trim() || null;

/** Link que o cadastro mostra: o publicado, se existir; senão o rascunho. */
export const termsLink = (): { url: string; draft: boolean } | null =>
  TERMS_URL ? { url: TERMS_URL, draft: false } : TERMS_DRAFT_URL ? { url: TERMS_DRAFT_URL, draft: true } : null;

/** Versão dos Termos aceita no cadastro (gravada pela RPC do Backend). */
export const TERMS_VERSION = 'rascunho-2026-11';

/** Aceite guardado enquanto o e-mail aguarda confirmação; gravado no primeiro login. */
export const PENDING_TERMS_KEY = 'pendingTermsVersion';

const isMissingFunction = (error: any) =>
  !!error && (error.code === 'PGRST202' || error.code === '42883' || /function .* does not exist|Could not find the function/i.test(error.message || ''));

/**
 * Grava o aceite dos Termos do usuário logado (RPC record_terms_acceptance).
 * Enquanto a RPC não existir no banco, não bloqueia o cadastro (devolve false).
 * Qualquer outro erro é lançado: o cadastro para e mostra a mensagem.
 */
export const recordTermsAcceptance = async (version: string = TERMS_VERSION): Promise<boolean> => {
  const { error } = await supabase.rpc('record_terms_acceptance', { p_version: version });
  if (!error) return true;
  if (isMissingFunction(error)) {
    console.warn('LEGAL: record_terms_acceptance ainda não existe no banco; aceite não gravado.');
    return false;
  }
  throw new Error('Não foi possível registrar o aceite dos Termos. Tente de novo.');
};

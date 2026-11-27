/**
 * Regras puras de privacidade e de acesso do admin (sem Supabase, testáveis em Node).
 */

/** Mascara o e-mail para quem não é admin da plataforma (ex.: j***@dominio.com). */
export const maskEmail = (email: string): string => {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
};

/** E-mail de outra pessoa como aparece na tela: completo só para o admin da plataforma. */
export const displayEmail = (email: string, isPlatformAdmin: boolean): string =>
  isPlatformAdmin ? email : maskEmail(email);

/**
 * Identificação em avisos, confirmações e aria-labels: o admin vê o e-mail;
 * os demais veem o nome ou o e-mail mascarado (nunca o e-mail completo).
 */
export const memberLabel = (m: { email: string; name?: string | null }, isPlatformAdmin: boolean): string =>
  isPlatformAdmin ? m.email : (m.name?.trim() || maskEmail(m.email));

/**
 * Impersonação só vale para o dono do SaaS (decisão 36). Um valor salvo no navegador por outra conta
 * é ignorado: quem não é admin nunca vê o banner nem o modo de loja aberta.
 */
export const effectiveImpersonation = <T>(stored: T | null, isPlatformAdmin: boolean): T | null =>
  isPlatformAdmin ? stored : null;

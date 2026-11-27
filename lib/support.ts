/**
 * Suporte por WhatsApp (decisão 58). O número ainda não foi informado pelo dono:
 * fica vazio e o botão não aparece. Para ligar, defina VITE_SUPPORT_WHATSAPP (só dígitos, com DDI e DDD,
 * ex.: 55DDNNNNNNNNN) no ambiente do build.
 */
const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;

/** Mantém só dígitos; precisa ter de 10 a 15 dígitos (padrão E.164 sem o +). */
export const normalizeWhatsappNumber = (raw: string | null | undefined): string | null => {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
};

export const SUPPORT_WHATSAPP: string | null = normalizeWhatsappNumber(env.VITE_SUPPORT_WHATSAPP);

/** Link do WhatsApp com mensagem inicial; null quando não há número. */
export const supportWhatsappUrl = (number: string | null = SUPPORT_WHATSAPP, storeName?: string | null): string | null => {
  if (!number) return null;
  const text = storeName ? `Olá! Preciso de ajuda com o Gestão Pro (loja ${storeName}).` : 'Olá! Preciso de ajuda com o Gestão Pro.';
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
};

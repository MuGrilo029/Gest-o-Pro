/**
 * Limite de desconto do vendedor por loja (D4, aprovado pelo dono em 27/11/2026).
 * Percentual configurado pelo dono da loja, padrão 10%. Acima dele só gerente ou dono.
 * Isto é o aviso e o bloqueio da tela; quem decide de verdade é o create_sale no banco.
 * Preço de tabela obrigatório e teto por venda foram reprovados: não entram aqui.
 */
import type { StoreRole } from './modules';

export const DEFAULT_SELLER_DISCOUNT_PERCENT = 10;

/** Só o vendedor é limitado (dono, gerente e admin da plataforma não). */
export const isDiscountLimited = (role: StoreRole | null | undefined, isPlatformAdmin: boolean): boolean =>
  !isPlatformAdmin && role !== 'OWNER' && role !== 'MANAGER';

/** Maior desconto em reais para o vendedor, em centavos: round(subtotal × percentual / 100, 2). */
export const maxSellerDiscount = (subtotal: number, percent: number): number =>
  Math.round((Number(subtotal) || 0) * percent) / 100;

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const sellerDiscountProblem = (input: {
  role: StoreRole | null | undefined;
  isPlatformAdmin: boolean;
  subtotal: number;
  discount: number;
  limitPercent: number;
}): string | null => {
  if (!isDiscountLimited(input.role, input.isPlatformAdmin)) return null;
  const max = maxSellerDiscount(input.subtotal, input.limitPercent);
  if (Math.round((Number(input.discount) || 0) * 100) <= Math.round(max * 100)) return null;
  return `Desconto acima do limite do vendedor (${input.limitPercent.toLocaleString('pt-BR')}%). O máximo nesta venda é ${brl(max)}. Acima disso, só gerente ou dono.`;
};

/** Texto digitado → percentual de 0 a 100 com até 2 casas; null = inválido. */
export const parseDiscountPercent = (text: string): number | null => {
  const clean = text.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const n = Number(clean);
  return n >= 0 && n <= 100 ? n : null;
};

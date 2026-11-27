import { describe, expect, it } from 'vitest';
import { DEFAULT_SELLER_DISCOUNT_PERCENT, maxSellerDiscount, parseDiscountPercent, readDiscountPercent, sellerDiscountProblem } from '../lib/discount';

const base = { isPlatformAdmin: false, subtotal: 1500, limitPercent: DEFAULT_SELLER_DISCOUNT_PERCENT };

describe('limite de desconto do vendedor (D4)', () => {
  it('padrão de 10%', () => {
    expect(DEFAULT_SELLER_DISCOUNT_PERCENT).toBe(10);
    expect(maxSellerDiscount(1500, 10)).toBe(150);
    expect(maxSellerDiscount(99.99, 10)).toBe(10);
  });

  it('vendedor: no limite passa, 1 centavo acima bloqueia com o valor máximo na mensagem', () => {
    expect(sellerDiscountProblem({ ...base, role: 'SELLER', discount: 150 })).toBeNull();
    const msg = sellerDiscountProblem({ ...base, role: 'SELLER', discount: 150.01 });
    expect(msg).toContain('10%');
    expect(msg).toContain('150,00');
  });

  it('gerente, dono e admin não são limitados', () => {
    expect(sellerDiscountProblem({ ...base, role: 'MANAGER', discount: 900 })).toBeNull();
    expect(sellerDiscountProblem({ ...base, role: 'OWNER', discount: 1500 })).toBeNull();
    expect(sellerDiscountProblem({ ...base, role: null, isPlatformAdmin: true, discount: 900 })).toBeNull();
  });

  it('papel ainda desconhecido conta como vendedor; limite 0 bloqueia qualquer desconto', () => {
    expect(sellerDiscountProblem({ ...base, role: null, discount: 200 })).not.toBeNull();
    expect(sellerDiscountProblem({ ...base, role: 'SELLER', limitPercent: 0, discount: 0.01 })).not.toBeNull();
    expect(sellerDiscountProblem({ ...base, role: 'SELLER', limitPercent: 0, discount: 0 })).toBeNull();
  });

  it('valor lido do banco: número ou texto; ausente ou inválido vira 10', () => {
    expect(readDiscountPercent(0)).toBe(0);
    expect(readDiscountPercent('7.5')).toBe(7.5);
    for (const bad of [undefined, null, '', 'x', -1, 101]) expect(readDiscountPercent(bad)).toBe(10);
  });

  it('percentual digitado: 0 a 100, vírgula aceita', () => {
    expect(parseDiscountPercent('12,5')).toBe(12.5);
    expect(parseDiscountPercent('0')).toBe(0);
    expect(parseDiscountPercent('100')).toBe(100);
    for (const bad of ['', '-1', '101', '10.123', 'abc']) expect(parseDiscountPercent(bad), bad).toBeNull();
  });
});

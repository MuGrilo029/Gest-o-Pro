import { describe, expect, it } from 'vitest';
import { MODULES } from '../lib/modules';
import { PLANS, formatPlanPrice, getPlan, planSellersLabel } from '../lib/plans';

describe('planos: módulos', () => {
  it('toda chave de módulo do plano existe em lib/modules.ts (exceto a marca)', () => {
    const keys = new Set(MODULES.map(m => m.key as string));
    for (const plan of PLANS) {
      for (const key of plan.modules) {
        if (key === 'brand') continue;
        expect(keys.has(key), `${plan.code} -> ${key}`).toBe(true);
      }
    }
  });

  it('cada plano contém o anterior (Início ⊂ Crescimento ⊂ Avançado)', () => {
    const inicio = getPlan('inicio').modules;
    const crescimento = getPlan('crescimento').modules;
    const avancado = getPlan('avancado').modules;
    for (const m of inicio) expect(crescimento).toContain(m);
    for (const m of crescimento) expect(avancado).toContain(m);
  });

  it('todos os módulos core estão em todos os planos', () => {
    const core = MODULES.filter(m => m.core).map(m => m.key);
    for (const plan of PLANS) {
      for (const key of core) expect(plan.modules).toContain(key);
    }
  });

  it('Início não tem Financeiro, Entregas nem Produção; Avançado tem Entregas e sob medida', () => {
    const inicio = getPlan('inicio').modules;
    expect(inicio).not.toContain('financial');
    expect(inicio).not.toContain('deliveries');
    expect(inicio).not.toContain('production');
    const avancado = getPlan('avancado').modules;
    expect(avancado).toContain('deliveries');
    expect(avancado).toContain('custom_production');
    expect(avancado).toContain('brand');
  });
});

describe('planos: copy da tela', () => {
  it('preços e limites de vendedores', () => {
    expect(formatPlanPrice(getPlan('inicio').priceCents)).toBe('R$ 49');
    expect(formatPlanPrice(getPlan('crescimento').priceCents)).toBe('R$ 99');
    expect(formatPlanPrice(getPlan('avancado').priceCents)).toBe('R$ 199');
    expect(planSellersLabel(getPlan('inicio'))).toBe('Até 1 vendedor');
    expect(planSellersLabel(getPlan('crescimento'))).toBe('Até 3 vendedores');
    expect(planSellersLabel(getPlan('avancado'))).toBe('Vendedores ilimitados');
  });

  it('só o Crescimento é recomendado', () => {
    expect(PLANS.filter(p => p.recommended).map(p => p.code)).toEqual(['crescimento']);
  });

  it('não mostra Notificações nem o nome "Produção sob medida" como item próprio', () => {
    const texts = PLANS.flatMap(p => p.features).join(' | ');
    expect(texts).not.toMatch(/Notifica/i);
    expect(texts).not.toContain('Produção sob medida');
  });
});

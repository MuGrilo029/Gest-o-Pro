import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './db/harness';
import { MODULES } from '../lib/modules';
import { PLANS, formatPlanPrice, getPlan, isPlanCode, planForLimits, planSellersLabel, sellerLimitFor, sellersToRemoveFor } from '../lib/plans';

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
    expect(planSellersLabel(getPlan('avancado'))).toBe('Até 6 vendedores');
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

describe('planos: decisões do dono (1, 2, 4, 14, 15)', () => {
  it('limites de vendedores 1, 3 e 6', () => {
    expect(PLANS.map(p => p.maxSellers)).toEqual([1, 3, 6]);
  });

  it('anual = 10 meses', () => {
    expect(getPlan('inicio').annualPriceCents).toBe(49000);
    expect(getPlan('crescimento').annualPriceCents).toBe(99000);
    expect(getPlan('avancado').annualPriceCents).toBe(199000);
  });

  it('Boletos, Fornecedores e Encomendas a partir do Crescimento', () => {
    for (const key of ['boletos', 'suppliers', 'orders'] as const) {
      expect(getPlan('inicio').modules).not.toContain(key);
      expect(getPlan('crescimento').modules).toContain(key);
      expect(getPlan('avancado').modules).toContain(key);
    }
  });

  it('core fixo: Dashboard, Vendas, Clientes, Estoque e Configurações em todo plano', () => {
    for (const plan of PLANS) {
      for (const key of ['dashboard', 'sales', 'customers', 'inventory', 'settings'] as const) expect(plan.modules).toContain(key);
    }
  });

  it('plano "custom" (Com Stillo) não existe na tela', () => {
    expect(isPlanCode('custom')).toBe(false);
    expect(PLANS.map(p => p.code)).toEqual(['inicio', 'crescimento', 'avancado']);
  });

  it('limite da loja: trial lê o Avançado; plano legado não tem limite no front', () => {
    expect(planForLimits('trial')?.code).toBe('avancado');
    expect(sellerLimitFor('inicio')).toBe(1);
    expect(sellerLimitFor('custom')).toBeNull();
    expect(sellerLimitFor(null)).toBeNull();
  });

  it('downgrade: quantos vendedores precisam sair', () => {
    expect(sellersToRemoveFor('inicio', 3)).toBe(2);
    expect(sellersToRemoveFor('crescimento', 3)).toBe(0);
    expect(sellersToRemoveFor('crescimento', 5)).toBe(2);
    expect(sellersToRemoveFor('avancado', 2)).toBe(0);
  });
});

// Banco = fonte de verdade (migração 048). Sobe o banco local (PGlite, 001–056) e compara com lib/plans.ts.
describe('planos: lib/plans.ts espelha o banco', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); }, 120_000);
  afterAll(async () => { await t?.close(); });

  it('módulos ligados por plano são os mesmos', async () => {
    for (const plan of PLANS) {
      const rows = await t.sql<{ module_key: string }>(
        'SELECT module_key FROM plan_modules WHERE plan_key = $1 AND enabled ORDER BY module_key', [plan.code]);
      expect(rows.map(r => r.module_key), plan.code).toEqual([...plan.modules].sort());
    }
  });

  it('preço mensal, anual (10×) e limite de vendedores são os mesmos', async () => {
    for (const plan of PLANS) {
      const [row] = await t.sql<any>('SELECT price_cents, annual_price_cents, max_sellers, active FROM plans WHERE key = $1', [plan.code]);
      expect(row, plan.code).toEqual({ price_cents: plan.priceCents, annual_price_cents: plan.annualPriceCents, max_sellers: plan.maxSellers, active: true });
      expect(plan.annualPriceCents).toBe(plan.priceCents * 10);
    }
  });

  it('core do banco = core de lib/modules.ts, ligado em todos os planos', async () => {
    const rows = await t.sql<{ key: string }>('SELECT key FROM module_catalog WHERE core ORDER BY key');
    expect(rows.map(r => r.key)).toEqual(MODULES.filter(m => m.core).map(m => m.key as string).sort());
  });

  it('o plano custom não é vendável', async () => {
    const [row] = await t.sql<any>("SELECT active FROM plans WHERE key = 'custom'");
    expect(row.active).toBe(false);
    expect(PLANS.map(p => p.code)).toEqual(['inicio', 'crescimento', 'avancado']);
  });
});

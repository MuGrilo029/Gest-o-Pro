import { describe, expect, it } from 'vitest';
import {
  MANAGER_ONLY_VIEWS,
  MODULES,
  PLATFORM_ADMIN_VIEWS,
  SELLER_ASSIGNABLE_VIEWS,
  SELLER_DEFAULT_VIEWS,
  ModuleKey,
  canAccessViewFor,
  dependentsOf,
  moduleForView,
  resolveModuleStates,
} from '../lib/modules';

const all = (value: boolean) => Object.fromEntries(MODULES.map(m => [m.key, value])) as Record<ModuleKey, boolean>;

describe('registro de módulos', () => {
  it('chaves são únicas e dependências apontam para módulos existentes', () => {
    const keys = MODULES.map(m => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of MODULES) {
      for (const dep of m.dependsOn ?? []) expect(keys).toContain(dep);
    }
  });

  it('nenhuma tela pertence a dois módulos', () => {
    const views = MODULES.flatMap(m => m.views.map(v => v.view));
    expect(new Set(views).size).toBe(views.length);
  });

  it('módulo core nunca depende de módulo opcional', () => {
    const byKey = new Map(MODULES.map(m => [m.key, m]));
    for (const m of MODULES.filter(x => x.core)) {
      for (const dep of m.dependsOn ?? []) expect(byKey.get(dep)?.core).toBe(true);
    }
  });
});

describe('resolveModuleStates', () => {
  it('sem configuração usa o padrão; custom_production nasce desligado', () => {
    const s = resolveModuleStates({});
    expect(s.custom_production).toBe(false);
    expect(s.production).toBe(true);
    expect(s.financial).toBe(true);
  });

  it('módulos core não podem ser desligados', () => {
    const s = resolveModuleStates({ sales: false, settings: false, customers: false, inventory: false, dashboard: false });
    for (const key of ['sales', 'settings', 'customers', 'inventory', 'dashboard'] as ModuleKey[]) {
      expect(s[key]).toBe(true);
    }
  });

  it('custom_production só liga com production ligado', () => {
    expect(resolveModuleStates({ custom_production: true }).custom_production).toBe(true);
    expect(resolveModuleStates({ custom_production: true, production: false }).custom_production).toBe(false);
    expect(resolveModuleStates({ custom_production: true, production: false }).production).toBe(false);
  });

  it('desligar financeiro derruba boletos (dependência)', () => {
    const s = resolveModuleStates({ financial: false, boletos: true });
    expect(s.boletos).toBe(false);
  });

  it('religar o módulo base não religa sozinho o dependente desligado', () => {
    const s = resolveModuleStates({ financial: true, boletos: false });
    expect(s.financial).toBe(true);
    expect(s.boletos).toBe(false);
  });
});

describe('dependentsOf', () => {
  it('lista dependentes diretos', () => {
    expect(dependentsOf('production')).toContain('custom_production');
    expect(dependentsOf('financial')).toContain('boletos');
  });

  it('módulo sem dependentes devolve lista vazia', () => {
    expect(dependentsOf('custom_production')).toEqual([]);
    expect(dependentsOf('deliveries')).toEqual([]);
  });
});

describe('papéis OWNER / MANAGER / SELLER', () => {
  const on = all(true);

  it('somente o administrador da plataforma acessa STORE_ADMIN', () => {
    expect(PLATFORM_ADMIN_VIEWS).toContain('STORE_ADMIN');
    for (const role of ['OWNER', 'MANAGER', 'SELLER'] as const) {
      expect(canAccessViewFor('STORE_ADMIN', { role, isPlatformAdmin: false, moduleStates: on })).toBe(false);
    }
    expect(canAccessViewFor('STORE_ADMIN', { role: null, isPlatformAdmin: true, moduleStates: on })).toBe(true);
  });

  it('dono e gerente acessam telas de gestão; vendedor não, mesmo com permissão marcada', () => {
    for (const view of MANAGER_ONLY_VIEWS.filter(v => !PLATFORM_ADMIN_VIEWS.includes(v))) {
      expect(canAccessViewFor(view, { role: 'OWNER', isPlatformAdmin: false, moduleStates: on })).toBe(true);
      expect(canAccessViewFor(view, { role: 'MANAGER', isPlatformAdmin: false, moduleStates: on })).toBe(true);
      expect(canAccessViewFor(view, { role: 'SELLER', isPlatformAdmin: false, moduleStates: on, permissions: [view] })).toBe(false);
    }
  });

  it('vendedor sem permissões próprias recebe o padrão (vendas, clientes, orçamentos, dashboard)', () => {
    expect(SELLER_DEFAULT_VIEWS).toEqual(expect.arrayContaining(['SALES', 'CUSTOMERS', 'QUOTES', 'DASHBOARD']));
    expect(canAccessViewFor('SALES', { role: 'SELLER', isPlatformAdmin: false, moduleStates: on })).toBe(true);
    expect(canAccessViewFor('INVENTORY', { role: 'SELLER', isPlatformAdmin: false, moduleStates: on })).toBe(false);
  });

  it('vendedor com permissões próprias usa só elas', () => {
    const ctx = { role: 'SELLER' as const, isPlatformAdmin: false, moduleStates: on, permissions: ['INVENTORY' as const] };
    expect(canAccessViewFor('INVENTORY', ctx)).toBe(true);
    expect(canAccessViewFor('SALES', ctx)).toBe(false);
  });

  it('módulo desligado bloqueia a tela até para o dono', () => {
    const states = { ...on, deliveries: false };
    expect(canAccessViewFor('DELIVERIES', { role: 'OWNER', isPlatformAdmin: false, moduleStates: states })).toBe(false);
    expect(moduleForView('DELIVERIES')?.key).toBe('deliveries');
  });

  it('sem papel (sem loja) não acessa nada', () => {
    expect(canAccessViewFor('DASHBOARD', { role: null, isPlatformAdmin: false, moduleStates: on })).toBe(false);
  });

  it('telas atribuíveis a vendedor nunca incluem telas de gestão', () => {
    for (const v of SELLER_ASSIGNABLE_VIEWS) expect(MANAGER_ONLY_VIEWS).not.toContain(v.view);
  });
});

import { describe, expect, it } from 'vitest';
import { canAccessViewFor } from '../lib/modules';

describe('Isolamento de Visão do Administrador da Plataforma (SaaS Admin)', () => {
  const platformAdminCtx = {
    role: 'OWNER' as const,
    isPlatformAdmin: true,
    moduleStates: {
      dashboard: true,
      financial: true,
      sales: true,
      settings: true,
    },
  };

  const storeOwnerCtx = {
    role: 'OWNER' as const,
    isPlatformAdmin: false,
    moduleStates: {
      dashboard: true,
      financial: true,
      sales: true,
      settings: true,
    },
  };

  it('permite STORE_ADMIN apenas para o administrador da plataforma', () => {
    expect(canAccessViewFor('STORE_ADMIN', platformAdminCtx)).toBe(true);
    expect(canAccessViewFor('STORE_ADMIN', storeOwnerCtx)).toBe(false);
  });

  it('dono de loja acessa painel operacional da sua própria loja', () => {
    expect(canAccessViewFor('DASHBOARD', storeOwnerCtx)).toBe(true);
    expect(canAccessViewFor('SALES', storeOwnerCtx)).toBe(true);
    expect(canAccessViewFor('PAYABLES', storeOwnerCtx)).toBe(true);
  });

  it('bloqueia vendedor de acessar STORE_ADMIN e telas de gestão', () => {
    const sellerCtx = {
      role: 'SELLER' as const,
      isPlatformAdmin: false,
      moduleStates: { dashboard: true, settings: true },
      permissions: ['DASHBOARD' as const],
    };
    expect(canAccessViewFor('STORE_ADMIN', sellerCtx)).toBe(false);
    expect(canAccessViewFor('SETTINGS', sellerCtx)).toBe(false);
  });
});

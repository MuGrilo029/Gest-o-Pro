import { describe, expect, it } from 'vitest';
import { MODULES, ModuleKey, PLATFORM_ADMIN_VIEWS, canAccessViewFor } from '../lib/modules';

// Decisão 33/36: só o dono do SaaS (is_platform_admin) entra no painel admin.
// Nenhum papel de loja, permissão extra ou módulo ligado abre essas telas.
// A barreira real é no servidor (RPCs admin_* com _require_platform_admin e
// set_active_store/current_store_id); este teste cobre a barreira da interface.

const allOn = Object.fromEntries(MODULES.map(m => [m.key, true])) as Record<ModuleKey, boolean>;
const roles = ['OWNER', 'MANAGER', 'SELLER', null, undefined] as const;

describe('painel admin só para is_platform_admin', () => {
  for (const view of PLATFORM_ADMIN_VIEWS) {
    for (const role of roles) {
      it(`${view} bloqueada para papel ${String(role)} sem is_platform_admin`, () => {
        expect(
          canAccessViewFor(view, {
            role,
            isPlatformAdmin: false,
            moduleStates: allOn,
            permissions: [...PLATFORM_ADMIN_VIEWS],
          }),
        ).toBe(false);
      });
    }

    it(`${view} liberada para is_platform_admin`, () => {
      expect(canAccessViewFor(view, { role: null, isPlatformAdmin: true, moduleStates: {} })).toBe(true);
    });
  }
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearAppCaches } from '../lib/cacheSecurity';

describe('limpeza de caches do app', () => {
  let store: Map<string, unknown>;

  beforeEach(() => {
    store = new Map([['gestao-pro-v2', {}], ['outro-cache', {}]]);
    (globalThis as any).caches = {
      keys: vi.fn(async () => Array.from(store.keys())),
      delete: vi.fn(async (key: string) => store.delete(key)),
    };
  });

  it('apaga todos os caches ao sair ou trocar de conta', async () => {
    await clearAppCaches();
    expect(store.size).toBe(0);
  });

  it('não falha quando a API de cache não existe', async () => {
    delete (globalThis as any).caches;
    await expect(clearAppCaches()).resolves.toBeUndefined();
  });
});

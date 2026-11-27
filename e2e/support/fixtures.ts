import { test as base, expect, Page } from '@playwright/test';
import { Account, accounts, e2eMode, forbiddenStoreIds } from './env';
import { MockDb, installSupabaseMock, seedDefault } from './supabaseMock';

/**
 * `db`: no modo mock, o banco falso já semeado; no modo env, null (os dados vêm do Supabase de teste).
 * Toda página abre em modo desktop e sem service worker.
 */
export const test = base.extend<{ db: MockDb | null }>({
  db: [async ({ page }, use) => {
    await page.addInitScript(() => {
      localStorage.setItem('COM_STILLO_VIEW_MODE', 'desktop');
    });
    if (e2eMode() === 'mock') {
      const db = seedDefault();
      await installSupabaseMock(page, db);
      await use(db);
    } else {
      const forbidden = forbiddenStoreIds();
      if (forbidden.length) {
        // Para na hora se a conta de teste enxergar uma loja real.
        page.on('response', async res => {
          if (!res.url().includes('/rest/v1/rpc/my_stores')) return;
          const body = await res.json().catch(() => []);
          const ids: string[] = (Array.isArray(body) ? body : []).map((s: any) => s.id);
          if (ids.some(id => forbidden.includes(id))) {
            throw new Error('E2E abortado: a conta de teste enxerga uma loja real.');
          }
        });
      }
      await use(null);
    }
  }, { auto: true }],
});

export { expect };

export const login = async (page: Page, who: 'admin' | 'owner') => {
  const acc: Account = accounts()[who];
  await page.goto('/');
  await page.getByLabel(/e-?mail/i).first().fill(acc.email);
  await page.getByLabel(/senha/i).first().fill(acc.password);
  await page.getByRole('button', { name: /^entrar no sistema$/i }).click();
};

/** Abre uma tela pelo menu lateral (busca do menu). */
export const openFromMenu = async (page: Page, label: RegExp) => {
  await page.getByRole('button', { name: label }).first().click();
};

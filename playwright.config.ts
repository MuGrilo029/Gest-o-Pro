import { defineConfig, devices } from '@playwright/test';
import { assertSafeTarget, e2eMode } from './e2e/support/env';
import { MOCK_SUPABASE_URL } from './e2e/support/supabaseMock';

/**
 * E2E (Playwright). Ver e2e/README.md.
 * mock: Supabase falso em memória (padrão). env: Supabase local/de teste (nunca produção).
 */
const mode = e2eMode();
const supabaseUrl = mode === 'env' ? assertSafeTarget(process.env.E2E_SUPABASE_URL) : MOCK_SUPABASE_URL;
const anonKey = mode === 'env' ? (process.env.E2E_SUPABASE_ANON_KEY || '') : 'e2e-mock-anon-key';
const PORT = Number(process.env.E2E_PORT || 5179);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: supabaseUrl,
      VITE_SUPABASE_ANON_KEY: anonKey,
    },
  },
});

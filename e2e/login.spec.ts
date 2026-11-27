import { test, expect, login } from './support/fixtures';

test.describe('login', () => {
  test('dono entra e cai no Dashboard da loja', async ({ page, db }) => {
    await login(page, 'owner');
    await expect(page.getByRole('heading', { name: /dashboard|visão geral|resumo/i }).first()).toBeVisible();
    // Dono de loja nunca vê o painel de assinaturas.
    await expect(page.getByTestId('admin-panel')).toHaveCount(0);
    if (db) expect(db.calls.some(c => c.name === 'my_stores')).toBe(true);
  });

  test('senha errada mostra erro e não entra', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/e-?mail/i).first().fill('dono@e2e.test');
    await page.getByLabel(/senha/i).first().fill('senha-errada');
    await page.getByRole('button', { name: /^entrar no sistema$/i }).click();
    await expect(page.getByText(/e-mail ou senha incorretos/i)).toBeVisible();
  });

  test('admin do SaaS entra direto no painel de assinaturas', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByTestId('admin-panel')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Assinaturas' })).toBeVisible();
    // Sem KPIs no painel (decisão 38).
    await expect(page.getByText(/MRR|churn/i)).toHaveCount(0);
  });
});

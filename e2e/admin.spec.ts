import { test, expect, login } from './support/fixtures';

/**
 * Painel admin (só o dono do SaaS): criação de loja e downgrade com exclusão de vendedores.
 * No modo env, crie a conta admin de teste e uma loja de teste no Crescimento com 3 vendedores
 * chamada "Loja E2E Móveis" (ver e2e/README.md). Nunca rode contra lojas reais.
 */
test.describe('painel admin', () => {
  test('cria loja paga com senha provisória 12345678', async ({ page, db }) => {
    await login(page, 'admin');
    await expect(page.getByTestId('admin-panel')).toBeVisible();

    const suffix = Date.now().toString().slice(-6);
    const storeName = `Loja Nova E2E ${suffix}`;
    await page.getByRole('button', { name: /criar loja/i }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Criar loja' });
    await dialog.getByLabel(/nome da loja/i).fill(storeName);
    await dialog.getByLabel(/nome do dono/i).fill('Dono Novo');
    await dialog.getByLabel(/e-mail do dono/i).fill(`novo-${suffix}@e2e.test`);
    await dialog.getByLabel(/plano/i).selectOption('avancado');
    await dialog.getByLabel('Paga').check();
    await dialog.getByLabel(/prazo pago/i).fill('30');
    await dialog.getByRole('button', { name: /^criar loja$/i }).click();

    await expect(dialog.getByTestId('create-store-done')).toBeVisible();
    await expect(dialog.getByText('12345678')).toBeVisible();
    await dialog.getByRole('button', { name: /^fechar$/i }).last().click();

    await expect(page.getByTestId('admin-store-row').filter({ hasText: storeName })).toBeVisible();
    if (db) {
      const created = db.stores.find(s => s.name === storeName)!;
      expect(created.plan).toBe('avancado');
      expect(created.status).toBe('active');
      const call = db.calls.find(c => c.name === 'manage-users' && c.args.store_id === created.id);
      // Sem senha no pedido: o servidor aplica a provisória padrão 12345678 (contrato do Backend).
      expect(call?.args.password).toBeUndefined();
      expect(call?.args.role).toBe('OWNER');
    }
  });

  test('downgrade avisa e obriga excluir os vendedores excedentes antes de trocar', async ({ page, db }) => {
    await login(page, 'admin');
    const row = page.getByTestId('admin-store-row').filter({ hasText: 'Loja E2E Móveis' });
    await row.getByRole('button', { name: /gerenciar/i }).click();
    const drawer = page.getByRole('dialog', { name: /gerenciar loja e2e móveis/i });
    await drawer.getByRole('tab', { name: 'Plano' }).click();

    await drawer.getByLabel(/Início/).check();
    const warning = drawer.getByTestId('downgrade-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Exclua 2 vendedor(es)');
    const applyBtn = drawer.getByRole('button', { name: /^trocar plano$/i });
    await expect(applyBtn).toBeDisabled();

    // Exclui 1: ainda falta 1, botão segue bloqueado.
    await warning.getByRole('button', { name: /excluir vendedor/i }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: /^excluir$/i }).click();
    await expect(warning).toContainText('Exclua 1 vendedor(es)');
    await expect(applyBtn).toBeDisabled();

    // Exclui o segundo: a loja cabe no Início, a troca libera.
    await warning.getByRole('button', { name: /excluir vendedor/i }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: /^excluir$/i }).click();
    await expect(drawer.getByTestId('downgrade-warning')).toHaveCount(0);
    await expect(applyBtn).toBeEnabled();

    await applyBtn.click();
    await page.getByRole('alertdialog').getByRole('button', { name: /^trocar plano$/i }).click();
    await expect(page.getByText(/plano de "loja e2e móveis": início/i)).toBeVisible();
    if (db) {
      expect(db.stores.find(s => s.name === 'Loja E2E Móveis')!.plan).toBe('inicio');
      expect(db.sellers(db.stores[0].id)).toHaveLength(1);
    }
  });

  test('limite de vendedores bloqueia criar vendedor na equipe', async ({ page }) => {
    await login(page, 'admin');
    const row = page.getByTestId('admin-store-row').filter({ hasText: 'Loja E2E Móveis' });
    await row.getByRole('button', { name: /gerenciar/i }).click();
    const drawer = page.getByRole('dialog', { name: /gerenciar loja e2e móveis/i });
    await drawer.getByRole('tab', { name: 'Equipe' }).click();
    await expect(drawer.getByTestId('seller-count')).toContainText('3 de 3');
    await expect(drawer.getByRole('alert').filter({ hasText: /limite de 3 vendedor/i })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /criar acesso/i })).toBeDisabled();
  });
});

import { Page } from '@playwright/test';
import { test, expect, login } from './support/fixtures';
import type { MockDb } from './support/supabaseMock';

/** Excluir loja no painel admin. Só no modo mock: nunca excluir loja em banco real por teste. */
const mustMock = (db: MockDb | null): MockDb => { test.skip(!db, 'só no modo mock'); return db!; };
const NAME = 'Loja E2E Móveis';

const openDelete = async (page: Page) => {
  await login(page, 'admin');
  const row = page.getByTestId('admin-store-row').filter({ hasText: NAME });
  await row.getByRole('button', { name: /gerenciar/i }).click();
  const drawer = page.getByRole('dialog', { name: new RegExp(`gerenciar ${NAME}`, 'i') });
  await drawer.getByRole('tab', { name: 'Excluir' }).click();
  await expect(drawer.getByTestId('delete-preview')).toBeVisible();
  return drawer;
};

const deletions = (db: MockDb) => db.calls.filter(c => c.name === 'manage-users' && c.args.action === 'delete_store');

test.describe('excluir loja', () => {
  test('quem não é admin não vê o painel nem a ação', async ({ page, db }) => {
    mustMock(db);
    await login(page, 'owner');
    await expect(page.getByRole('searchbox', { name: /buscar tela no menu/i })).toBeVisible();
    await expect(page.getByTestId('admin-panel')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Excluir' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /excluir loja/i })).toHaveCount(0);
  });

  test('prévia, aviso e nome errado mantêm o botão desabilitado', async ({ page, db }) => {
    const mock = mustMock(db);
    const drawer = await openDelete(page);
    await expect(drawer.getByTestId('delete-store')).toContainText('irreversível');
    await expect(drawer.getByTestId('delete-logins-text')).toContainText('somente nesta loja');
    await expect(drawer.getByTestId('delete-preview')).toContainText('Produtos');
    await expect(drawer.getByTestId('delete-preview')).not.toContainText('Orçamentos'); // zero não aparece
    await expect(drawer.getByTestId('delete-files')).toContainText('Imagens');
    await expect(drawer.getByTestId('delete-logins')).toContainText('dono@e2e.test');
    await expect(drawer.getByTestId('delete-retained')).toContainText('Registro de auditoria');
    const button = drawer.getByRole('button', { name: /excluir loja definitivamente/i });
    await expect(button).toBeDisabled();
    for (const wrong of ['loja e2e móveis', 'Loja E2E Moveis', 'Loja  E2E Móveis', 'Loja E2E']) {
      await drawer.getByLabel('Nome exato da loja').fill(wrong);
      await expect(button, wrong).toBeDisabled();
    }
    await drawer.getByLabel('Nome exato da loja').press('Enter');
    expect(deletions(mock)).toHaveLength(0);
  });

  test('sucesso: apaga, avisa e o admin segue no painel mesmo sendo a loja ativa (e a única)', async ({ page, db }) => {
    const mock = mustMock(db);
    const drawer = await openDelete(page);
    await drawer.getByLabel('Nome exato da loja').fill(NAME);
    mock.faults.delayMs = 900;
    await drawer.getByRole('button', { name: /excluir loja definitivamente/i }).dblclick();
    await expect(drawer.getByRole('button', { name: /excluindo/i })).toBeDisabled();
    await expect(drawer.getByRole('button', { name: 'Fechar' })).toBeDisabled();
    await expect(page.getByText(`A loja "${NAME}" foi excluída.`)).toBeVisible();
    mock.faults.delayMs = 0;
    await page.getByRole('alertdialog').getByRole('button').last().click();
    await expect(page.getByTestId('admin-panel')).toBeVisible();
    await expect(page.getByTestId('admin-store-row')).toHaveCount(0);
    expect(deletions(mock)).toHaveLength(1);
    expect(deletions(mock)[0].args.confirm_name).toBe(NAME);
    expect(mock.stores).toHaveLength(0);
  });

  test('falha no banco: nada apagado, erro com tentar de novo, que conclui', async ({ page, db }) => {
    const mock = mustMock(db);
    mock.faults.deleteStore = 1;
    const drawer = await openDelete(page);
    await drawer.getByLabel('Nome exato da loja').fill(NAME);
    await drawer.getByRole('button', { name: /excluir loja definitivamente/i }).click();
    await expect(drawer.getByRole('alert')).toContainText('A exclusão não terminou');
    await expect(drawer.getByRole('alert')).toContainText('Nada foi apagado');
    expect(mock.stores).toHaveLength(1);
    await drawer.getByRole('button', { name: /^tentar de novo$/i }).click();
    await expect(page.getByText(`A loja "${NAME}" foi excluída.`)).toBeVisible();
    expect(deletions(mock)).toHaveLength(2);
    expect(mock.stores).toHaveLength(0);
  });

  test('exclusão parcial (200): não diz que concluiu, mostra o que sobrou e tentar de novo termina', async ({ page, db }) => {
    const mock = mustMock(db);
    mock.faults.deletePartial = 1;
    const drawer = await openDelete(page);
    await drawer.getByLabel('Nome exato da loja').fill(NAME);
    await drawer.getByRole('button', { name: /excluir loja definitivamente/i }).click();
    await expect(drawer.getByTestId('delete-partial')).toContainText('Arquivos restantes: 2');
    await expect(page.getByText(/foi excluída/)).toHaveCount(0);
    // A lista passa a mostrar só a conclusão.
    await expect(drawer.getByRole('tab')).toHaveCount(1);
    await drawer.getByRole('button', { name: /^tentar de novo$/i }).click();
    await expect(page.getByText(`A loja "${NAME}" foi excluída.`)).toBeVisible();
    expect(deletions(mock)).toHaveLength(2);
    expect(mock.stores).toHaveLength(0);
  });

  test('loja com exclusão pendente na lista oferece só concluir', async ({ page, db }) => {
    const mock = mustMock(db);
    Object.assign(mock.stores[0], { deletedAt: new Date().toISOString(), status: 'expired', filesLeft: 2 });
    mock.stores.push({ id: 'outra', name: 'Outra Loja', status: 'active', plan: 'inicio', ownerEmail: 'o@e2e.test', endsAt: null, createdAt: new Date().toISOString() });
    await login(page, 'admin');
    const row = page.getByTestId('admin-store-row').filter({ hasText: NAME });
    await expect(row).toContainText('Exclusão pendente');
    await expect(row.getByRole('button', { name: /abrir|gerenciar/i })).toHaveCount(0);
    await row.getByRole('button', { name: /concluir exclusão/i }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('tab')).toHaveCount(1);
    await expect(drawer.getByRole('button', { name: /abrir loja/i })).toHaveCount(0);
    await drawer.getByLabel('Nome exato da loja').fill(NAME);
    await drawer.getByRole('button', { name: /^concluir exclusão$/i }).click();
    await expect(page.getByText(`A loja "${NAME}" foi excluída.`)).toBeVisible();
  });

  test('impedimento do servidor desabilita a exclusão', async ({ page, db }) => {
    const mock = mustMock(db);
    mock.faults.blocker = 'há uma assinatura ativa no gateway de pagamento.';
    const drawer = await openDelete(page);
    await expect(drawer.getByRole('alert')).toContainText('assinatura ativa no gateway');
    await expect(drawer.getByLabel('Nome exato da loja')).toBeDisabled();
    await expect(drawer.getByRole('button', { name: /excluir loja definitivamente/i })).toBeDisabled();
    expect(deletions(mock)).toHaveLength(0);
  });

  test('loja aberta pelo admin que não existe mais é abandonada ao carregar', async ({ page, db }) => {
    mustMock(db);
    await page.addInitScript(() => {
      sessionStorage.setItem('GESTAO_PRO_IMPERSONATED_STORE', JSON.stringify({ id: 'loja-excluida', name: 'Loja Excluída', role: 'OWNER', permissions: [] }));
    });
    await login(page, 'admin');
    await expect(page.getByTestId('admin-panel')).toBeVisible();
    await expect(page.getByText('Loja Excluída')).toHaveCount(0);
  });
});

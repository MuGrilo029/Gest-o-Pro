import { Page } from '@playwright/test';
import { test, expect, login } from './support/fixtures';
import { MockDb, uuid } from './support/supabaseMock';

/** Pedido do dono (27/11): loja Início com Financeiro e sem Boletos. Só no modo mock. */
const mustMock = (db: MockDb | null): MockDb => { test.skip(!db, 'só no modo mock'); return db!; };
const today = new Date().toISOString().slice(0, 10);

const setup = (db: MockDb, plan: 'inicio' | 'crescimento') => {
  db.stores[0].plan = plan;
  db.table('transactions').push({ id: uuid(), description: 'Conta com boleto E2E', amount: 90, type: 'EXPENSE', category: 'Geral', date: today, due_date: today, status: 'PENDING', has_boleto: true });
};

const goTo = async (page: Page, screen: string) => {
  const s = page.getByRole('searchbox', { name: /buscar tela no menu/i });
  await s.fill(screen);
  await s.press('Enter');
};
const menu = async (page: Page, name: string) => {
  const s = page.getByRole('searchbox', { name: /buscar tela no menu/i });
  await s.fill(name);
  const item = page.getByRole('navigation').getByRole('button', { name, exact: true });
  return item;
};
const ready = (page: Page) => expect(page.getByRole('searchbox', { name: /buscar tela no menu/i })).toBeVisible();

test.describe('Início com Financeiro e sem Boletos', () => {
  test('menu, Financeiro sem boleto e sem botão para tela bloqueada', async ({ page, db }) => {
    setup(mustMock(db), 'inicio');
    await login(page, 'owner'); await ready(page);
    for (const name of ['Contas a Pagar', 'Contas a Receber']) await expect(await menu(page, name)).toHaveCount(1);
    for (const name of ['Boletos', 'Relatórios']) await expect(await menu(page, name)).toHaveCount(0);

    await goTo(page, 'Contas a Pagar');
    // Boleto em aberto aparece aqui, porque a tela Boletos não existe neste plano.
    await expect(page.getByText('Conta com boleto E2E').first()).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: /relatórios/i })).toHaveCount(0);
    await expect(page.getByRole('main').getByText(/boleto/i).filter({ hasNotText: 'Conta com boleto E2E' })).toHaveCount(0);
    await page.getByRole('button', { name: /novo lançamento/i }).click();
    const modal = page.getByRole('dialog').filter({ hasText: /nova conta a pagar/i });
    await expect(modal.locator('option', { hasText: /boleto/i })).toHaveCount(0);
    await expect(modal.getByText(/boleto/i)).toHaveCount(0);
  });

  test('PDV não oferece boleto', async ({ page, db }) => {
    setup(mustMock(db), 'inicio');
    await login(page, 'owner'); await ready(page);
    await goTo(page, 'Vendas / PDV');
    const select = page.getByLabel('Pagamento', { exact: true });
    await expect(select).toBeVisible();
    await expect(select.locator('option', { hasText: 'Boleto' })).toHaveCount(0);
    await expect(select.locator('option', { hasText: 'PIX' })).toHaveCount(1);
  });

  test('Crescimento não muda: Boleto no PDV, botão Relatórios e boleto em aberto só na tela Boletos', async ({ page, db }) => {
    setup(mustMock(db), 'crescimento');
    await login(page, 'owner'); await ready(page);
    await goTo(page, 'Vendas / PDV');
    await expect(page.getByLabel('Pagamento', { exact: true }).locator('option', { hasText: 'Boleto' })).toHaveCount(1);
    await goTo(page, 'Contas a Pagar');
    await expect(page.getByRole('main').getByRole('button', { name: /relatórios/i })).toHaveCount(1);
    await expect(page.getByText('Conta com boleto E2E')).toHaveCount(0);
    await goTo(page, 'Boletos');
    await expect(page.getByText('Conta com boleto E2E').first()).toBeVisible();
  });
});

test.describe('Início no celular', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('menu "Mais" tem Contas a Pagar e Receber, sem Boletos nem Relatórios; PDV sem boleto', async ({ page, db }) => {
    setup(mustMock(db), 'inicio');
    await page.addInitScript(() => localStorage.setItem('COM_STILLO_VIEW_MODE', 'mobile'));
    await login(page, 'owner');
    const nav = page.getByRole('navigation', { name: /navegação principal/i });
    await nav.getByRole('button', { name: 'Mais' }).click();
    await expect(page.getByRole('button', { name: /contas a pagar/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /contas a receber/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^boletos$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^relatórios$/i })).toHaveCount(0);
    await page.getByRole('button', { name: /contas a pagar/i }).click();
    await expect(page.getByText('Conta com boleto E2E').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /relatórios/i })).toHaveCount(0);
    await nav.getByRole('button', { name: 'PDV' }).click();
    await expect(page.getByText(/boleto/i)).toHaveCount(0);
  });
});

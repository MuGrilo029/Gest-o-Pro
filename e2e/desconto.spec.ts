import { Page } from '@playwright/test';
import { test, expect, login } from './support/fixtures';
import type { MockDb } from './support/supabaseMock';

/**
 * D4: limite de desconto do vendedor (padrão 10%). Sofá E2E = R$ 1.500 → máximo R$ 150.
 * Só no modo mock: depende de papéis de teste (vendedor com senha 'x').
 */
const asSeller = async (page: Page) => {
  await page.goto('/');
  await page.getByLabel(/e-?mail/i).first().fill('vendedor1@e2e.test');
  await page.getByLabel(/senha/i).first().fill('x');
  await page.getByRole('button', { name: /^entrar no sistema$/i }).click();
};

const openPdv = async (page: Page) => {
  const search = page.getByRole('searchbox', { name: /buscar tela no menu/i });
  await search.fill('Vendas / PDV');
  await search.press('Enter');
  await page.getByPlaceholder('Buscar produtos...').fill('Sofá E2E');
  await page.getByRole('heading', { name: 'Sofá E2E 3 lugares' }).click();
};

const finish = async (page: Page) => {
  await page.getByRole('button', { name: /finalizar venda/i }).click();
  const confirm = page.getByRole('button', { name: /confirmar lançamento|confirmar venda|finalizar/i }).last();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
};

const mustMock = (db: MockDb | null): MockDb => {
  test.skip(!db, 'só no modo mock');
  return db!;
};

test.describe('desconto do vendedor (D4)', () => {
  test('vendedor dentro do limite vende', async ({ page, db }) => {
    const mock = mustMock(db);
    await asSeller(page);
    await openPdv(page);
    await page.getByLabel('Desconto (R$)').fill('150');
    await expect(page.getByTestId('discount-limit')).toHaveCount(0);
    await finish(page);
    await expect.poll(() => mock.table('sales').length).toBe(1);
    expect(Number(mock.table('sales')[0].discount)).toBe(150);
  });

  test('vendedor acima do limite é bloqueado antes do envio, com o valor máximo', async ({ page, db }) => {
    const mock = mustMock(db);
    await asSeller(page);
    await openPdv(page);
    await page.getByLabel('Desconto (R$)').fill('150.01');
    await expect(page.getByTestId('discount-limit')).toContainText('R$ 150,00');
    await expect(page.getByRole('button', { name: /finalizar venda/i })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^continuar$/i })).toBeDisabled();
    expect(mock.calls.some(c => c.name === 'create_sale')).toBe(false);
  });

  test('gerente acima do limite vende', async ({ page, db }) => {
    const mock = mustMock(db);
    mock.members.find(m => m.email === 'vendedor1@e2e.test')!.role = 'MANAGER';
    await asSeller(page);
    await openPdv(page);
    await page.getByLabel('Desconto (R$)').fill('600');
    await expect(page.getByTestId('discount-limit')).toHaveCount(0);
    await finish(page);
    await expect.poll(() => mock.table('sales').length).toBe(1);
    expect(Number(mock.table('sales')[0].total)).toBe(900);
  });
});

test.describe('limite configurado pelo dono (064)', () => {
  const openSettings = async (page: Page) => {
    const search = page.getByRole('searchbox', { name: /buscar tela no menu/i });
    await search.fill('Configurações');
    await search.press('Enter');
  };

  test('dono muda o limite e o vendedor passa a obedecer o novo valor', async ({ page, db }) => {
    const mock = mustMock(db);
    await login(page, 'owner');
    await openSettings(page);
    const field = page.getByLabel('Desconto máximo do vendedor (%)');
    await expect(field).toHaveValue('10');
    await field.fill('101');
    await expect(page.getByRole('button', { name: /salvar limite/i })).toBeDisabled();
    await field.fill('20');
    await page.getByRole('button', { name: /salvar limite/i }).click();
    await expect(page.getByText('Desconto máximo do vendedor: 20%.')).toBeVisible();
    expect(mock.stores[0].maxDiscount).toBe(20);
    await page.getByRole('alertdialog').getByRole('button').last().click();

    await page.getByRole('button', { name: /^sair$/i }).click();
    // Espera o logout terminar antes de abrir a tela de novo.
    await expect(page.getByRole('button', { name: /^entrar no sistema$/i })).toBeVisible();
    await asSeller(page);
    await openPdv(page);
    await page.getByLabel('Desconto (R$)').fill('301');
    await expect(page.getByTestId('discount-limit')).toContainText('R$ 300,00');
    await page.getByLabel('Desconto (R$)').fill('300');
    await finish(page);
    await expect.poll(() => mock.table('sales').length).toBe(1);
  });

  test('gerente não vê o campo do limite', async ({ page, db }) => {
    const mock = mustMock(db);
    mock.members.find(m => m.email === 'vendedor1@e2e.test')!.role = 'MANAGER';
    await asSeller(page);
    await openSettings(page);
    await expect(page.getByRole('button', { name: /salvar alterações/i }).first()).toBeVisible();
    await expect(page.getByTestId('seller-discount-limit')).toHaveCount(0);
  });

  test('erro do servidor aparece quando o limite mudou depois que a tela carregou', async ({ page, db }) => {
    const mock = mustMock(db);
    await asSeller(page);
    await openPdv(page);
    await page.getByLabel('Desconto (R$)').fill('100');
    mock.stores[0].maxDiscount = 5; // dono reduziu o limite; a tela ainda tem 10
    await finish(page);
    await expect(page.getByText(/máximo 75\.00/).first()).toBeVisible();
    expect(mock.table('sales')).toHaveLength(0);
  });
});

test.describe('PDV mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('COM_STILLO_VIEW_MODE', 'mobile'));
  });

  const toPayment = async (page: Page) => {
    await page.getByRole('navigation', { name: /navegação principal/i }).getByRole('button', { name: 'PDV' }).click();
    await page.getByPlaceholder('Buscar produto ou SKU...').fill('Sofá E2E');
    await page.getByText('Sofá E2E 3 lugares').first().click();
    await page.getByRole('button', { name: /^finalizar venda$/i }).click();
    await page.getByRole('button', { name: /ir para pagamento/i }).click();
  };

  test('venda no cartão de crédito parcelado envia taxa e parcelas que o servidor aceita', async ({ page, db }) => {
    const mock = mustMock(db);
    await login(page, 'owner');
    await toPayment(page);
    await page.getByRole('button', { name: /^crédito$/i }).click();
    await page.getByRole('button', { name: /^3x/i }).click();
    await page.getByRole('button', { name: /revisar pedido/i }).click();
    await page.getByRole('button', { name: /confirmar e finalizar venda/i }).click();

    await expect.poll(() => mock.table('sales').length).toBe(1);
    const sale = mock.table('sales')[0];
    expect(sale.payment_method).toBe('CREDIT_CARD');
    expect(Number(sale.card_installments)).toBe(3);
    expect(Number(sale.card_fee_amount)).toBe(60); // 1500 × 4%
    expect(Number(sale.total)).toBe(1500);
  });

  test('erro do servidor aparece no celular', async ({ page, db }) => {
    const mock = mustMock(db);
    await asSeller(page);
    await toPayment(page);
    await page.locator('input[placeholder="0,00"]').first().fill('100');
    mock.stores[0].maxDiscount = 5;
    await page.getByRole('button', { name: /revisar pedido/i }).click();
    await page.getByRole('button', { name: /confirmar e finalizar venda/i }).click();
    await expect(page.getByText(/máximo 75\.00/).first()).toBeVisible();
    expect(mock.table('sales')).toHaveLength(0);
  });

  test('vendedor acima do limite não passa do pagamento', async ({ page, db }) => {
    const mock = mustMock(db);
    await asSeller(page);
    await toPayment(page);
    await page.locator('input[placeholder="0,00"]').first().fill('151');
    await expect(page.getByTestId('discount-limit')).toContainText('R$ 150,00');
    await expect(page.getByRole('button', { name: /revisar pedido/i })).toBeDisabled();
    expect(mock.calls.some(c => c.name === 'create_sale')).toBe(false);
  });
});

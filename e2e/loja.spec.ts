import { Page } from '@playwright/test';
import { test, expect, login } from './support/fixtures';

/**
 * Fluxos da loja que bloqueiam a venda (decisão 55): venda no PDV, entrada de estoque e lançamento financeiro.
 * Modo env: a conta E2E_OWNER_* precisa de uma loja de teste no Crescimento com o produto
 * "Sofá E2E 3 lugares" em estoque (ver e2e/README.md).
 */

const goTo = async (page: Page, screen: string) => {
  const search = page.getByRole('searchbox', { name: /buscar tela no menu/i });
  await search.fill(screen);
  await search.press('Enter');
};

test.describe('loja', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'owner');
    await expect(page.getByRole('searchbox', { name: /buscar tela no menu/i })).toBeVisible();
  });

  test('venda no PDV baixa o estoque e gera o lançamento', async ({ page, db }) => {
    await goTo(page, 'Vendas / PDV');
    await page.getByPlaceholder('Buscar produtos...').fill('Sofá E2E');
    await page.getByRole('heading', { name: 'Sofá E2E 3 lugares' }).click();
    await expect(page.getByText('1 itens')).toBeVisible();

    await page.getByRole('button', { name: /finalizar venda/i }).click();
    const confirm = page.getByRole('button', { name: /confirmar lançamento|confirmar venda|finalizar/i }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();

    await expect(page.getByText(/venda (realizada|registrada|finalizada|concluída)/i).first()).toBeVisible();
    if (db) {
      await expect.poll(() => db.table('sales').length).toBe(1);
      const sales = db.table('sales');
      expect(Number(sales[0].total)).toBe(1500);
      expect(db.table('sale_items')).toHaveLength(1);
      const sofa = db.table('products').find(p => p.sku === 'E2E-SOF')!;
      expect(sofa).toBeTruthy();
      await expect.poll(() => Number(db.table('products').find(p => p.sku === 'E2E-SOF')!.quantity)).toBe(4);
      await expect.poll(() => db.table('transactions').some(t => t.type === 'INCOME' && Number(t.amount) === 1500)).toBe(true);
    }
  });

  test('entrada de estoque soma a quantidade do produto', async ({ page, db }) => {
    await goTo(page, 'Estoque');
    await page.getByText('Mesa E2E', { exact: true }).first().click();
    await page.getByRole('button', { name: /adicionar entrada/i }).click();
    const modal = page.getByRole('dialog').filter({ hasText: 'Adicionar Entrada de Estoque' });
    await modal.getByLabel(/quantidade a adicionar/i).fill('3');
    await modal.getByRole('button', { name: /confirmar entrada/i }).click();

    await expect(page.getByText(/entrada (registrada|adicionada|de estoque)/i).first()).toBeVisible();
    if (db) {
      await expect.poll(() => Number(db.table('products').find(p => p.sku === 'E2E-MES')!.quantity)).toBe(5);
      await expect.poll(() => db.table('stock_movements').some(m => Number(m.quantity) === 3)).toBe(true);
    }
  });

  test('lançamento de conta a pagar aparece na lista', async ({ page, db }) => {
    await goTo(page, 'Contas a Pagar');
    await page.getByRole('button', { name: /novo lançamento/i }).click();
    const modal = page.getByRole('dialog').filter({ hasText: /nova conta a pagar/i });
    await modal.getByLabel(/descrição/i).fill('Aluguel E2E');
    await modal.getByLabel(/^valor \(r\$\)/i).fill('2500');
    await modal.getByRole('button', { name: /^salvar$/i }).click();

    await expect(page.getByText('Novo lançamento adicionado!')).toBeVisible();
    await expect(page.getByText('Aluguel E2E').first()).toBeVisible();
    if (db) {
      await expect.poll(() => db.table('transactions').some(x => x.description === 'Aluguel E2E')).toBe(true);
      const t = db.table('transactions').find(x => x.description === 'Aluguel E2E');
      expect(t?.type).toBe('EXPENSE');
      expect(Number(t?.amount)).toBe(2500);
    }
  });
});

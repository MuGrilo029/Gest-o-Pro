import { Page } from '@playwright/test';
import { test, expect, login } from './support/fixtures';
import { MockDb, uuid } from './support/supabaseMock';

/** Anexo de boleto (068): pasta da loja, caminho gravado, URL assinada e remoção. Só no modo mock. */
const mustMock = (db: MockDb | null): MockDb => { test.skip(!db, 'só no modo mock'); return db!; };
const today = new Date().toISOString().slice(0, 10);
const pdf = { name: 'Boleto Março.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') };

const goTo = async (page: Page, screen: string) => {
  const s = page.getByRole('searchbox', { name: /buscar tela no menu/i });
  await s.fill(screen);
  await s.press('Enter');
};
const ready = (page: Page) => expect(page.getByRole('searchbox', { name: /buscar tela no menu/i })).toBeVisible();

const newBoleto = async (page: Page) => {
  await goTo(page, 'Boletos');
  await page.getByRole('button', { name: /novo lançamento|novo boleto/i }).first().click();
  return page.getByRole('dialog').filter({ hasText: /novo boleto/i });
};

test.describe('anexo de boleto', () => {
  test('envia para {store_id}/, grava o caminho e abre por URL assinada', async ({ page, context, db }) => {
    const mock = mustMock(db);
    const store = mock.stores[0].id;
    await login(page, 'owner'); await ready(page);
    const modal = await newBoleto(page);
    await modal.getByLabel(/descrição/i).fill('Boleto E2E');
    await modal.getByLabel(/^valor \(r\$\)/i).fill('120');
    await modal.locator('#boleto-upload').setInputFiles(pdf);
    await expect(page.getByText('Boleto enviado com sucesso!')).toBeVisible();
    expect(mock.uploads[0]).toMatch(new RegExp(`^boletos/${store}/[0-9a-f-]{36}-Boleto_Marco\\.pdf$`));
    await modal.getByRole('button', { name: /^salvar$/i }).click();

    await expect.poll(() => mock.table('transactions').find(t => t.description === 'Boleto E2E')?.attachment_url)
      .toBe(mock.uploads[0].replace('boletos/', ''));
    expect(mock.removedFiles).toEqual([]);

    await context.route('https://e2e-mock.supabase.co/**', route => route.fulfill({ status: 200, body: 'ok' }));
    const popup = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Ver Boleto/Anexo' }).first().click();
    await (await popup).waitForURL(/object\/sign\/boletos\/.+token=e2e/);
    expect(mock.signedFiles).toEqual([mock.uploads[0]]);
  });

  test('cancelar apaga o envio não salvo; excluir o lançamento apaga o anexo', async ({ page, db }) => {
    const mock = mustMock(db);
    const store = mock.stores[0].id;
    const path = `${store}/00000000-antigo.pdf`;
    mock.table('transactions').push({ id: uuid(), description: 'Boleto com anexo', amount: 50, type: 'EXPENSE', category: 'Geral', date: today, due_date: today, status: 'PENDING', has_boleto: true, attachment_url: path });
    await login(page, 'owner'); await ready(page);
    const modal = await newBoleto(page);
    await modal.locator('#boleto-upload').setInputFiles(pdf);
    await expect(page.getByText('Boleto enviado com sucesso!')).toBeVisible();
    await modal.getByRole('button', { name: /^cancelar$/i }).click();
    await expect.poll(() => mock.removedFiles).toEqual([mock.uploads[0]]);

    await page.getByText('Boleto com anexo').first().click();
    const edit = page.getByRole('dialog').filter({ hasText: /editar lançamento/i });
    await edit.getByRole('button', { name: /^excluir$/i }).click();
    await page.getByRole('dialog').filter({ hasText: /confirmar exclusão/i }).getByRole('button', { name: /confirmar exclusão/i }).click();
    await expect.poll(() => mock.removedFiles).toContain(`boletos/${path}`);
    expect(mock.table('transactions').some(t => t.description === 'Boleto com anexo')).toBe(false);
  });

  test('arquivo que não é PDF nem imagem não é enviado', async ({ page, db }) => {
    const mock = mustMock(db);
    await login(page, 'owner'); await ready(page);
    const modal = await newBoleto(page);
    await modal.locator('#boleto-upload').setInputFiles({ name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await expect(page.getByText(/envie um pdf ou uma imagem/i)).toBeVisible();
    expect(mock.uploads).toEqual([]);
  });

  test('loja sem o módulo Boletos: o boleto aparece em Contas a Pagar sem link para o anexo', async ({ page, db }) => {
    const mock = mustMock(db);
    mock.stores[0].plan = 'inicio';
    mock.table('transactions').push({ id: uuid(), description: 'Boleto pago antigo', amount: 50, type: 'EXPENSE', category: 'Geral', date: today, due_date: today, status: 'PAID', has_boleto: true, attachment_url: `${mock.stores[0].id}/x.pdf` });
    await login(page, 'owner'); await ready(page);
    await goTo(page, 'Contas a Pagar');
    await expect(page.getByText('Boleto pago antigo').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /ver (boleto\/)?anexo/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /anexo/i })).toHaveCount(0);
  });
});

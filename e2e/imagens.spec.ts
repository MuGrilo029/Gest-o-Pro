import { Page } from '@playwright/test';
import { test, expect, login } from './support/fixtures';
import { MOCK_SUPABASE_URL, MockDb, uuid } from './support/supabaseMock';

/**
 * Upload de imagens: sempre em {store_id}/ da loja ativa. O Storage falso recusa o resto, como a RLS.
 * Só no modo mock.
 */
const mustMock = (db: MockDb | null): MockDb => { test.skip(!db, 'só no modo mock'); return db!; };
const png = { name: 'Foto do Sofá.PNG', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgo=', 'base64') };
const OLD_URL = `${MOCK_SUPABASE_URL}/storage/v1/object/public/products/antiga123.jpg`;

const goTo = async (page: Page, screen: string) => {
  const s = page.getByRole('searchbox', { name: /buscar tela no menu/i });
  await s.fill(screen);
  await s.press('Enter');
};
const ready = (page: Page) => expect(page.getByRole('searchbox', { name: /buscar tela no menu/i })).toBeVisible();
const inStoreFolder = (db: MockDb, storeId: string, prefix = '') =>
  new RegExp(`^products/${storeId}/${prefix}[0-9a-f-]{36}\\.png$`);

test.describe('imagens na pasta da loja', () => {
  test('produto: envia para {store_id}/ e a URL antiga continua abrindo até ser substituída', async ({ page, db }) => {
    const mock = mustMock(db);
    mock.table('products')[0].image = OLD_URL;
    await login(page, 'owner'); await ready(page);
    await goTo(page, 'Estoque');
    await page.getByText('Sofá E2E 3 lugares', { exact: true }).first().click();
    const preview = page.getByRole('dialog').locator(`img[src="${OLD_URL}"]`);
    await expect(preview).toBeVisible();
    expect(await preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    // Tirar a imagem antiga só limpa o campo (a tela não apaga arquivo) e permite enviar outra.
    await page.getByRole('dialog').locator('div.relative', { has: page.locator(`img[src="${OLD_URL}"]`) }).getByRole('button').click();
    await page.getByRole('dialog').locator('input[type="file"]').setInputFiles(png);
    await expect(page.getByText('Imagem enviada com sucesso!')).toBeVisible();
    expect(mock.uploads).toHaveLength(1);
    expect(mock.uploads[0]).toMatch(inStoreFolder(mock, mock.stores[0].id));
    expect(mock.refusedUploads).toEqual([]);
  });

  test('orçamento: item avulso envia para {store_id}/ sem espaços no nome', async ({ page, db }) => {
    const mock = mustMock(db);
    await login(page, 'owner'); await ready(page);
    await goTo(page, 'Orçamentos');
    await page.getByText(/item avulso|item personalizado/i).first().click();
    await page.locator('input[type="file"]').setInputFiles(png);
    await expect(page.getByText('Imagem enviada com sucesso!')).toBeVisible();
    expect(mock.uploads[0]).toMatch(inStoreFolder(mock, mock.stores[0].id));
  });

  test('logo: envia para {store_id}/', async ({ page, db }) => {
    const mock = mustMock(db);
    await login(page, 'owner'); await ready(page);
    await goTo(page, 'Configurações');
    await page.getByRole('button', { name: 'Emissão de Pedido' }).click();
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(png);
    await expect(page.getByText('Logo enviada com sucesso!')).toBeVisible();
    expect(mock.uploads[0]).toMatch(inStoreFolder(mock, mock.stores[0].id, 'company_logo_'));
  });

  test('referência da ordem de serviço (PDV): envia para {store_id}/', async ({ page, db }) => {
    const mock = mustMock(db);
    mock.stores[0].plan = 'avancado'; // ficha detalhada (sob medida) com foto de referência
    mock.table('products').push({ id: uuid(), name: 'Reforma E2E', sku: 'E2E-SRV', price: 300, cost: 0, quantity: 0, min_stock: 0, category: 'Serviços' });
    await login(page, 'owner'); await ready(page);
    await goTo(page, 'Vendas / PDV');
    await page.getByPlaceholder('Buscar produtos...').fill('Reforma E2E');
    await page.getByRole('heading', { name: 'Reforma E2E' }).click();
    await page.getByRole('button', { name: /finalizar venda/i }).click();
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(png);
    await expect.poll(() => mock.uploads.length).toBe(1);
    expect(mock.uploads[0]).toMatch(inStoreFolder(mock, mock.stores[0].id, 'os-ref-'));
  });

  test('admin com outra loja aberta grava na pasta da loja aberta', async ({ page, db }) => {
    const mock = mustMock(db);
    const other = { id: '99999999-9999-4999-8999-999999999999', name: 'Segunda Loja E2E', status: 'active' as const, plan: 'avancado', ownerEmail: 'x@e2e.test', endsAt: null, createdAt: new Date().toISOString() };
    mock.stores.push(other);
    await login(page, 'admin');
    await page.getByTestId('admin-store-row').filter({ hasText: other.name }).getByRole('button', { name: /abrir a loja/i }).click();
    await expect(page.getByText(/loja aberta pelo admin/i)).toBeVisible();
    await goTo(page, 'Configurações');
    await page.getByRole('button', { name: 'Emissão de Pedido' }).click();
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(png);
    await expect(page.getByText('Logo enviada com sucesso!')).toBeVisible();
    expect(mock.uploads[0]).toMatch(inStoreFolder(mock, other.id, 'company_logo_'));
  });

  test('o Storage falso recusa caminho sem a pasta da loja, como a RLS', async ({ page, db }) => {
    const mock = mustMock(db);
    await login(page, 'owner'); await ready(page);
    const status = await page.evaluate(async base => {
      const token = Object.keys(localStorage).filter(k => k.includes('auth-token')).map(k => JSON.parse(localStorage.getItem(k)!).access_token)[0];
      const send = (path: string) => fetch(`${base}/storage/v1/object/products/${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: 'x' }).then(r => r.status);
      return [await send('solto.png'), await send('00000000-0000-4000-8000-000000000000/outra-loja.png')];
    }, MOCK_SUPABASE_URL);
    expect(status).toEqual([400, 400]);
    expect(mock.uploads).toEqual([]);
    expect(mock.refusedUploads).toHaveLength(2);
  });
});

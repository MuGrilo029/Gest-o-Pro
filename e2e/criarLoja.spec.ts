import { Page } from '@playwright/test';
import { test, expect, login } from './support/fixtures';
import type { MockDb } from './support/supabaseMock';

/** Criar loja no painel admin (uma chamada, sem loja órfã nem duplicada). Só no modo mock. */
const mustMock = (db: MockDb | null): MockDb => { test.skip(!db, 'só no modo mock'); return db!; };

const openForm = async (page: Page) => {
  await login(page, 'admin');
  await expect(page.getByTestId('admin-panel')).toBeVisible();
  await page.getByRole('button', { name: /criar loja/i }).first().click();
  return page.getByRole('dialog', { name: 'Criar loja' });
};

const fill = async (dialog: ReturnType<Page['getByRole']>, email: string, name = 'Loja Imperio E2E', paid = false) => {
  await dialog.getByLabel(/nome da loja/i).fill(name);
  await dialog.getByLabel(/nome do dono/i).fill('Dono Novo');
  await dialog.getByLabel(/e-mail do dono/i).fill(email);
  if (paid) await dialog.getByLabel('Paga').check();
};

const creations = (db: MockDb) => db.calls.filter(c => c.name === 'manage-users' && c.args.action === 'create_store');
const submit = (dialog: ReturnType<Page['getByRole']>) => dialog.getByRole('button', { name: /^(criar loja|tentar de novo)$/i }).click();

test.describe('criar loja', () => {
  test('e-mail novo, em teste: mostra a senha provisória', async ({ page, db }) => {
    const mock = mustMock(db);
    const dialog = await openForm(page);
    await fill(dialog, 'novo@e2e.test');
    await submit(dialog);
    await expect(dialog.getByTestId('create-store-done')).toBeVisible();
    await expect(dialog.getByText('12345678')).toBeVisible();
    expect(creations(mock)[0].args.mode).toBe('trial');
    expect(creations(mock)[0].args.days).toBeUndefined();
    expect(mock.stores.filter(s => s.name === 'Loja Imperio E2E')).toHaveLength(1);
  });

  test('e-mail que já tem conta (sem loja própria), paga: não mostra senha', async ({ page, db }) => {
    const mock = mustMock(db);
    const dialog = await openForm(page);
    await fill(dialog, 'vendedor1@e2e.test', 'Loja Paga E2E', true);
    await submit(dialog);
    await expect(dialog.getByTestId('create-store-done')).toContainText('já tinha conta');
    await expect(dialog.getByText('12345678')).toHaveCount(0);
    expect(creations(mock)[0].args).toMatchObject({ mode: 'paid', days: 30, plan: 'inicio' });
    expect(mock.stores.find(s => s.name === 'Loja Paga E2E')!.status).toBe('active');
  });

  test('e-mail que já é dono: erro claro e nenhuma loja', async ({ page, db }) => {
    const mock = mustMock(db);
    const dialog = await openForm(page);
    await fill(dialog, 'dono@e2e.test');
    await submit(dialog);
    await expect(dialog.getByRole('alert')).toContainText('já é dono de uma loja');
    await expect(dialog.getByRole('alert')).not.toContainText('UMA_LOJA_POR_DONO');
    expect(mock.stores).toHaveLength(1);
  });

  test('falha ao criar o login: erro, nada sobra; tentar de novo reusa a chave e cria uma só', async ({ page, db }) => {
    const mock = mustMock(db);
    mock.faults.createLogin = 1;
    const dialog = await openForm(page);
    await fill(dialog, 'falha@e2e.test');
    await submit(dialog);
    await expect(dialog.getByRole('alert')).toContainText('Nenhuma loja foi criada');
    expect(mock.stores).toHaveLength(1);
    await submit(dialog);
    await expect(dialog.getByTestId('create-store-done')).toBeVisible();
    const [a, b] = creations(mock);
    expect(b.args.request_id).toBe(a.args.request_id);
    expect(mock.stores).toHaveLength(2);
  });

  test('resposta perdida: fechar, reabrir e repetir os mesmos dados não duplica', async ({ page, db }) => {
    const mock = mustMock(db);
    mock.faults.lostResponse = 1;
    let dialog = await openForm(page);
    await fill(dialog, 'perdida@e2e.test');
    await submit(dialog);
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: /^cancelar$/i }).click();
    await page.getByRole('button', { name: /criar loja/i }).first().click();
    dialog = page.getByRole('dialog', { name: 'Criar loja' });
    await fill(dialog, 'perdida@e2e.test');
    await submit(dialog);
    await expect(dialog.getByTestId('create-store-done')).toContainText('nada foi duplicado');
    expect(mock.stores.filter(s => s.ownerEmail === 'perdida@e2e.test')).toHaveLength(1);
    expect(new Set(creations(mock).map(c => c.args.request_id)).size).toBe(1);
  });

  test('duplo clique envia um pedido só e o formulário não fecha durante o envio', async ({ page, db }) => {
    const mock = mustMock(db);
    const dialog = await openForm(page);
    await fill(dialog, 'duplo@e2e.test');
    mock.faults.delayMs = 1200;
    await dialog.getByRole('button', { name: /^criar loja$/i }).dblclick();
    await expect(dialog.getByRole('button', { name: /criando/i })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Fechar' })).toBeDisabled();
    await page.mouse.click(20, 400); // clique fora do painel
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('create-store-done')).toBeVisible();
    expect(creations(mock)).toHaveLength(1);
    expect(mock.stores.filter(s => s.ownerEmail === 'duplo@e2e.test')).toHaveLength(1);
  });
});

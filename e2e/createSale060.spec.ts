import { test, expect } from './support/fixtures';
import { MockDb, installSupabaseMock, seedDefault } from './support/supabaseMock';

/**
 * Regras do create_sale (060) no Supabase falso: confere que o mock recusa o que o banco recusa,
 * para os testes de tela não passarem com valores que a produção rejeitaria.
 * A prova no banco de verdade é tests/db (PGlite) do Backend.
 */
const call = async (page: import('@playwright/test').Page, sale: Record<string, unknown>, items: Record<string, unknown>[]) =>
  page.evaluate(async ([s, i]) => {
    const res = await fetch('https://e2e-mock.supabase.co/rest/v1/rpc/create_sale', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_sale: s, p_items: i }),
    });
    return { status: res.status, body: await res.json() };
  }, [sale, items] as const);

test.describe('create_sale no mock reflete a 060', () => {
  let db: MockDb;
  test.beforeEach(async ({ page }) => {
    await page.unrouteAll();
    db = seedDefault();
    await installSupabaseMock(page, db);
    await page.goto('/');
  });

  const item = { product_name: 'Mesa', quantity: 2, unit_price: 100 };

  test('total diferente da soma dos itens − desconto é recusado', async ({ page }) => {
    const r = await call(page, { total: 190, discount: 0, payment_type: 'FULL', payment_method: 'Dinheiro' }, [item]);
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('não confere com os itens (calculado: 200)');
  });

  test('desconto maior que o subtotal é recusado', async ({ page }) => {
    const r = await call(page, { total: 0, discount: 300, payment_type: 'FULL', payment_method: 'Dinheiro' }, [item]);
    expect(r.body.message).toContain('desconto deve ficar entre 0 e o subtotal');
  });

  test('pagamento dividido: restante tem de ser total − entrada', async ({ page }) => {
    const bad = await call(page, { total: 200, discount: 0, payment_type: 'PARTIAL', payment_method: 'PIX', down_payment: 50, remaining_amount: 100 }, [item]);
    expect(bad.body.message).toContain('restante deve ser o total menos a entrada');
    const ok = await call(page, { total: 200, discount: 0, payment_type: 'PARTIAL', payment_method: 'PIX', down_payment: 50, remaining_amount: 150, down_payment_method: 'PIX', remaining_payment_method: 'Dinheiro' }, [item]);
    expect(ok.status).toBe(200);
  });

  test('loja sem card_fees só aceita taxa 0', async ({ page }) => {
    db.tables.card_fees = [];
    const r = await call(page, { total: 200, discount: 0, payment_type: 'FULL', payment_method: 'Cartão Crédito', card_fee_amount: 5, card_installments: 1 }, [item]);
    expect(r.body.message).toContain('deve ser 0');
    const ok = await call(page, { total: 200, discount: 0, payment_type: 'FULL', payment_method: 'Cartão Crédito', card_fee_amount: 0, card_installments: 1 }, [item]);
    expect(ok.status).toBe(200);
  });

  test('taxa fora da tabela da loja é recusada; débito usa a linha de 0 parcelas', async ({ page }) => {
    const bad = await call(page, { total: 200, discount: 0, payment_type: 'FULL', payment_method: 'Cartão Crédito', card_fee_amount: 1, card_installments: 3 }, [item]);
    expect(bad.body.message).toContain('esperado: 8');
    const debit = await call(page, { total: 200, discount: 0, payment_type: 'FULL', payment_method: 'Cartão Débito', card_fee_amount: 3, card_installments: 5 }, [item]);
    expect(debit.status).toBe(200);
  });
});

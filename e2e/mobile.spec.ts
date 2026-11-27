import { Page } from '@playwright/test';
import { test, expect, login } from './support/fixtures';

/**
 * PWA no celular (decisão 24), na ordem: Vendas/PDV, Estoque, Clientes, Dashboard, Financeiro.
 * 390px não é prioridade: o teste só pega quebra grave (conteúdo que sai da tela sem rolagem própria).
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** Elementos visíveis que passam da borda direita e não estão dentro de uma área com rolagem horizontal. */
const overflowing = (page: Page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out: string[] = [];
  const scrollsX = (el: Element | null): boolean => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const st = getComputedStyle(e);
      if ((st.overflowX === 'auto' || st.overflowX === 'scroll') && e.scrollWidth > e.clientWidth) return true;
    }
    return false;
  };
  document.querySelectorAll('main *, [data-mobile-content] *, body > div *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const st = getComputedStyle(el);
    if (st.position === 'fixed' || st.visibility === 'hidden') return;
    if (r.right > vw + 4 && r.left < vw && !scrollsX(el.parentElement)) {
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40);
      out.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ').slice(0, 3).join('.')} [${Math.round(r.right)}px] ${label}`);
    }
  });
  // Só os mais externos (evita repetir filhos do mesmo bloco).
  return out.slice(0, 8);
});

test.describe('mobile (PWA)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('COM_STILLO_VIEW_MODE', 'mobile'));
    await login(page, 'owner');
    await expect(page.getByRole('navigation', { name: /navegação principal/i })).toBeVisible();
  });

  const nav = (page: Page, name: string) =>
    page.getByRole('navigation', { name: /navegação principal/i }).getByRole('button', { name }).click();

  const openMore = async (page: Page, item: RegExp) => {
    await nav(page, 'Mais');
    await page.getByRole('button', { name: item }).first().click();
  };

  const screens: [string, (p: Page) => Promise<void>][] = [
    ['1-pdv', p => nav(p, 'PDV')],
    ['2-estoque', p => nav(p, 'Estoque')],
    ['3-clientes', p => openMore(p, /^clientes$/i)],
    ['4-dashboard', p => nav(p, 'Início')],
    ['5-financeiro', p => openMore(p, /contas a pagar/i)],
  ];

  for (const [name, go] of screens) {
    test(`${name} sem quebra grave em 390px`, async ({ page }, info) => {
      await go(page);
      await page.waitForTimeout(600);
      await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: false });
      const bad = await overflowing(page);
      expect(bad, `Conteúdo fora da tela em ${name}:\n${bad.join('\n')}`).toEqual([]);
    });
  }
});

import { describe, expect, it } from 'vitest';
import { hideBoletoUi, withoutBoleto } from '../lib/boletos';

describe('boleto na loja Início (pedido do dono de 27/11)', () => {
  it('esconde só no Início sem o módulo Boletos', () => {
    expect(hideBoletoUi('inicio', false)).toBe(true);
    expect(hideBoletoUi('inicio', true)).toBe(false); // override ligando Boletos
  });

  it('outros planos não mudam, nem o legado custom (com o módulo desligado)', () => {
    for (const plan of ['crescimento', 'avancado', 'trial', 'custom', null, undefined]) {
      expect(hideBoletoUi(plan, false), String(plan)).toBe(false);
    }
  });

  it('tira Boleto das formas de pagamento, mas mantém o valor já gravado em edição', () => {
    const all = ['Dinheiro', 'PIX', 'Boleto'];
    expect(withoutBoleto(all, true)).toEqual(['Dinheiro', 'PIX']);
    expect(withoutBoleto(all, true, 'Boleto')).toEqual(all);
    expect(withoutBoleto(all, true, 'PIX')).toEqual(['Dinheiro', 'PIX']);
    expect(withoutBoleto(all, false)).toEqual(all);
  });
});

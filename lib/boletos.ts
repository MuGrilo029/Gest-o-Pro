/**
 * Loja do plano Início com Financeiro e sem Boletos (pedido do dono de 27/11): a tela não oferece
 * nada de boleto. Vale só para o Início; os outros planos (inclusive o legado `custom`) não mudam.
 * Com o módulo Boletos ligado por override, a tela volta a mostrar.
 */
export const hideBoletoUi = (planCode: string | null | undefined, boletosEnabled: boolean): boolean =>
  planCode === 'inicio' && !boletosEnabled;

/**
 * Tira "Boleto" de uma lista de formas de pagamento. `keep` é o valor já gravado no registro em edição:
 * se for boleto, continua na lista para a tela não trocar a forma de pagamento sem avisar.
 */
export const withoutBoleto = (methods: string[], hide: boolean, keep?: string | null): string[] =>
  hide ? methods.filter(m => m.toLowerCase() !== 'boleto' || m === keep) : methods;

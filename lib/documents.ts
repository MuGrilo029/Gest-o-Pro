/** Validação de CPF e CNPJ (formato, dígito verificador e duplicidade). */

export const onlyDigits = (value: string): string => (value || '').replace(/\D/g, '');

const allSameDigit = (digits: string) => /^(\d)\1+$/.test(digits);

export const isValidCpf = (raw: string): boolean => {
  const c = onlyDigits(raw);
  if (c.length !== 11 || allSameDigit(c)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(c[9]) && check(10) === Number(c[10]);
};

export const isValidCnpj = (raw: string): boolean => {
  const c = onlyDigits(raw);
  if (c.length !== 14 || allSameDigit(c)) return false;
  const weights12 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights13 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const check = (len: number, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12, weights12) === Number(c[12]) && check(13, weights13) === Number(c[13]);
};

/** Mensagem de erro para um CPF/CNPJ preenchido; null quando vazio (campo opcional) ou válido. */
export const docProblem = (raw: string): string | null => {
  const c = onlyDigits(raw);
  if (!c) return null;
  if (c.length === 11) return isValidCpf(c) ? null : 'CPF inválido. Confira os números.';
  if (c.length === 14) return isValidCnpj(c) ? null : 'CNPJ inválido. Confira os números.';
  return 'Informe um CPF (11 números) ou um CNPJ (14 números).';
};

/** Cliente que já usa o mesmo CPF/CNPJ (ignora o próprio cliente ao editar). */
export const findDocOwner = (
  raw: string,
  customers: { id: string; name: string; cpfCnpj?: string }[],
  selfId?: string
) => {
  const c = onlyDigits(raw);
  if (!c) return undefined;
  return customers.find(x => x.id !== selfId && onlyDigits(x.cpfCnpj || '') === c);
};

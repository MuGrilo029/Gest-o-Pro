/**
 * Chave de repetição da criação de loja. O mesmo pedido (mesmos dados) reusa o mesmo `request_id`
 * até dar certo, mesmo que o formulário seja fechado e reaberto: repetir não cria uma segunda loja.
 * Dados diferentes geram outra chave.
 */
export interface CreateStoreData {
  storeName: string;
  ownerName: string;
  email: string;
  plan: string;
  mode: 'trial' | 'paid';
  days?: number;
}

const STORAGE_KEY = 'GESTAO_PRO_CREATE_STORE_REQUESTS';
type Pending = Record<string, string>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const memory = new Map<string, string>();
const memoryStorage: Storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => { memory.set(k, v); } };
const defaultStorage = (): Storage => (typeof sessionStorage !== 'undefined' ? sessionStorage : memoryStorage);

export const requestSignature = (d: CreateStoreData): string => JSON.stringify([
  d.storeName.trim(), d.ownerName.trim(), d.email.trim().toLowerCase(), d.plan, d.mode, d.mode === 'paid' ? d.days ?? null : null,
]);

const read = (storage: Storage): Pending => {
  try { return JSON.parse(storage.getItem(STORAGE_KEY) || '{}') as Pending; } catch { return {}; }
};

export const requestIdFor = (
  data: CreateStoreData,
  storage: Storage = defaultStorage(),
  newId: () => string = () => crypto.randomUUID(),
): string => {
  const pending = read(storage);
  const sig = requestSignature(data);
  if (!pending[sig]) {
    pending[sig] = newId();
    storage.setItem(STORAGE_KEY, JSON.stringify(pending));
  }
  return pending[sig];
};

/** Depois do sucesso: um novo pedido com os mesmos dados é outro pedido. */
export const forgetRequest = (data: CreateStoreData, storage: Storage = defaultStorage()): void => {
  const pending = read(storage);
  delete pending[requestSignature(data)];
  storage.setItem(STORAGE_KEY, JSON.stringify(pending));
};

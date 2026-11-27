/**
 * Caminho de arquivo no Storage: sempre dentro da pasta da loja ativa (inclusive a loja aberta pelo
 * admin). A RLS (migrações 011, 051 e 068) recusa qualquer gravação fora de `{store_id}/`.
 * URLs já gravadas não mudam: continuam apontando para o arquivo antigo.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extensão só com letras e números (sem espaço, barra ou ponto extra); sem extensão válida, "bin". */
export const fileExtension = (name: string | null | undefined): string => {
  const ext = (name || '').trim().split('.').pop() || '';
  return (name || '').includes('.') && /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : 'bin';
};

export const storeFilePath = (
  storeId: string | null | undefined,
  originalName: string | null | undefined,
  prefix = '',
  random: () => string = () => crypto.randomUUID(),
): string => {
  if (!storeId || !UUID_RE.test(storeId)) throw new Error('Nenhuma loja ativa: não é possível enviar o arquivo.');
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '');
  return `${storeId}/${safePrefix}${random()}.${fileExtension(originalName)}`;
};

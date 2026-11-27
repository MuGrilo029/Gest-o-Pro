import { supabase } from './supabase';
import { fileExtension, storeFilePath } from './storagePath';

/**
 * Anexos de boleto (migração 068): bucket PRIVADO `boletos`, arquivo em `{store_id}/…`.
 * O banco guarda o CAMINHO em transactions.attachment_url; a abertura é por URL assinada.
 * Quem pode: dono ou gerente da loja ativa com Financeiro e Boletos ligados (rpc can_access_boletos).
 */
export const BOLETOS_BUCKET = 'boletos';
export const BOLETO_MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
};
export const BOLETO_ACCEPT = Object.keys(TYPES).map(e => `.${e}`).join(',');
const SIGNED_URL_TTL_SECONDS = 3600;

/** Anexo antigo gravado como endereço completo: abre direto, sem passar pelo bucket. */
export const isExternalAttachment = (ref: string): boolean => /^https?:\/\//i.test(ref);

export const boletoContentType = (file: { name: string; type?: string }): string | null => {
  const allowed = Object.values(TYPES);
  if (file.type && allowed.includes(file.type)) return file.type;
  // Alguns navegadores não informam o tipo do HEIC.
  return file.type ? null : TYPES[fileExtension(file.name)] ?? null;
};

export const boletoFileProblem = (file: { name: string; type?: string; size: number }): string | null => {
  if (!boletoContentType(file)) return 'Envie um PDF ou uma imagem (JPG, PNG, WEBP ou HEIC).';
  if (file.size > BOLETO_MAX_BYTES) return 'O arquivo passa de 10 MB.';
  return null;
};

/** `{store_id}/{uuid}-nome_seguro.ext` */
export const boletoPath = (storeId: string | null | undefined, fileName: string, random: () => string = () => crypto.randomUUID()): string => {
  const base = fileName.replace(/\.[^.]*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'boleto';
  const withName = storeFilePath(storeId, fileName, '', random);
  return withName.replace(/\.([a-z0-9]+)$/, `-${base}.$1`);
};

export const uploadBoleto = async (storeId: string | null | undefined, file: File): Promise<string> => {
  const problem = boletoFileProblem(file);
  if (problem) throw new Error(problem);
  const path = boletoPath(storeId, file.name);
  const { error } = await supabase.storage.from(BOLETOS_BUCKET).upload(path, file, { contentType: boletoContentType(file)! });
  if (error) throw new Error('O armazenamento recusou o arquivo. Confira o tipo, o tamanho e se o módulo Boletos está ligado.');
  return path;
};

export const signedBoletoUrl = async (path: string): Promise<string> => {
  const { data, error } = await supabase.storage.from(BOLETOS_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new Error('Não foi possível abrir o anexo.');
  return data.signedUrl;
};

/** Apaga arquivos do bucket. Falha não interrompe a tela (o arquivo fica guardado). */
export const removeBoletoFiles = async (refs: (string | null | undefined)[]): Promise<void> => {
  const paths = refs.filter((r): r is string => !!r && !isExternalAttachment(r));
  if (!paths.length) return;
  const { error } = await supabase.storage.from(BOLETOS_BUCKET).remove(paths);
  if (error) console.warn('BOLETOS: não foi possível apagar o arquivo antigo', error.message);
};

/**
 * Arquivo que ficou sem uso depois de trocar ou excluir um lançamento: só sai se nenhum outro
 * lançamento aponta para ele (parcelas podem compartilhar o mesmo anexo).
 */
export const orphanedAttachment = (
  oldRef: string | null | undefined,
  newRef: string | null | undefined,
  transactionId: string,
  all: { id: string; attachmentUrl?: string }[],
): string | null => {
  if (!oldRef || oldRef === newRef || isExternalAttachment(oldRef)) return null;
  return all.some(t => t.id !== transactionId && t.attachmentUrl === oldRef) ? null : oldRef;
};

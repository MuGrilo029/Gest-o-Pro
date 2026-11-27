import React, { useState } from 'react';
import { isExternalAttachment, signedBoletoUrl } from '../lib/boletoStorage';

/**
 * Abre o anexo de um lançamento. Caminho no bucket privado: só para quem tem acesso, por URL assinada
 * gerada no clique. Endereço completo (anexo antigo): link direto.
 */
export const AttachmentLink: React.FC<{
  attachment: string;
  canAccess: boolean;
  title: string;
  className?: string;
  onError: (message: string) => void;
  children: React.ReactNode;
}> = ({ attachment, canAccess, title, className, onError, children }) => {
  const [busy, setBusy] = useState(false);

  if (isExternalAttachment(attachment)) {
    return (
      <a href={attachment} target="_blank" rel="noopener noreferrer" title={title} aria-label={title} className={className} onClick={e => e.stopPropagation()}>
        {children}
      </a>
    );
  }
  if (!canAccess) return null;

  const open = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // A aba é aberta no próprio clique (senão o navegador bloqueia) e recebe o endereço depois.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setBusy(true);
    try {
      const url = await signedBoletoUrl(attachment);
      if (tab) tab.location.replace(url);
      else window.location.assign(url);
    } catch (err: any) {
      tab?.close();
      onError(err?.message || 'Não foi possível abrir o anexo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={open} disabled={busy} title={title} aria-label={title} className={className}>
      {children}
    </button>
  );
};

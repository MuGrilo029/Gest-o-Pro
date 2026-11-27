import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * QR code gerado no navegador (pacote `qrcode`), sem serviço externo:
 * o conteúdo não sai do app (antes ia para quickchart.io). Permite enxugar a CSP (A12).
 */
export const LocalQrCode: React.FC<{ text: string; size?: number; className?: string; alt?: string }> = ({
  text, size = 120, className, alt = 'QR Code',
}) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'H' })
      .then(url => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [text, size]);

  if (!src) return null;
  return <img src={src} alt={alt} width={size} height={size} className={className} />;
};

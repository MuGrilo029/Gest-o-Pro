import React, { useState } from 'react';
import { Copy, Check, X } from 'lucide-react';

/** Mostra uma senha provisória gerada pelo servidor. Ela só aparece desta vez. */
export const TempPasswordNotice: React.FC<{ email: string; password: string; onClose: () => void }> = ({ email, password, onClose }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`E-mail: ${email}\nSenha provisória: ${password}`);
      setCopied(true);
    } catch { /* sem permissão de área de transferência */ }
  };
  return (
    <div role="alert" className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100 space-y-2">
      <div className="flex justify-between gap-2">
        <p className="text-sm font-semibold">Senha provisória gerada. Ela aparece só agora: copie e envie para a pessoa.</p>
        <button onClick={onClose} aria-label="Fechar aviso" className="shrink-0"><X size={16} /></button>
      </div>
      <p className="text-sm break-all">E-mail: <strong>{email}</strong></p>
      <p className="text-sm break-all">Senha: <code className="font-mono font-bold select-all">{password}</code></p>
      <button onClick={copy} className="flex items-center gap-1 text-sm font-medium underline">
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar e-mail e senha'}
      </button>
    </div>
  );
};

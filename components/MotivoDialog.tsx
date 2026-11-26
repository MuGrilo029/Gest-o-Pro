import React, { useEffect, useRef, useState } from 'react';

/**
 * Confirmação de ação de risco com motivo obrigatório (mínimo 10 caracteres).
 * Foco inicial no Cancelar; Enter não confirma. Erro mantém o diálogo aberto.
 */
export const MotivoDialog: React.FC<{
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  /** Mostra campo de validade (data) obrigatório; usado na liberação de módulo. */
  withExpiry?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, expiresAt?: string) => void;
}> = ({ title, message, confirmLabel, busy = false, error = null, withExpiry = false, onCancel, onConfirm }) => {
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const valid = reason.trim().length >= 10 && (!withExpiry || expiresAt !== '');

  useEffect(() => { cancelRef.current?.focus(); }, []);

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md bg-white dark:bg-slate-800 rounded-xl shadow-xl p-5">
        <h2 className="text-lg font-bold text-wine-950 dark:text-white mb-2">{title}</h2>
        <p className="text-sm text-wine-700 dark:text-slate-300 mb-3">{message}</p>
        <label className="block text-sm font-medium text-wine-800 dark:text-slate-200">
          Motivo (obrigatório, mínimo de 10 caracteres)
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2 text-sm bg-transparent"
          />
        </label>
        {withExpiry && (
          <label className="block text-sm font-medium text-wine-800 dark:text-slate-200 mt-3">
            Válido até (obrigatório)
            <input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="mt-1 w-full rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2 text-sm bg-transparent" />
          </label>
        )}
        {error && <p role="alert" className="text-sm text-red-600 mt-2">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-lg border border-wine-200 text-sm">Cancelar</button>
          <button
            type="button"
            onClick={() => valid && onConfirm(reason.trim(), withExpiry ? new Date(expiresAt).toISOString() : undefined)}
            disabled={!valid || busy}
            className="px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

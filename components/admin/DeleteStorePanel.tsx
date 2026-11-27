import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { deleteStore, previewDeleteStore } from '../../lib/adminApi';
import { DeletionPreview, LOGIN_DELETION_POLICY, LOGIN_DELETION_TEXT, confirmNameMatches } from '../../lib/storeDeletion';

/**
 * Excluir loja (pedido do dono de 27/11): só o admin da plataforma. Mostra a prévia do que será
 * apagado, avisa que é irreversível e só libera o botão quando o nome exato é digitado.
 * Falha no meio: "Tentar de novo" repete a mesma chamada, que continua de onde parou.
 * A permissão de verdade é conferida no servidor.
 */
export const DeleteStorePanel: React.FC<{
  storeId: string;
  storeName: string;
  onDeleted: () => void;
  onBusyChange?: (busy: boolean) => void;
}> = ({ storeId, storeName, onDeleted, onBusyChange }) => {
  const { isPlatformAdmin } = useStore();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleting = useRef(false);

  const loadPreview = useCallback(async () => {
    setPreviewError(null);
    setPreview(null);
    try {
      setPreview(await previewDeleteStore(storeId, storeName));
    } catch (e: any) {
      setPreviewError(e?.message || 'Não foi possível calcular o que será apagado.');
    }
  }, [storeId, storeName]);

  useEffect(() => { if (isPlatformAdmin) loadPreview(); }, [loadPreview, isPlatformAdmin]);

  if (!isPlatformAdmin) return null;

  const matches = !!preview && confirmNameMatches(typed, preview.storeName);

  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches || deleting.current) return;
    deleting.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      await deleteStore(storeId, typed);
      onDeleted();
    } catch (err: any) {
      setError(err?.message || 'A exclusão não terminou.');
      setBusy(false);
      onBusyChange?.(false);
      deleting.current = false;
    }
  };

  return (
    <div className="space-y-4" data-testid="delete-store">
      <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 p-3 text-red-800 dark:text-red-200">
        <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} aria-hidden="true" /> Excluir a loja é irreversível.</p>
        <p className="mt-1">Os dados e os arquivos da loja são apagados e não dá para recuperar pelo sistema.</p>
        <p className="mt-1" data-testid="delete-logins-text">{LOGIN_DELETION_TEXT[LOGIN_DELETION_POLICY]}</p>
      </div>

      {previewError && (
        <div role="alert" className="text-red-700">
          <p>{previewError}</p>
          <button type="button" onClick={loadPreview} className="mt-2 px-3 py-1.5 rounded-lg border border-red-300 text-sm font-semibold">Tentar de novo</button>
        </div>
      )}
      {!preview && !previewError && <p className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Calculando o que será apagado…</p>}

      {preview && (
        <>
          <section aria-labelledby="previa-h">
            <h3 id="previa-h" className="font-semibold text-wine-950 dark:text-white mb-1">Será apagado</h3>
            {preview.items.length === 0
              ? <p>A loja não tem registros nem arquivos.</p>
              : (
                <ul className="divide-y divide-wine-100 dark:divide-slate-700" data-testid="delete-preview">
                  {preview.items.map(i => (
                    <li key={i.key} className="flex justify-between py-1"><span>{i.label}</span><strong>{i.count.toLocaleString('pt-BR')}</strong></li>
                  ))}
                </ul>
              )}
          </section>

          <form onSubmit={remove} className="space-y-3">
            <label className="block">
              Para confirmar, digite o nome exato da loja: <strong className="select-all">{preview.storeName}</strong>
              <input
                value={typed}
                onChange={e => setTyped(e.target.value)}
                disabled={busy}
                autoComplete="off"
                aria-label="Nome exato da loja"
                className="mt-1 w-full rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2 text-sm bg-white dark:bg-slate-900 text-wine-950 dark:text-white disabled:opacity-60"
              />
            </label>
            {error && (
              <div role="alert" className="text-red-700 dark:text-red-300">
                <p className="font-semibold">A exclusão não terminou.</p>
                <p>{error}</p>
                <p className="text-xs mt-1">Parte dos dados pode já ter sido apagada. Tentar de novo continua de onde parou.</p>
              </div>
            )}
            <button type="submit" disabled={!matches || busy} className="px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
              {busy ? 'Excluindo…' : error ? 'Tentar de novo' : 'Excluir loja definitivamente'}
            </button>
          </form>
        </>
      )}
    </div>
  );
};

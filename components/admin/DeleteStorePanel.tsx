import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { deleteStore, previewDeleteStore } from '../../lib/adminApi';
import {
  CountLine, DeletionOutcome, DeletionPreview, LOGIN_DELETION_POLICY, LOGIN_DELETION_TEXT, confirmNameMatches,
} from '../../lib/storeDeletion';

const Lines: React.FC<{ title: string; items: CountLine[]; testId: string }> = ({ title, items, testId }) => (
  <section data-testid={testId}>
    <h3 className="font-semibold text-wine-950 dark:text-white mb-1">{title}</h3>
    <ul className="divide-y divide-wine-100 dark:divide-slate-700">
      {items.map(i => (
        <li key={i.key} className="flex justify-between py-1"><span>{i.label}</span><strong>{i.count.toLocaleString('pt-BR')}</strong></li>
      ))}
    </ul>
  </section>
);

const ROLE: Record<string, string> = { OWNER: 'Dono', MANAGER: 'Gerente', SELLER: 'Vendedor' };

/**
 * Excluir loja (pedido do dono de 27/11): só o admin da plataforma. Mostra a prévia do que será
 * apagado e mantido, avisa que é irreversível e só libera o botão quando o nome exato é digitado.
 * Falha ou exclusão parcial: "Tentar de novo" repete a mesma chamada, que continua de onde parou.
 * A permissão de verdade é conferida no servidor.
 */
export const DeleteStorePanel: React.FC<{
  storeId: string;
  storeName: string;
  onDeleted: (outcome: DeletionOutcome) => void;
  /** Sobraram arquivos ou logins: o painel atualiza a lista. */
  onPartial?: () => void;
  onBusyChange?: (busy: boolean) => void;
}> = ({ storeId, storeName, onDeleted, onPartial, onBusyChange }) => {
  const { isPlatformAdmin } = useStore();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<DeletionOutcome | null>(null);
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
  const blocked = !!preview?.blocker;
  const retrying = !!error || !!partial;

  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches || blocked || deleting.current) return;
    deleting.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const outcome = await deleteStore(storeId, typed);
      if (outcome.done) { onDeleted(outcome); return; }
      setPartial(outcome);
      onPartial?.();
    } catch (err: any) {
      setError(err?.message || 'A exclusão não terminou.');
    }
    deleting.current = false;
    setBusy(false);
    onBusyChange?.(false);
  };

  const removed = preview?.logins.filter(l => l.remove) ?? [];
  const kept = preview?.logins.filter(l => !l.remove) ?? [];

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
          {preview.pending && <p className="font-semibold text-amber-800 dark:text-amber-300">A exclusão desta loja já começou. Falta concluir.</p>}

          {preview.rows.length + preview.files.length === 0
            ? <p>Não restam registros nem arquivos para apagar.</p>
            : (
              <>
                {preview.rows.length > 0 && <Lines title="Registros que serão apagados" items={preview.rows} testId="delete-preview" />}
                {preview.files.length > 0 && <Lines title="Arquivos que serão apagados" items={preview.files} testId="delete-files" />}
              </>
            )}

          {removed.length > 0 && (
            <section data-testid="delete-logins">
              <h3 className="font-semibold text-wine-950 dark:text-white mb-1">Logins que serão apagados ({removed.length})</h3>
              <ul>{removed.map(l => <li key={l.userId} className="break-all">{l.email} · {ROLE[l.role] ?? l.role}</li>)}</ul>
            </section>
          )}
          {kept.length > 0 && (
            <section data-testid="kept-logins">
              <h3 className="font-semibold text-wine-950 dark:text-white mb-1">Logins mantidos ({kept.length})</h3>
              <ul>{kept.map(l => <li key={l.userId} className="break-all">{l.email} · {ROLE[l.role] ?? l.role}{l.reason && ` (${l.reason})`}</li>)}</ul>
            </section>
          )}
          {preview.retained.length > 0 && <Lines title="Continua guardado" items={preview.retained} testId="delete-retained" />}

          {blocked && <p role="alert" className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-900/30 p-3 text-amber-900 dark:text-amber-200">Esta loja não pode ser excluída agora: {preview.blocker}</p>}

          <form onSubmit={remove} className="space-y-3">
            <label className="block">
              Para confirmar, digite o nome exato da loja: <strong className="select-all">{preview.storeName}</strong>
              <input
                value={typed}
                onChange={e => setTyped(e.target.value)}
                disabled={busy || blocked}
                autoComplete="off"
                aria-label="Nome exato da loja"
                className="mt-1 w-full rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2 text-sm bg-white dark:bg-slate-900 text-wine-950 dark:text-white disabled:opacity-60"
              />
            </label>
            {error && (
              <div role="alert" className="text-red-700 dark:text-red-300">
                <p className="font-semibold">A exclusão não terminou.</p>
                <p>{error}</p>
              </div>
            )}
            {partial && !error && (
              <div role="alert" className="text-amber-800 dark:text-amber-300" data-testid="delete-partial">
                <p className="font-semibold">Exclusão parcial: os dados foram apagados, mas ainda sobrou coisa.</p>
                <p>Arquivos restantes: {partial.filesRemaining}. Logins restantes: {partial.loginsRemaining}.</p>
                {partial.errors.map(m => <p key={m}>{m}</p>)}
                <p className="text-xs mt-1">Tentar de novo continua de onde parou.</p>
              </div>
            )}
            <button type="submit" disabled={!matches || busy || blocked} className="px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
              {busy ? 'Excluindo…' : retrying ? 'Tentar de novo' : preview.pending ? 'Concluir exclusão' : 'Excluir loja definitivamente'}
            </button>
          </form>
        </>
      )}
    </div>
  );
};

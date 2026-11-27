import React, { useEffect, useState } from 'react';
import { useStore } from '../contexts/StoreContext';
import { Button, Input, alertDialog } from './UI';
import { parseDiscountPercent } from '../lib/discount';

/** Configurações: "Desconto máximo do vendedor (%)". Visível e editável só para o dono da loja (D4). */
export const SellerDiscountLimitField: React.FC = () => {
  const { role, sellerDiscountLimit, saveSellerDiscountLimit } = useStore();
  const [text, setText] = useState(String(sellerDiscountLimit).replace('.', ','));
  const [saving, setSaving] = useState(false);

  useEffect(() => { setText(String(sellerDiscountLimit).replace('.', ',')); }, [sellerDiscountLimit]);

  if (role !== 'OWNER') return null;

  const parsed = parseDiscountPercent(text);

  const save = async () => {
    if (parsed === null) return;
    setSaving(true);
    try {
      await saveSellerDiscountLimit(parsed);
      await alertDialog(`Desconto máximo do vendedor: ${parsed.toLocaleString('pt-BR')}%.`, 'Salvo');
    } catch (err: any) {
      await alertDialog(err?.message || 'Não foi possível salvar o limite.', 'Erro');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pt-2" data-testid="seller-discount-limit">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <Input
            label="Desconto máximo do vendedor (%)"
            inputMode="decimal"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            aria-invalid={parsed === null}
          />
        </div>
        <Button type="button" variant="outline" disabled={saving || parsed === null || parsed === sellerDiscountLimit} onClick={save}>
          {saving ? 'Salvando…' : 'Salvar limite'}
        </Button>
      </div>
      {parsed === null && <p role="alert" className="text-xs text-red-600 mt-1">Informe um número de 0 a 100.</p>}
      <p className="text-xs text-wine-500 dark:text-slate-400 mt-1">Acima desse percentual, só gerente ou dono dão desconto.</p>
    </div>
  );
};

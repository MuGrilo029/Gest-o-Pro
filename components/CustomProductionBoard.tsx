import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { useStore } from '../contexts/StoreContext';
import { ProductionOrder, Delivery } from '../types';
import { Card, Button, Input, Modal, Badge, alertDialog } from './UI';
import { getUUID, formatBrazilDateTime, formatCurrency } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { Wrench, Plus, Paperclip, Calendar, User, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react';

// --- Produção sob medida ---
// Usa a mesma tabela de OS (production_orders). Os detalhes sob medida ficam em `specs` (JSON com custom: true).
// Etapas são derivadas do status da OS + entrega vinculada, então não criam coluna nova:
//   orçado = PENDING | em produção = IN_PROGRESS | pronto = COMPLETED | entregue = COMPLETED + entrega DELIVERED

export interface CustomSpecs {
  custom: true;
  description: string;
  measures: string;
  material: string;
}

export const parseCustomSpecs = (specs: string): CustomSpecs | null => {
  try {
    const parsed = JSON.parse(specs);
    return parsed && parsed.custom === true ? (parsed as CustomSpecs) : null;
  } catch {
    return null;
  }
};

export type CustomStage = 'QUOTED' | 'IN_PRODUCTION' | 'READY' | 'DELIVERED';

const STAGE_INFO: Record<CustomStage, { label: string; color: 'yellow' | 'blue' | 'gray' | 'green'; column: string }> = {
  QUOTED: { label: 'Orçado', color: 'yellow', column: 'border-amber-200 bg-amber-50/40 dark:bg-amber-900/10' },
  IN_PRODUCTION: { label: 'Em produção', color: 'blue', column: 'border-blue-200 bg-blue-50/40 dark:bg-blue-900/10' },
  READY: { label: 'Pronto', color: 'gray', column: 'border-slate-200 bg-slate-50/60 dark:bg-slate-800/50' },
  DELIVERED: { label: 'Entregue', color: 'green', column: 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-900/10' },
};
const STAGE_ORDER: CustomStage[] = ['QUOTED', 'IN_PRODUCTION', 'READY', 'DELIVERED'];

export const getCustomStage = (o: ProductionOrder, deliveries: Delivery[]): CustomStage => {
  if (o.status === 'PENDING') return 'QUOTED';
  if (o.status === 'IN_PROGRESS') return 'IN_PRODUCTION';
  const delivered = deliveries.some(d => d.productionOrderId === o.id && d.status === 'DELIVERED');
  return delivered ? 'DELIVERED' : 'READY';
};

const money = (n?: number) => formatCurrency(n || 0);

const isOverdue = (deadline?: string, stage?: CustomStage) => {
  if (!deadline || stage === 'DELIVERED') return false;
  const d = new Date(deadline + 'T23:59:59');
  return d.getTime() < Date.now();
};

// --- Abas de modo (OS padrão | Sob medida) ---
export const ProductionModeTabs: React.FC<{ mode: 'STANDARD' | 'CUSTOM'; onChange: (m: 'STANDARD' | 'CUSTOM') => void }> = ({ mode, onChange }) => (
  <div className="flex bg-wine-50 dark:bg-slate-700 p-1 rounded-lg" role="tablist" aria-label="Tipo de produção">
    {(['STANDARD', 'CUSTOM'] as const).map(m => (
      <button
        key={m}
        role="tab"
        aria-selected={mode === m}
        onClick={() => onChange(m)}
        className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${mode === m ? 'bg-white text-wine-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-wine-500 hover:text-wine-900 dark:text-slate-400'}`}
      >
        {m === 'STANDARD' ? 'OS padrão' : 'Sob medida'}
      </button>
    ))}
  </div>
);

// Bucket privado de anexos da produção sob medida (public=false, 10 MB, jpeg/png/webp/pdf).
// Caminho obrigatório: <store_id>/<uuid>-<nome>; sem a pasta da loja o envio é bloqueado.
export const CUSTOM_ATTACHMENTS_BUCKET = 'producao-anexos';
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const SIGNED_URL_TTL_SECONDS = 3600;

// Grava em <store_id>/<uuid>-<nome> e guarda só o caminho (não URL pública)
const uploadAttachment = async (file: File, storeId: string): Promise<string> => {
  if (!ATTACHMENT_TYPES.includes(file.type)) throw new Error(`Tipo de arquivo não aceito: ${file.name}`);
  if (file.size > ATTACHMENT_MAX_BYTES) throw new Error(`Arquivo acima de 10 MB: ${file.name}`);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${storeId}/${getUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(CUSTOM_ATTACHMENTS_BUCKET).upload(path, file);
  if (error) throw error;
  return path;
};

// Exibe com URL assinada (temporária). Anexos antigos com URL http(s) seguem como estão.
const resolveAttachmentUrl = async (ref: string): Promise<string | null> => {
  if (/^https?:\/\//.test(ref)) return ref;
  if (!CUSTOM_ATTACHMENTS_BUCKET) return null;
  const { data, error } = await supabase.storage.from(CUSTOM_ATTACHMENTS_BUCKET).createSignedUrl(ref, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data.signedUrl;
};

const emptyForm = { customerName: '', customerPhone: '', itemName: '', description: '', measures: '', material: '', deadline: '', totalValue: '', downPayment: '' };

export const CustomProductionBoard: React.FC<{ mode: 'STANDARD' | 'CUSTOM'; onModeChange: (m: 'STANDARD' | 'CUSTOM') => void }> = ({ mode, onModeChange }) => {
  const { productionOrders, deliveries, customers, addProductionOrder, updateProductionOrderStatus, updateDeliveryStatus, addNotification, navigateTo } = useAppStore();
  const { activeStore } = useStore();
  const [attachmentUrls, setAttachmentUrls] = useState<Record<number, string | null>>({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<ProductionOrder | null>(null);

  // Gera as URLs assinadas dos anexos do pedido aberto
  useEffect(() => {
    setAttachmentUrls({});
    const refs = selected?.attachments || [];
    if (refs.length === 0) return;
    let cancelled = false;
    Promise.all(refs.map(resolveAttachmentUrl)).then(urls => {
      if (cancelled) return;
      setAttachmentUrls(Object.fromEntries(urls.map((u, i) => [i, u])));
    });
    return () => { cancelled = true; };
  }, [selected]);

  const customOrders = productionOrders.filter(o => parseCustomSpecs(o.specs));
  const byStage: Record<CustomStage, ProductionOrder[]> = { QUOTED: [], IN_PRODUCTION: [], READY: [], DELIVERED: [] };
  customOrders.forEach(o => byStage[getCustomStage(o, deliveries)].push(o));

  const resetForm = () => { setForm(emptyForm); setFiles([]); };

  const handleSave = async () => {
    const totalValue = Number(String(form.totalValue).replace(',', '.')) || 0;
    const downPayment = Number(String(form.downPayment).replace(',', '.')) || 0;
    if (!form.customerName.trim() || !form.itemName.trim()) {
      alertDialog('Informe o cliente e o item sob medida.');
      return;
    }
    if (totalValue < 0 || downPayment < 0 || downPayment > totalValue) {
      alertDialog('Confira os valores: o sinal não pode ser maior que o total.');
      return;
    }

    setSaving(true);
    try {
      const storeId = activeStore?.id;
      if (files.length > 0 && !storeId) {
        alertDialog('Selecione uma loja antes de anexar arquivos.');
        setSaving(false);
        return;
      }
      const attachments: string[] = [];
      for (const f of files) attachments.push(await uploadAttachment(f, storeId as string));

      const specs: CustomSpecs = {
        custom: true,
        description: form.description.trim(),
        measures: form.measures.trim(),
        material: form.material.trim(),
      };
      const order: ProductionOrder = {
        id: getUUID(),
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim() || undefined,
        itemName: form.itemName.trim(),
        specs: JSON.stringify(specs),
        quantity: 1,
        date: formatBrazilDateTime(),
        status: 'PENDING', // etapa "Orçado"
        deadline: form.deadline || undefined,
        totalValue,
        downPayment,
        attachments,
      };
      await addProductionOrder(order);
      addNotification('Produção sob medida criada!', 'success');
      setShowForm(false);
      resetForm();
    } catch (err) {
      console.error('Erro ao criar produção sob medida:', err);
      addNotification('Erro ao enviar anexo. Tente novamente.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const moveForward = async (o: ProductionOrder) => {
    const stage = getCustomStage(o, deliveries);
    if (stage === 'QUOTED') return updateProductionOrderStatus(o.id, 'IN_PROGRESS');
    if (stage === 'IN_PRODUCTION') return updateProductionOrderStatus(o.id, 'COMPLETED');
    if (stage === 'READY') {
      const delivery = deliveries.find(d => d.productionOrderId === o.id);
      if (!delivery) {
        alertDialog('Não há entrega vinculada a esta produção. Ative o módulo Entregas ou registre a entrega na tela de Entregas.');
        return;
      }
      return updateDeliveryStatus(delivery.id, 'DELIVERED');
    }
  };

  const moveBack = (o: ProductionOrder) => {
    const stage = getCustomStage(o, deliveries);
    if (stage === 'IN_PRODUCTION') return updateProductionOrderStatus(o.id, 'PENDING');
    if (stage === 'READY') return updateProductionOrderStatus(o.id, 'IN_PROGRESS');
  };

  const NEXT_LABEL: Partial<Record<CustomStage, string>> = { QUOTED: 'Iniciar produção', IN_PRODUCTION: 'Marcar pronto', READY: 'Marcar entregue' };

  const renderCard = (o: ProductionOrder, stage: CustomStage) => {
    const spec = parseCustomSpecs(o.specs);
    const falta = Math.max(0, (o.totalValue || 0) - (o.downPayment || 0));
    const overdue = isOverdue(o.deadline, stage);
    const daysLate = overdue ? Math.max(1, Math.ceil((Date.now() - new Date(o.deadline + 'T23:59:59').getTime()) / 86400000)) : 0;
    const dueToday = !!o.deadline && stage !== 'DELIVERED' && o.deadline === new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const semSinal = stage !== 'QUOTED' && (o.totalValue || 0) > 0 && (o.downPayment || 0) <= 0;
    return (
      <div key={o.id} className={`bg-white dark:bg-slate-800 rounded-lg border p-3 shadow-sm space-y-2 ${overdue ? 'border-red-400 ring-1 ring-red-300' : 'border-slate-200 dark:border-slate-700'}`}>
        <button type="button" onClick={() => setSelected(o)} className="w-full text-left">
          <p className="text-[11px] font-mono text-slate-400">OS #{o.id.slice(0, 4)}</p>
          <p className="font-bold text-slate-800 dark:text-white line-clamp-1">{o.itemName}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1"><User size={12} /> {o.customerName}</p>
          {spec?.measures && <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">Medidas: {spec.measures}</p>}
        </button>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {o.deadline && (
            <span className="flex items-center gap-1 font-semibold text-slate-600 dark:text-slate-300">
              <Calendar size={12} /> {new Date(o.deadline + 'T00:00:00').toLocaleDateString('pt-BR')}
            </span>
          )}
          {(o.attachments?.length || 0) > 0 && <span className="flex items-center gap-1 text-slate-500"><Paperclip size={12} /> {o.attachments!.length}</span>}
        </div>
        {/* Alertas de prazo e sinal */}
        {(overdue || dueToday || semSinal) && (
          <div className="flex flex-wrap gap-1">
            {overdue && <Badge color="red">Atrasado há {daysLate} {daysLate === 1 ? 'dia' : 'dias'}</Badge>}
            {!overdue && dueToday && <Badge color="yellow">Entrega hoje</Badge>}
            {semSinal && <Badge color="yellow">Sinal não recebido</Badge>}
          </div>
        )}
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-600 dark:text-slate-300">Total {money(o.totalValue)}</span>
          <span className="text-slate-600 dark:text-slate-300">Sinal {money(o.downPayment)}</span>
          <span className={falta > 0 ? 'font-bold text-wine-700' : 'text-emerald-700 font-semibold'}>{falta > 0 ? `Falta ${money(falta)}` : 'Quitado'}</span>
        </div>
        <div className="flex gap-2 pt-1">
          {stage !== 'QUOTED' && stage !== 'DELIVERED' && (
            <Button variant="outline" size="sm" onClick={() => moveBack(o)} className="gap-1"><ArrowLeft size={14} /> Voltar</Button>
          )}
          {NEXT_LABEL[stage] && (
            <Button size="sm" onClick={() => moveForward(o)} className="gap-1 flex-1 justify-center">{NEXT_LABEL[stage]} <ArrowRight size={14} /></Button>
          )}
        </div>
      </div>
    );
  };

  const selectedSpec = selected ? parseCustomSpecs(selected.specs) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-wine-900 dark:text-white flex items-center gap-2"><Wrench /> Produção sob medida</h2>
          <p className="text-wine-500 dark:text-slate-400 text-sm mt-1">Acompanhe cada pedido: orçado, em produção, pronto e entregue.</p>
        </div>
        <div className="flex items-center gap-3">
          <ProductionModeTabs mode={mode} onChange={onModeChange} />
          <Button onClick={() => setShowForm(true)} className="flex items-center gap-2"><Plus size={18} /> Novo pedido sob medida</Button>
        </div>
      </div>

      {customOrders.length === 0 && (
        <Card className="text-center py-8">
          <p className="font-semibold text-slate-700 dark:text-white">Crie a primeira ordem de produção a partir de um orçamento aprovado.</p>
          <div className="mt-4">
            <Button variant="outline" onClick={() => navigateTo('QUOTES')}>Ir para Orçamentos</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {STAGE_ORDER.map(stage => (
          <div key={stage} className={`rounded-xl p-3 border flex flex-col gap-3 min-h-[200px] ${STAGE_INFO[stage].column}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 dark:text-white">{STAGE_INFO[stage].label}</h3>
              <Badge color={STAGE_INFO[stage].color}>{byStage[stage].length}</Badge>
            </div>
            {byStage[stage].map(o => renderCard(o, stage))}
            {byStage[stage].length === 0 && <p className="text-center text-xs text-slate-400 py-4">Nenhuma OS nesta etapa</p>}
          </div>
        ))}
      </div>

      {/* Detalhes */}
      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title="Pedido sob medida">
        {selected && (
          <div className="space-y-3 text-sm">
            <p className="text-lg font-bold text-slate-800 dark:text-white">{selected.itemName}</p>
            <p><span className="font-semibold">Cliente:</span> {selected.customerName}{selected.customerPhone ? ` · ${selected.customerPhone}` : ''}</p>
            <p><span className="font-semibold">Prazo:</span> {selected.deadline ? new Date(selected.deadline + 'T00:00:00').toLocaleDateString('pt-BR') : 'não informado'}</p>
            <p><span className="font-semibold">Material:</span> {selectedSpec?.material || '-'}</p>
            <p><span className="font-semibold">Medidas:</span> {selectedSpec?.measures || '-'}</p>
            <p className="whitespace-pre-wrap"><span className="font-semibold">Descrição:</span> {selectedSpec?.description || '-'}</p>
            <p><span className="font-semibold">Total:</span> {money(selected.totalValue)} · <span className="font-semibold">Sinal:</span> {money(selected.downPayment)} · <span className="font-semibold">Saldo:</span> {money((selected.totalValue || 0) - (selected.downPayment || 0))}</p>
            {(selected.attachments?.length || 0) > 0 && (
              <div>
                <p className="font-semibold mb-1">Anexos</p>
                <ul className="list-disc pl-5 space-y-1">
                  {selected.attachments!.map((_ref, i) => {
                    const url = attachmentUrls[i];
                    if (url === undefined) return <li key={i} className="text-slate-400">Anexo {i + 1} (carregando…)</li>;
                    if (url === null) return <li key={i} className="text-slate-400">Anexo {i + 1} (indisponível)</li>;
                    return <li key={i}><a className="text-wine-700 underline" href={url} target="_blank" rel="noreferrer">Anexo {i + 1}</a></li>;
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Novo pedido */}
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); resetForm(); }} title="Novo pedido sob medida">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Input label="Cliente *" list="custom-prod-customers" value={form.customerName} onChange={e => {
                const name = e.target.value;
                const match = customers.find(c => c.name === name);
                setForm(prev => ({ ...prev, customerName: name, customerPhone: match?.phone || prev.customerPhone }));
              }} />
              <datalist id="custom-prod-customers">
                {customers.map(c => <option key={c.id} value={c.name} />)}
              </datalist>
            </div>
            <Input label="Telefone" value={form.customerPhone} onChange={e => setForm(prev => ({ ...prev, customerPhone: e.target.value }))} />
          </div>
          <Input label="Item sob medida *" placeholder="Ex.: Sofá em L" value={form.itemName} onChange={e => setForm(prev => ({ ...prev, itemName: e.target.value }))} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Medidas" placeholder="Ex.: 3,20 x 1,80 m" value={form.measures} onChange={e => setForm(prev => ({ ...prev, measures: e.target.value }))} />
            <Input label="Material" placeholder="Ex.: Linho cinza" value={form.material} onChange={e => setForm(prev => ({ ...prev, material: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Descrição</label>
            <textarea className="w-full border rounded-lg p-2 dark:bg-slate-700 dark:border-slate-600 dark:text-white" rows={3} value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input label="Prazo" type="date" value={form.deadline} onChange={e => setForm(prev => ({ ...prev, deadline: e.target.value }))} />
            <Input label="Valor total (R$)" inputMode="decimal" value={form.totalValue} onChange={e => setForm(prev => ({ ...prev, totalValue: e.target.value }))} />
            <Input label="Sinal pago (R$)" inputMode="decimal" value={form.downPayment} onChange={e => setForm(prev => ({ ...prev, downPayment: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Fotos e anexos</label>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setFiles(Array.from(e.target.files || []))} className="text-sm" />
            {files.length > 0 && <p className="text-xs text-slate-500 mt-1">{files.length} arquivo(s) selecionado(s)</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 size={16} className="animate-spin" />} Salvar pedido
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

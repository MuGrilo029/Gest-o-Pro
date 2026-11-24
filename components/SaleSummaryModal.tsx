import React from 'react';
import { Sale, Transaction } from '../types';
import { Modal, Badge, Button } from './UI';
import { DollarSign, Receipt, Edit, Phone, MapPin, Calendar, Truck, Store } from 'lucide-react';

interface SaleSummaryModalProps {
  sale: Sale | null;
  isOpen: boolean;
  onClose: () => void;
  transactions?: Transaction[];
  onPrintReceipt?: (sale: Sale, transaction: Transaction) => void;
  onEditSale?: (sale: Sale) => void;
}

export const SaleSummaryModal: React.FC<SaleSummaryModalProps> = ({
  sale,
  isOpen,
  onClose,
  transactions = [],
  onPrintReceipt,
  onEditSale,
}) => {
  if (!sale) return null;

  const saleTransactions = transactions.filter(
    t => t.type === 'INCOME' && (
      t.saleId === sale.id ||
      (t.description && t.description.includes(`Venda #${sale.id.slice(0, 4)}`))
    )
  );

  const paidTransactions = saleTransactions.filter(t => t.status === 'PAID');
  const paidTotal = paidTransactions.reduce((acc, current) => acc + current.amount, 0);
  const remainingTotal = Math.max(0, sale.total - paidTotal);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Resumo da Venda #${sale.id.slice(0, 8)}`}>
      <div className="space-y-6">
        {/* Dados do Cliente e Pedido */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase text-slate-400">Cliente</p>
            <p className="font-bold text-slate-800 dark:text-white text-base">{sale.customerName}</p>
            {sale.customerPhone && (
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Phone size={13} className="text-wine-600 dark:text-wine-400" />
                {sale.customerPhone}
              </p>
            )}
            {sale.customerAddress && (
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-start gap-1.5 mt-1">
                <MapPin size={13} className="text-wine-600 dark:text-wine-400 shrink-0 mt-0.5" />
                <span>{sale.customerAddress}</span>
              </p>
            )}
          </div>

          <div className="space-y-1 sm:text-right">
            <div className="flex sm:justify-end gap-2 items-center">
              <Badge color={sale.status === 'COMPLETED' ? 'green' : 'red'}>
                {sale.status === 'COMPLETED' ? 'CONCLUÍDA' : 'CANCELADA'}
              </Badge>
              <Badge color={sale.deliveryType === 'DELIVERY' ? 'blue' : 'gray'}>
                {sale.deliveryType === 'DELIVERY' ? 'Entrega em Domicílio' : 'Retirada'}
              </Badge>
            </div>
            <p className="text-[10px] font-black uppercase text-slate-400 mt-2">Data da Venda</p>
            <p className="font-bold text-slate-800 dark:text-white text-xs">
              {new Date(sale.date).toLocaleString()}
            </p>
            {sale.deliveryDate && (
              <p className="text-xs text-slate-500 dark:text-slate-400 flex sm:justify-end items-center gap-1.5 mt-1">
                <Calendar size={13} className="text-wine-600 dark:text-wine-400" />
                Previsto: {new Date(sale.deliveryDate).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        {/* Tabela de Itens */}
        <div>
          <h4 className="text-[10px] font-black uppercase text-wine-900 dark:text-wine-300 mb-2">
            Itens do Pedido ({sale.items?.length || 0})
          </h4>
          <div className="border border-slate-100 dark:border-slate-700 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                <tr>
                  <th className="p-3 text-left">Qtd</th>
                  <th className="p-3 text-left">Produto</th>
                  <th className="p-3 text-right">Unit.</th>
                  <th className="p-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                {sale.items?.map((item, i) => (
                  <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="p-3 font-bold">{item.quantity}x</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-800 dark:text-white">{item.productName}</div>
                      {item.description && (
                        <div className="text-[10px] text-slate-500 italic leading-tight mt-0.5">{item.description}</div>
                      )}
                    </td>
                    <td className="p-3 text-right text-slate-600 dark:text-slate-300">
                      R$ {item.unitPrice.toFixed(2)}
                    </td>
                    <td className="p-3 text-right font-bold text-slate-800 dark:text-white">
                      R$ {(item.quantity * item.unitPrice).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Resumo Financeiro e Histórico de Pagamentos */}
        <div className="bg-wine-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-3 border border-wine-100 dark:border-slate-700">
          <div className="flex justify-between items-center mb-2 border-b border-wine-100 dark:border-slate-700 pb-2">
            <h4 className="text-[10px] font-black uppercase text-wine-900 dark:text-wine-200">
              Histórico de Pagamentos
            </h4>
            <div className="text-xs text-slate-600 dark:text-slate-300">
              {sale.paymentType === 'PARTIAL' ? 'Pagamento Parcial' : 'Pagamento Integral'}
            </div>
          </div>

          <div className="space-y-2">
            {saleTransactions.length === 0 ? (
              <p className="text-xs text-slate-500 italic text-center py-2">
                Nenhum lançamento financeiro vinculado localizado.
              </p>
            ) : (
              saleTransactions
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map((t, idx) => (
                  <div
                    key={idx}
                    className="flex justify-between items-center text-xs bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-wine-50 dark:border-slate-700 shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                          t.status === 'PAID'
                            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                            : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                        }`}
                      >
                        <DollarSign size={14} />
                      </div>
                      <div>
                        <p className="font-bold dark:text-white">
                          R$ {t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                        <p className="text-[10px] text-slate-500 uppercase">
                          {new Date(t.date || t.dueDate).toLocaleDateString()} - {t.status === 'PAID' ? 'PAGO' : 'PENDENTE'}
                          {t.category ? ` • ${t.category}` : ''}
                        </p>
                      </div>
                    </div>
                    {t.status === 'PAID' && onPrintReceipt && (
                      <button
                        onClick={() => onPrintReceipt(sale, t)}
                        className="p-1.5 hover:bg-wine-50 dark:hover:bg-slate-700 rounded text-wine-600 transition-colors"
                        title="Imprimir Comprovante"
                      >
                        <Receipt size={14} />
                      </button>
                    )}
                  </div>
                ))
            )}
          </div>

          <div className="pt-3 border-t border-wine-100 dark:border-slate-700 space-y-1">
            {sale.discount > 0 && (
              <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                <span>Desconto aplicado:</span>
                <span className="font-bold text-red-500">- R$ {sale.discount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between items-end pt-1">
              <div>
                <p className="text-[10px] font-black uppercase text-wine-400">Total da Venda</p>
                <p className="text-xl font-black text-wine-900 dark:text-white">
                  R$ {sale.total.toFixed(2)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black uppercase text-amber-500">Saldo Devedor</p>
                <p className="text-xl font-black text-amber-600">
                  R$ {remainingTotal.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Observações */}
        {sale.observations && (
          <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg text-xs italic text-slate-600 dark:text-slate-400 border border-slate-100 dark:border-slate-600">
            <span className="font-bold not-italic text-[10px] uppercase block mb-1">Observações:</span>
            "{sale.observations}"
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          {onEditSale && (
            <Button
              onClick={() => {
                onClose();
                onEditSale(sale);
              }}
              className="gap-2"
            >
              <Edit size={16} /> Editar Venda
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};


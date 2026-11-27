
import React, { useState } from 'react';
import { useAppStore } from '../store';
import { Card, Button, Input, Table, Modal, EmptyState, PageHeader, formatCpfCnpj, formatPhone, alertDialog } from '../components/UI';
import { Plus, Trash2, Search, Phone, MapPin, Mail, MessageCircle } from 'lucide-react';
import { Customer } from '../types';
import { getUUID } from '../lib/utils';
import { docProblem, findDocOwner } from '../lib/documents';
import { ManagerOnly } from '../components/ManagerOnly';

export const Customers: React.FC = () => {
  const { customers, addCustomer, updateCustomer, deleteCustomer } = useAppStore();
  const docError = (doc?: string, selfId?: string): string | null => {
    const problem = docProblem(doc || '');
    if (problem) return problem;
    const owner = findDocOwner(doc || '', customers || [], selfId);
    return owner ? `Este CPF/CNPJ já está cadastrado para ${owner.name}.` : null;
  };
  const [showForm, setShowForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [formData, setFormData] = useState<Partial<Customer>>({});
  const [searchTerm, setSearchTerm] = useState('');

  const handleOpenModal = (customer?: Customer) => {
    if (customer) {
      setFormData({ ...customer });
    } else {
      setFormData({});
    }
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      alertDialog('Informe o nome do cliente.');
      return;
    }
    const problem = docError(formData.cpfCnpj, formData.id);
    if (problem) {
      alertDialog(problem);
      return;
    }

    const customerData = {
      id: formData.id || getUUID(),
      name: formData.name!,
      phone: formData.phone || '',
      cpfCnpj: formData.cpfCnpj || '',
      email: formData.email || '',
      address: formData.address || '',
      notes: formData.notes || ''
    };

    if (formData.id) {
      updateCustomer(customerData);
    } else {
      addCustomer(customerData);
    }
    setShowForm(false);
  };

  const handleConfirmDelete = () => {
    if (formData.id) {
      deleteCustomer(formData.id);
      setShowDeleteConfirm(false);
      setShowForm(false);
    }
  };

  const filteredCustomers = (customers || []).filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.cpfCnpj?.includes(searchTerm) ||
    c.phone?.includes(searchTerm)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestão de Clientes"
        subtitle="Cadastro usado nas vendas, orçamentos e entregas."
        actions={<Button onClick={() => handleOpenModal()}><Plus size={18} /> Novo Cliente</Button>}
      />

      <div className="relative">
        <Search className="absolute left-3 top-2.5 text-wine-300 dark:text-slate-400" size={20} />
        <input
          type="text"
          placeholder="Buscar cliente por nome, CPF ou telefone..."
          className="w-full pl-10 pr-4 py-2 border border-wine-200 dark:border-slate-600 rounded-lg outline-none focus:ring-2 focus:ring-wine-500 placeholder-wine-400 dark:placeholder-slate-400 text-black dark:text-white bg-wine-50 dark:bg-slate-700"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={formData.id ? "Editar Cliente" : "Cadastrar Novo Cliente"}
      >
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Input
              label="Nome Completo / Razão Social *"
              value={formData.name || ''}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              autoFocus
            />
          </div>
          <Input
            label="CPF / CNPJ"
            value={formData.cpfCnpj || ''}
            onChange={e => setFormData({ ...formData, cpfCnpj: formatCpfCnpj(e.target.value) })}
            maxLength={18}
            placeholder="000.000.000-00"
          />
          <Input
            label="Telefone / WhatsApp"
            value={formData.phone || ''}
            onChange={e => setFormData({ ...formData, phone: formatPhone(e.target.value) })}
            maxLength={15}
            placeholder="(00) 00000-0000"
          />
          <Input
            label="E-mail"
            type="email"
            value={formData.email || ''}
            onChange={e => setFormData({ ...formData, email: e.target.value })}
          />
          <Input
            label="Endereço"
            value={formData.address || ''}
            onChange={e => setFormData({ ...formData, address: e.target.value })}
          />
          <div className="md:col-span-2">
            <Input
              label="Observações"
              value={formData.notes || ''}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>

          <div className="md:col-span-2 flex justify-between items-center mt-4 pt-4 border-t border-wine-100">
            {formData.id && (
              <ManagerOnly>
              <Button type="button" variant="danger" onClick={() => setShowDeleteConfirm(true)}>
                <Trash2 size={18} /> Excluir
              </Button>
              </ManagerOnly>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit">Salvar Cliente</Button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Confirmar Exclusão"
      >
        <div className="space-y-4">
          <p className="text-wine-800 dark:text-wine-200">
            Tem certeza que deseja excluir o cliente <strong>{formData.name}</strong>?
          </p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancelar
            </Button>
            <Button type="button" variant="danger" onClick={handleConfirmDelete}>
              Confirmar Exclusão
            </Button>
          </div>
        </div>
      </Modal>

      <Card>
        <Table headers={['Nome', 'CPF/CNPJ', 'Contato', 'Endereço', 'Ações']}>
          {filteredCustomers.map(c => (
            <tr
              key={c.id}
              className="hover:bg-wine-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer text-wine-900 dark:text-slate-100"
              tabIndex={0}
              onClick={() => handleOpenModal(c)}
              onKeyDown={e => { if (e.key === 'Enter') handleOpenModal(c); }}
            >
              <td className="py-3 px-4 font-medium">{c.name}</td>
              <td className="py-3 px-4 text-wine-500 dark:text-slate-400">{c.cpfCnpj || '-'}</td>
              <td className="py-3 px-4">
                <div className="flex flex-col text-sm">
                  {c.phone && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1"><Phone size={12} /> {c.phone}</span>
                      <a
                        href={`https://wa.me/55${c.phone.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-500 hover:text-emerald-600 p-1"
                        onClick={(e) => e.stopPropagation()}
                        title="Abrir WhatsApp"
                      >
                        <MessageCircle size={16} />
                      </a>
                    </div>
                  )}
                  {c.email && <span className="flex items-center gap-1 text-wine-400"><Mail size={12} /> {c.email}</span>}
                </div>
              </td>
              <td className="py-3 px-4 text-sm text-wine-500 dark:text-slate-400 truncate max-w-[200px]">
                {c.address && <span className="flex items-center gap-1"><MapPin size={12} /> {c.address}</span>}
              </td>
              <td className="py-3 px-4">
                <button className="text-wine-500 hover:text-wine-700 dark:text-slate-300 dark:hover:text-white p-1" aria-label={`Editar ${c.name}`}>Editar</button>
              </td>
            </tr>
          ))}
          {filteredCustomers.length === 0 && (
            <tr>
              <td colSpan={5}>
                {searchTerm ? (
                  <EmptyState
                    title="Nenhum cliente encontrado"
                    description={`Nada corresponde a "${searchTerm}". Confira o nome, CPF ou telefone.`}
                    actionLabel="Limpar busca"
                    onAction={() => setSearchTerm('')}
                  />
                ) : (
                  <EmptyState
                    title="Nenhum cliente cadastrado"
                    description="Cadastre o primeiro cliente para usar nas vendas e orçamentos."
                    actionLabel="Novo cliente"
                    onAction={() => handleOpenModal()}
                  />
                )}
              </td>
            </tr>
          )}
        </Table>
      </Card>
    </div>
  );
};

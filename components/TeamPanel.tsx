import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, Plus, Check, KeyRound } from 'lucide-react';
import { Card, Button, Input, Select, Badge } from './UI';
import { useAppStore } from '../store';
import { useStore, StoreMember } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { AppView } from '../types';
import { TempPasswordNotice } from './TempPasswordNotice';
import { passwordProblem } from '../lib/utils';
import { MODULES, ROLE_LABELS, SELLER_ASSIGNABLE_VIEWS, SELLER_DEFAULT_VIEWS, StoreRole } from '../lib/modules';

const ROLE_HELP: Record<StoreRole, string> = {
  OWNER: 'Acesso a todas as telas da loja e cadastra vendedores. Não cria lojas nem mexe em módulos.',
  MANAGER: 'Mesmo acesso do dono dentro da loja.',
  SELLER: 'Vê só as próprias vendas e orçamentos e as telas marcadas.',
};

/** Caixas de seleção das telas liberadas para um vendedor. */
const PermissionPicker: React.FC<{
  value: AppView[];
  onChange: (v: AppView[]) => void;
  isViewAvailable: (v: AppView) => boolean;
}> = ({ value, onChange, isViewAvailable }) => {
  const toggle = (view: AppView) =>
    onChange(value.includes(view) ? value.filter(v => v !== view) : [...value, view]);
  return (
    <fieldset>
      <legend className="text-xs font-semibold text-wine-700 dark:text-slate-300 uppercase mb-2">
        Telas liberadas para o vendedor
      </legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SELLER_ASSIGNABLE_VIEWS.map(v => {
          const available = isViewAvailable(v.view);
          return (
            <label
              key={v.view}
              className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 border border-wine-100 dark:border-slate-700 ${available ? 'cursor-pointer text-wine-900 dark:text-slate-200' : 'opacity-50 cursor-not-allowed text-wine-500'}`}
              title={available ? undefined : 'Módulo desligado nesta loja'}
            >
              <input
                type="checkbox"
                checked={value.includes(v.view)}
                disabled={!available}
                onChange={() => toggle(v.view)}
                className="accent-wine-700"
              />
              {v.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};

/**
 * Equipe da loja ativa.
 * - Administrador da plataforma: cria qualquer papel e troca qualquer senha.
 * - Dono/gerente: cria, edita, troca senha e remove apenas vendedores.
 */
export const TeamPanel: React.FC = () => {
  const { addNotification } = useAppStore();
  const { user } = useAuth();
  const {
    legacyMode, activeStore, isPlatformAdmin, moduleStates,
    listMembers, createMember, setMemberPassword, updateMember, removeMember,
  } = useStore();

  const assignableRoles: StoreRole[] = isPlatformAdmin ? ['SELLER', 'MANAGER', 'OWNER'] : ['SELLER'];
  const canManage = (m: StoreMember) => isPlatformAdmin || m.role === 'SELLER';

  const [members, setMembers] = useState<StoreMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: assignableRoles[0] as StoreRole });
  const [formPermissions, setFormPermissions] = useState<AppView[]>(SELLER_DEFAULT_VIEWS);
  const [editing, setEditing] = useState<StoreMember | null>(null);
  const [passwordFor, setPasswordFor] = useState<{ userId: string; value: string } | null>(null);
  const [tempCred, setTempCred] = useState<{ email: string; password: string } | null>(null);

  const isViewAvailable = (view: AppView) => {
    const mod = MODULES.find(m => m.views.some(v => v.view === view));
    return !mod || moduleStates[mod.key];
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await listMembers());
    } catch (err: any) {
      addNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [listMembers]);

  useEffect(() => { refresh(); }, [activeStore?.id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const pwdIssue = passwordProblem(form.password);
      if (pwdIssue) throw new Error(pwdIssue);
      const { existingAccount, temporaryPassword } = await createMember({ ...form, permissions: formPermissions });
      if (temporaryPassword) setTempCred({ email: form.email, password: temporaryPassword });
      addNotification(
        existingAccount
          ? `${form.email} já tinha conta e foi adicionado à loja. A senha dele não mudou.`
          : `Acesso criado para ${form.email}.`,
        'success'
      );
      setForm({ name: '', email: '', password: '', role: assignableRoles[0] });
      setFormPermissions(SELLER_DEFAULT_VIEWS);
      refresh();
    } catch (err: any) {
      addNotification(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    try {
      await updateMember(editing.userId, editing.role, editing.role === 'SELLER' ? editing.permissions : []);
      addNotification('Permissões atualizadas.', 'success');
      setEditing(null);
      refresh();
    } catch (err: any) {
      addNotification(err.message, 'error');
    }
  };

  const handleSavePassword = async () => {
    if (!passwordFor) return;
    try {
      const pwdIssue = passwordProblem(passwordFor.value);
      if (pwdIssue) throw new Error(pwdIssue);
      const temp = await setMemberPassword(passwordFor.userId, passwordFor.value);
      if (temp) {
        const who = members.find(x => x.userId === passwordFor.userId);
        setTempCred({ email: who?.email || '', password: temp });
      }
      addNotification('Senha alterada.', 'success');
      setPasswordFor(null);
    } catch (err: any) {
      addNotification(err.message, 'error');
    }
  };

  const handleRemove = async (m: StoreMember) => {
    if (!window.confirm(`Remover ${m.email} desta loja? A pessoa perde o acesso a ela.`)) return;
    try {
      await removeMember(m.userId);
      addNotification(`${m.email} removido.`, 'success');
      refresh();
    } catch (err: any) {
      addNotification(err.message, 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <Card title={`Pessoas em ${activeStore?.name ?? 'esta loja'}`} className="xl:col-span-2">
        {loading ? (
          <p className="text-sm text-wine-500">Carregando...</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-wine-500">{legacyMode ? 'Disponível após a migração multi-loja.' : 'Ninguém na equipe ainda.'}</p>
        ) : (
          <ul className="divide-y divide-wine-50 dark:divide-slate-700">
            {members.map(m => (
              <li key={m.userId} className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-wine-950 dark:text-white truncate">
                      {m.name}{m.userId === user?.id && ' (você)'}
                    </p>
                    <p className="text-sm text-wine-600 dark:text-slate-400 truncate">{m.email}</p>
                    <div className="mt-1 flex flex-wrap gap-1 items-center">
                      <Badge color={m.role === 'OWNER' ? 'red' : m.role === 'MANAGER' ? 'blue' : 'green'}>{ROLE_LABELS[m.role]}</Badge>
                      {m.role === 'SELLER' && (
                        <span className="text-xs text-wine-500 dark:text-slate-400">
                          {(m.permissions.length ? m.permissions : SELLER_DEFAULT_VIEWS)
                            .map(v => SELLER_ASSIGNABLE_VIEWS.find(x => x.view === v)?.label)
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>
                  {canManage(m) && (
                    <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                      <Button variant="outline" onClick={() => { setPasswordFor(null); setEditing({ ...m, permissions: m.permissions.length ? m.permissions : SELLER_DEFAULT_VIEWS }); }}>
                        Editar
                      </Button>
                      <Button variant="outline" onClick={() => { setEditing(null); setPasswordFor({ userId: m.userId, value: '' }); }} aria-label={`Trocar senha de ${m.email}`}>
                        <KeyRound size={16} />
                      </Button>
                      <Button variant="danger" onClick={() => handleRemove(m)} aria-label={`Remover ${m.email}`}>
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  )}
                </div>

                {editing?.userId === m.userId && (
                  <div className="mt-4 p-4 rounded-xl bg-wine-50/60 dark:bg-slate-900/40 space-y-4">
                    {isPlatformAdmin && (
                      <>
                        <Select label="Papel" value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value as StoreRole })}>
                          {assignableRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </Select>
                        <p className="text-xs text-wine-600 dark:text-slate-400">{ROLE_HELP[editing.role]}</p>
                      </>
                    )}
                    {editing.role === 'SELLER' && (
                      <PermissionPicker
                        value={editing.permissions}
                        onChange={permissions => setEditing({ ...editing, permissions })}
                        isViewAvailable={isViewAvailable}
                      />
                    )}
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
                      <Button onClick={handleSaveEdit}><Check size={16} /> Salvar</Button>
                    </div>
                  </div>
                )}

                {passwordFor?.userId === m.userId && (
                  <div className="mt-4 p-4 rounded-xl bg-wine-50/60 dark:bg-slate-900/40 space-y-3">
                    <Input
                      label="Nova senha (10+ caracteres com letras e números; vazio = gerar uma provisória)"
                      type="password"
                      autoComplete="new-password"
                      value={passwordFor.value}
                      onChange={e => setPasswordFor({ ...passwordFor, value: e.target.value })}
                    />
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" onClick={() => setPasswordFor(null)}>Cancelar</Button>
                      <Button onClick={handleSavePassword}>
                        <Check size={16} /> Salvar senha
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {tempCred && <TempPasswordNotice email={tempCred.email} password={tempCred.password} onClose={() => setTempCred(null)} />}

      <Card title={isPlatformAdmin ? 'Criar acesso' : 'Criar acesso de vendedor'}>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Nome" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} disabled={legacyMode} />
          <Input
            label="E-mail"
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            required
            disabled={legacyMode}
          />
          <Input
            label="Senha (10+ caracteres com letras e números; vazio = gerar uma provisória)"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            disabled={legacyMode}
          />
          <p className="text-xs text-wine-500 dark:text-slate-400 -mt-2">
            A pessoa entra com esse e-mail e essa senha. Se o e-mail já tiver conta, ela só é adicionada à loja e a senha não muda.
          </p>
          {assignableRoles.length > 1 && (
            <Select label="Papel" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as StoreRole })} disabled={legacyMode}>
              {assignableRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          )}
          <p className="text-xs text-wine-600 dark:text-slate-400">{ROLE_HELP[form.role]}</p>
          {form.role === 'SELLER' && (
            <PermissionPicker value={formPermissions} onChange={setFormPermissions} isViewAvailable={isViewAvailable} />
          )}
          <Button type="submit" className="w-full" disabled={legacyMode || saving || !form.email.trim()}>
            <Plus size={16} /> {saving ? 'Criando...' : 'Criar acesso'}
          </Button>
        </form>
      </Card>
    </div>
  );
};

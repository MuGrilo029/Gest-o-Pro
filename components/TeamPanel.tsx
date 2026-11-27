import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, Plus, Check, KeyRound } from 'lucide-react';
import { Card, Button, Input, Select, Badge, confirmDialog } from './UI';
import { useAppStore } from '../store';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { AppView } from '../types';
import { TempPasswordNotice } from './TempPasswordNotice';
import { DEFAULT_TEMP_PASSWORD, PASSWORD_RULE_LABEL, passwordProblem } from '../lib/utils';
import { MODULES, ROLE_LABELS, SELLER_ASSIGNABLE_VIEWS, SELLER_DEFAULT_VIEWS, StoreRole } from '../lib/modules';
import {
  StoreMember, countSellers, createStoreMember, listStoreMembers, maskEmail,
  removeStoreMember, setStoreMemberPassword, updateStoreMember,
} from '../lib/teamApi';
import { planForLimits, planSellersLabel } from '../lib/plans';

const ROLE_HELP: Record<StoreRole, string> = {
  OWNER: 'Acesso a todas as telas da loja e cadastra vendedores. Não cria lojas nem mexe em módulos.',
  MANAGER: 'Mesmo acesso do dono dentro da loja.',
  SELLER: 'Vê só as próprias vendas e orçamentos e as telas marcadas.',
};

const PASSWORD_HINT = `${PASSWORD_RULE_LABEL}; vazio = provisória ${DEFAULT_TEMP_PASSWORD}`;

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
 * Equipe de uma loja.
 * - Sem `store`: loja ativa (tela Equipe). Com `store`: qualquer loja (painel admin), sem trocar a loja ativa.
 * - Administrador da plataforma: cria qualquer papel e troca qualquer senha.
 * - Dono/gerente: cria, edita, troca senha e remove apenas vendedores.
 * - Limite de vendedores do plano (decisão 4): ao atingir o limite, criar vendedor fica bloqueado.
 * - E-mail: completo só para o admin; para os demais fica mascarado também em aria-labels e avisos.
 */
export const TeamPanel: React.FC<{
  store?: { id: string; name: string; plan: string | null };
  /** Chamado depois de criar ou remover alguém (o painel admin atualiza a contagem). */
  onChanged?: () => void;
}> = ({ store, onChanged }) => {
  const { addNotification } = useAppStore();
  const { user } = useAuth();
  const { legacyMode: ctxLegacy, activeStore, isPlatformAdmin, moduleStates: ctxModules, subscription, reload } = useStore();

  const legacyMode = store ? false : ctxLegacy;
  const storeId = store?.id ?? activeStore?.id ?? null;
  const storeName = store?.name ?? activeStore?.name ?? 'esta loja';
  const limitPlan = planForLimits(store ? store.plan : subscription?.plan ?? null);
  const sellerLimit = limitPlan?.maxSellers ?? null;
  // No painel admin os módulos da outra loja não estão carregados: todas as telas ficam disponíveis.
  const moduleStates = store ? null : ctxModules;

  const assignableRoles: StoreRole[] = isPlatformAdmin ? ['SELLER', 'MANAGER', 'OWNER'] : ['SELLER'];
  const canManage = (m: StoreMember) => isPlatformAdmin || m.role === 'SELLER';

  /** E-mail de outra pessoa como aparece na tela. */
  const shownEmail = (email: string) => (isPlatformAdmin ? email : maskEmail(email));
  /** Identificação em avisos e aria-labels: sem e-mail completo para quem não é admin. */
  const who = (m: StoreMember) => (isPlatformAdmin ? m.email : (m.name?.trim() || maskEmail(m.email)));

  const [members, setMembers] = useState<StoreMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: assignableRoles[0] as StoreRole });
  const [formPermissions, setFormPermissions] = useState<AppView[]>(SELLER_DEFAULT_VIEWS);
  const [editing, setEditing] = useState<StoreMember | null>(null);
  const [passwordFor, setPasswordFor] = useState<{ userId: string; value: string } | null>(null);
  const [tempCred, setTempCred] = useState<{ email: string; password: string } | null>(null);

  const sellers = countSellers(members);
  const sellerLimitReached = sellerLimit !== null && sellers >= sellerLimit;
  const creatingSellerBlocked = form.role === 'SELLER' && sellerLimitReached;
  const limitMessage = `Limite de ${sellerLimit} vendedor(es) do plano ${limitPlan?.name ?? ''} atingido. Remova um vendedor ou troque de plano para criar outro.`;

  const requireStoreId = () => {
    if (legacyMode) throw new Error('Aplique a migração multi-loja para gerenciar a equipe.');
    if (!storeId) throw new Error('Nenhuma loja selecionada.');
    return storeId;
  };
  const afterSelfChange = async (userId: string) => { if (!store && userId === user?.id) await reload(); };

  const isViewAvailable = (view: AppView) => {
    if (!moduleStates) return true;
    const mod = MODULES.find(m => m.views.some(v => v.view === view));
    return !mod || moduleStates[mod.key];
  };

  const refresh = useCallback(async () => {
    if (legacyMode || !storeId) { setMembers([]); return; }
    setLoading(true);
    try {
      setMembers(await listStoreMembers(storeId));
    } catch (err: any) {
      addNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [storeId, legacyMode]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (creatingSellerBlocked) throw new Error(limitMessage);
      const pwdIssue = passwordProblem(form.password);
      if (pwdIssue) throw new Error(pwdIssue);
      const password = form.password || DEFAULT_TEMP_PASSWORD;
      const { existingAccount, temporaryPassword } = await createStoreMember(requireStoreId(), { ...form, password, permissions: formPermissions });
      if (!existingAccount) {
        const temp = temporaryPassword || (form.password ? null : DEFAULT_TEMP_PASSWORD);
        if (temp) setTempCred({ email: form.email, password: temp });
      }
      const label = form.name.trim() || shownEmail(form.email.trim());
      addNotification(
        existingAccount
          ? `${label} já tinha conta e foi adicionado(a) à loja. A senha não mudou.`
          : `Acesso criado para ${label}.`,
        'success'
      );
      setForm({ name: '', email: '', password: '', role: assignableRoles[0] });
      setFormPermissions(SELLER_DEFAULT_VIEWS);
      await refresh();
      onChanged?.();
    } catch (err: any) {
      addNotification(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    try {
      if (editing.role === 'SELLER' && sellerLimitReached && members.find(m => m.userId === editing.userId)?.role !== 'SELLER') {
        throw new Error(limitMessage);
      }
      await updateStoreMember(requireStoreId(), editing.userId, editing.role, editing.role === 'SELLER' ? editing.permissions : []);
      await afterSelfChange(editing.userId);
      addNotification('Permissões atualizadas.', 'success');
      setEditing(null);
      await refresh();
      onChanged?.();
    } catch (err: any) {
      addNotification(err.message, 'error');
    }
  };

  const handleSavePassword = async () => {
    if (!passwordFor) return;
    try {
      const pwdIssue = passwordProblem(passwordFor.value);
      if (pwdIssue) throw new Error(pwdIssue);
      const value = passwordFor.value || DEFAULT_TEMP_PASSWORD;
      const generated = await setStoreMemberPassword(requireStoreId(), passwordFor.userId, value);
      const temp = generated || (passwordFor.value ? null : DEFAULT_TEMP_PASSWORD);
      if (temp) {
        const target = members.find(x => x.userId === passwordFor.userId);
        setTempCred({ email: target ? shownEmail(target.email) : '', password: temp });
      }
      addNotification('Senha alterada.', 'success');
      setPasswordFor(null);
    } catch (err: any) {
      addNotification(err.message, 'error');
    }
  };

  const handleRemove = async (m: StoreMember) => {
    if (!(await confirmDialog(`Remover ${who(m)} desta loja? A pessoa perde o acesso a ela.`))) return;
    try {
      await removeStoreMember(requireStoreId(), m.userId);
      await afterSelfChange(m.userId);
      addNotification(`${who(m)} removido(a).`, 'success');
      await refresh();
      onChanged?.();
    } catch (err: any) {
      addNotification(err.message, 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <Card title={`Pessoas em ${storeName}`} className="xl:col-span-2">
        {sellerLimit !== null && limitPlan && !loading && (
          <p
            role="status"
            data-testid="seller-count"
            className={`text-sm mb-3 ${sellerLimitReached ? 'text-amber-700 dark:text-amber-400 font-semibold' : 'text-wine-600 dark:text-slate-400'}`}
          >
            Vendedores: {sellers} de {sellerLimit} (plano {limitPlan.name}: {planSellersLabel(limitPlan).toLowerCase()}).
            {sellerLimitReached && ' Limite atingido: novos vendedores ficam bloqueados.'}
          </p>
        )}
        {loading ? (
          <p className="text-sm text-wine-500">Carregando...</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-wine-500">{legacyMode ? 'Disponível após a migração multi-loja.' : 'Ninguém na equipe ainda.'}</p>
        ) : (
          <ul className="divide-y divide-wine-50 dark:divide-slate-700">
            {members.map(m => (
              <li key={m.userId} className="py-4" data-testid="team-member" data-role={m.role}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-wine-950 dark:text-white truncate">
                      {m.name}{m.userId === user?.id && ' (você)'}
                    </p>
                    <p className="text-sm text-wine-600 dark:text-slate-400 truncate">{shownEmail(m.email)}</p>
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
                      <Button variant="outline" onClick={() => { setEditing(null); setPasswordFor({ userId: m.userId, value: '' }); }} aria-label={`Trocar senha de ${who(m)}`}>
                        <KeyRound size={16} />
                      </Button>
                      <Button variant="danger" onClick={() => handleRemove(m)} aria-label={`Remover ${who(m)}`}>
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
                      label={`Nova senha (${PASSWORD_HINT})`}
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
            label={`Senha (${PASSWORD_HINT})`}
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            disabled={legacyMode}
          />
          <p className="text-xs text-wine-500 dark:text-slate-400 -mt-2">
            A pessoa entra com esse e-mail e essa senha e troca depois. Se o e-mail já tiver conta, ela só é adicionada à loja e a senha não muda.
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
          {creatingSellerBlocked && (
            <p role="alert" className="text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 rounded-lg p-3">
              {limitMessage}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={legacyMode || saving || !form.email.trim() || creatingSellerBlocked}>
            <Plus size={16} /> {saving ? 'Criando...' : 'Criar acesso'}
          </Button>
        </form>
      </Card>
    </div>
  );
};

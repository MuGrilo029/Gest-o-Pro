import React, { useState } from 'react';
import { useStore } from '../contexts/StoreContext';

/**
 * Cadastro de loja pelo admin (admin-plano/03-produto-ux.md, seção 4).
 * Loja nova começa em teste de 1 hora ou sem assinatura. Não existe "ativa" direta:
 * assinatura só ativa pelo webhook do Asaas. Plano e módulos vêm do servidor.
 */
export const LojaCadastroForm: React.FC<{ onCreated: () => void; onCancel: () => void }> = ({ onCreated, onCancel }) => {
  const { adminCreateClient } = useStore();
  const [storeName, setStoreName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState('inicio');
  const [mode, setMode] = useState<'trial' | 'nosub'>('trial');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const valid = storeName.trim().length >= 2 && ownerName.trim().length >= 2 && emailOk;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) { setError('Preencha nome da loja, nome do dono e um e-mail válido.'); return; }
    setBusy(true);
    setError(null);
    try {
      await adminCreateClient({
        email,
        storeName,
        ownerName,
        modules: [],
        plan,
        mode: mode === 'trial' ? 'trial' : 'paid',
        hours: mode === 'trial' ? 1 : undefined,
      });
      onCreated();
    } catch {
      setError('Não foi possível cadastrar a loja. Nada foi criado.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'mt-1 w-full rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2 text-sm bg-transparent';

  return (
    <form onSubmit={submit} className="space-y-3 text-sm" noValidate>
      <label className="block">Nome da loja *<input className={input} value={storeName} onChange={e => setStoreName(e.target.value)} /></label>
      <label className="block">Nome do dono *<input className={input} value={ownerName} onChange={e => setOwnerName(e.target.value)} /></label>
      <label className="block">E-mail do dono *<input type="email" className={input} value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="block">Plano
        <select className={input} value={plan} onChange={e => setPlan(e.target.value)}>
          <option value="inicio">Início</option>
          <option value="crescimento">Crescimento</option>
          <option value="avancado">Avançado</option>
        </select>
      </label>
      <fieldset className="space-y-1">
        <legend className="font-medium">Início</legend>
        <label className="flex gap-2"><input type="radio" name="modo" checked={mode === 'trial'} onChange={() => setMode('trial')} /> Teste de 1 hora</label>
        <label className="flex gap-2"><input type="radio" name="modo" checked={mode === 'nosub'} onChange={() => setMode('nosub')} /> Sem assinatura (enviar link depois)</label>
      </fieldset>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={busy || !valid} className="flex-1 py-2 rounded-lg bg-wine-900 text-white font-semibold disabled:opacity-50">Cadastrar loja</button>
        <button type="button" onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-lg border border-wine-200">Cancelar</button>
      </div>
    </form>
  );
};

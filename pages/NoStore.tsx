import React, { useState } from 'react';
import { Store, LogOut, RefreshCcw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';
import { MODULES } from '../lib/modules';

/**
 * Tela para quem entrou mas ainda não participa de nenhuma loja.
 * O administrador da plataforma cria a primeira loja aqui; os demais
 * esperam ser adicionados por um dono ou gerente.
 */
export const NoStore: React.FC = () => {
  const { user, signOut } = useAuth();
  const { isPlatformAdmin, createStore, reload } = useStore();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await createStore(name, MODULES.filter(m => !m.core && m.defaultEnabled).map(m => m.key));
    } catch (err: any) {
      setError(err.message || 'Não foi possível criar a loja.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-wine-50 dark:bg-slate-900 px-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-wine-100 dark:border-slate-700 p-8">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-wine-50 dark:bg-slate-700 flex items-center justify-center text-wine-700 dark:text-wine-300">
          <Store size={32} />
        </div>

        {isPlatformAdmin ? (
          <>
            <h1 className="text-2xl font-bold text-center text-wine-950 dark:text-white mb-2">Crie sua primeira loja</h1>
            <p className="text-center text-wine-600 dark:text-slate-400 mb-6">
              Depois você liga e desliga módulos e adiciona a equipe em "Administração (Lojas)".
            </p>
            <form onSubmit={handleCreate} className="space-y-4">
              <label className="block">
                <span className="block text-xs font-semibold text-wine-700 dark:text-slate-300 uppercase mb-1">Nome da loja</span>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  autoFocus
                  className="w-full px-4 py-3 rounded-lg border border-wine-200 dark:border-slate-600 bg-wine-50/50 dark:bg-slate-700 text-wine-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-wine-500"
                />
              </label>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="w-full py-3 rounded-lg bg-wine-900 text-white font-semibold hover:bg-wine-800 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Criando...' : 'Criar loja'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-center text-wine-950 dark:text-white mb-2">Você ainda não está em uma loja</h1>
            <p className="text-center text-wine-600 dark:text-slate-400 mb-6">
              Peça ao dono ou gerente da loja para adicionar o e-mail{' '}
              <strong className="text-wine-900 dark:text-white">{user?.email}</strong> na equipe.
              Depois, toque em "Verificar de novo".
            </p>
            <button
              onClick={() => reload()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-wine-900 text-white font-semibold hover:bg-wine-800 transition-colors"
            >
              <RefreshCcw size={18} /> Verificar de novo
            </button>
          </>
        )}

        <button
          onClick={() => signOut()}
          className="mt-4 w-full flex items-center justify-center gap-2 py-2 text-sm text-wine-600 dark:text-slate-400 hover:text-red-600 transition-colors"
        >
          <LogOut size={16} /> Sair
        </button>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { Loader2, Lock, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SelfSignup } from './SelfSignup';

/**
 * Tela de entrada nova (rota #novo-login). A tela antiga (Login) continua como padrão.
 * "Criar conta" abre o cadastro público: loja própria com teste grátis de 1 hora.
 */
export const NovoLogin: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mode === 'signup') {
    return (
      <div className="min-h-screen bg-wine-50 dark:bg-slate-900 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          <SelfSignup onBack={() => setMode('login')} />
        </div>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError('E-mail ou senha incorretos.');
  };

  return (
    <div className="min-h-screen bg-wine-50 dark:bg-slate-900 flex items-center justify-center px-4">
      <main className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-wine-100 dark:border-slate-700 p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-wine-950 dark:text-white">Entrar</h1>
        <p className="text-sm text-wine-600 dark:text-slate-400 mt-1 mb-6">Acesse a sua loja.</p>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <label className="block">
            <span className="text-sm font-medium text-wine-800 dark:text-slate-200">E-mail</span>
            <span className="mt-1 flex items-center gap-2 rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2.5 focus-within:ring-2 focus-within:ring-wine-400">
              <Mail size={16} className="text-wine-500" aria-hidden="true" />
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-transparent outline-none text-wine-950 dark:text-white"
              />
            </span>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-wine-800 dark:text-slate-200">Senha</span>
            <span className="mt-1 flex items-center gap-2 rounded-lg border border-wine-200 dark:border-slate-600 px-3 py-2.5 focus-within:ring-2 focus-within:ring-wine-400">
              <Lock size={16} className="text-wine-500" aria-hidden="true" />
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-transparent outline-none text-wine-950 dark:text-white"
              />
            </span>
          </label>

          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-lg bg-wine-900 text-white font-semibold hover:bg-wine-800 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />} Entrar
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-wine-100 dark:border-slate-700 text-center">
          <p className="text-sm text-wine-600 dark:text-slate-400 mb-3">Ainda não tem loja?</p>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className="w-full py-3 rounded-lg border border-wine-900 text-wine-900 dark:text-white dark:border-white font-semibold hover:bg-wine-50 dark:hover:bg-slate-700"
          >
            Criar conta e testar grátis por 1 hora
          </button>
        </div>
      </main>
    </div>
  );
};

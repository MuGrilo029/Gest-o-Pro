import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Lock, Mail, Loader2, AlertCircle } from 'lucide-react';
import { SelfSignup, PENDING_TRIAL_KEY } from './SelfSignup';
import { PENDING_TERMS_KEY, recordTermsAcceptance } from '../lib/legal';

/**
 * Tela de acesso.
 * Autenticação segura por e-mail e senha, com semântica de formulário
 * para suporte total ao salvamento de senhas do navegador (Chrome, Edge, etc).
 */
export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Abre direto no cadastro quando o link vier com #cadastro (CTAs da página de vendas)
  const [mode, setMode] = useState<'login' | 'signup'>(() =>
    typeof window !== 'undefined' && window.location.hash === '#cadastro' ? 'signup' : 'login'
  );

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        throw new Error(
          error.message === 'Invalid login credentials'
            ? 'E-mail ou senha incorretos.'
            : error.message
        );
      }

      // Cadastro que aguardava confirmação de e-mail: o teste de 1 hora começa agora
      // Aceite dos Termos feito no cadastro, gravado agora que há sessão (decisão 47).
      const pendingTerms = localStorage.getItem(PENDING_TERMS_KEY);
      if (pendingTerms) {
        await recordTermsAcceptance(pendingTerms);
        localStorage.removeItem(PENDING_TERMS_KEY);
      }

      const pendingStore = localStorage.getItem(PENDING_TRIAL_KEY);
      if (pendingStore) {
        const { error: rpcError } = await supabase.rpc('start_self_trial', { p_name: pendingStore });
        if (rpcError) throw new Error(rpcError.message);
        localStorage.removeItem(PENDING_TRIAL_KEY);
        window.location.reload();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'signup') {
    return (
      <SelfSignup
        onBack={() => {
          window.location.hash = '';
          setMode('login');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4 py-8">
      <div className="max-w-md w-full bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <Lock size={22} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Gestão Pro</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Entre com seu e-mail e senha</p>
        </div>

        {error && (
          <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-400 rounded-lg flex items-center gap-2.5 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleAuth} method="POST" action="#" className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 mb-1.5">
              E-mail
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
              <input
                id="login-email"
                name="username"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none transition-all"
                placeholder="seu@email.com"
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 mb-1.5">
              Senha
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
              <input
                id="login-password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none transition-all"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 font-medium py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : 'Entrar no sistema'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setMode('signup')}
          className="mt-6 w-full text-center text-sm text-zinc-700 dark:text-zinc-200 hover:underline"
        >
          Ainda não tem conta? Criar conta e testar grátis por 1 hora
        </button>

        <p className="mt-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Acesso restrito a usuários autorizados. Fale com o responsável da sua loja.
        </p>
      </div>
    </div>
  );
};

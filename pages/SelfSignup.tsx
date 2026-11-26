import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Store, User, Mail, Lock, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { PRIVACY_URL, TERMS_URL } from '../lib/legal';

/** Chave do nome da loja guardada enquanto o e-mail aguarda confirmação (o teste começa no primeiro login). */
export const PENDING_TRIAL_KEY = 'pendingTrialStoreName';

/** Ponto de integração do Cloudflare Turnstile. Sem chave ainda: não bloqueia o cadastro. */
const TURNSTILE_SITE_KEY = (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY as string | undefined;

interface SelfSignupProps {
  onBack: () => void;
}

/**
 * Cadastro próprio do teste grátis de 1 hora.
 * 1) cria a conta no Supabase Auth; 2) com sessão, chama a RPC start_self_trial (cria loja + dono).
 * Se o Auth exigir confirmação de e-mail, guarda o nome da loja e o teste começa no primeiro login.
 */
export const SelfSignup: React.FC<SelfSignupProps> = ({ onBack }) => {
  const [form, setForm] = useState({ storeName: '', name: '', email: '', password: '', website: '' });
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Honeypot: campo oculto preenchido por robô. Não mostra erro nem cria nada.
    if (form.website) {
      setInfo('Cadastro recebido. Confira seu e-mail para continuar.');
      return;
    }

    if (!accepted) {
      setError('Aceite os Termos de Uso e a Política de Privacidade para continuar.');
      return;
    }

    const storeName = form.storeName.trim();
    if (storeName.length < 2 || storeName.length > 100) {
      setError('Informe o nome da loja (de 2 a 100 caracteres).');
      return;
    }
    if (!form.name.trim()) {
      setError('Informe seu nome.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      setError('Informe um e-mail válido.');
      return;
    }
    if (form.password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: { data: { full_name: form.name.trim() } },
      });
      if (signUpError) {
        throw new Error(
          signUpError.message === 'User already registered'
            ? 'Este e-mail já tem conta. Entre com sua senha.'
            : signUpError.message
        );
      }

      if (data.session) {
        // Com sessão ativa, a RPC cria a loja e o dono com 1 hora de teste.
        const { error: rpcError } = await supabase.rpc('start_self_trial', { p_name: storeName });
        if (rpcError) throw new Error(rpcError.message);
        localStorage.removeItem(PENDING_TRIAL_KEY);
        window.location.reload();
        return;
      }

      // Sem sessão (confirmação de e-mail pendente): o teste começa no primeiro login.
      localStorage.setItem(PENDING_TRIAL_KEY, storeName);
      setInfo(
        'Enviamos um link de confirmação para seu e-mail. Confirme e entre com sua senha: o teste de 1 hora começa nesse momento.'
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full pl-9 pr-4 py-2 text-sm bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none transition-all';
  const labelClass = 'block text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 mb-1.5';

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4 py-8">
      <div className="max-w-md w-full bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Teste grátis de 1 hora</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Crie sua conta e teste o Gestão Pro na sua loja.</p>
        </div>

        {error && (
          <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-400 rounded-lg flex items-center gap-2.5 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {info && (
          <div className="mb-5 p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400 rounded-lg flex items-center gap-2.5 text-sm">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{info}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Honeypot: fora da tela e fora da ordem de tabulação */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={set('website')} />
          </div>

          <div>
            <label htmlFor="signup-store" className={labelClass}>Nome da loja</label>
            <div className="relative">
              <Store className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
              <input id="signup-store" type="text" value={form.storeName} onChange={set('storeName')} className={inputClass} placeholder="Ex.: Loja Centro" autoComplete="organization" required />
            </div>
          </div>

          <div>
            <label htmlFor="signup-name" className={labelClass}>Seu nome</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
              <input id="signup-name" type="text" value={form.name} onChange={set('name')} className={inputClass} autoComplete="name" required />
            </div>
          </div>

          <div>
            <label htmlFor="signup-email" className={labelClass}>E-mail</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
              <input id="signup-email" name="username" type="email" value={form.email} onChange={set('email')} className={inputClass} placeholder="seu@email.com" autoComplete="email" required />
            </div>
          </div>

          <div>
            <label htmlFor="signup-password" className={labelClass}>Senha (mínimo 8 caracteres)</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
              <input id="signup-password" name="password" type="password" value={form.password} onChange={set('password')} className={inputClass} placeholder="••••••••" autoComplete="new-password" required />
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1" required />
            <span>
              Li e aceito os{' '}
              {TERMS_URL
                ? <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="underline">Termos de Uso</a>
                : <span>Termos de Uso</span>}
              {' '}e a{' '}
              <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="underline">Política de Privacidade</a>.
            </span>
          </label>

          {/* Ponto de integração Cloudflare Turnstile: só renderiza quando houver chave */}
          {TURNSTILE_SITE_KEY && <div className="cf-turnstile" data-sitekey={TURNSTILE_SITE_KEY} />}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 font-medium py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : 'Criar conta e testar grátis por 1 hora'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
          O teste dura 1 hora a partir do cadastro. Ao fim do prazo, o acesso é bloqueado; para continuar, escolha um plano.
        </p>

        <button type="button" onClick={onBack} className="mt-5 w-full text-center text-sm text-zinc-600 dark:text-zinc-300 hover:underline">
          Já tenho conta: entrar
        </button>
      </div>
    </div>
  );
};

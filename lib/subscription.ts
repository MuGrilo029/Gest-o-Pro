/**
 * Regras de assinatura/teste grátis no lado do app (apenas exibição).
 *
 * A fonte de verdade é o banco: `store_effective_status()` e `store_access_ok()`
 * (migração 006) bloqueiam a loja pelo RLS. Estas funções espelham a mesma regra
 * para a interface; se uma mudar, a outra precisa mudar junto.
 */

export type SubscriptionStatus = 'trial' | 'active' | 'suspended' | 'expired';

/** Duração padrão do teste grátis: 1 hora de uso (novos trials; lojas existentes mantêm o prazo gravado). */
export const TRIAL_DURATION_HOURS = 1;
export const TRIAL_DURATION_MS = TRIAL_DURATION_HOURS * 60 * 60 * 1000;

/** Fim do teste grátis a partir do início (precisão de milissegundos). */
export const trialEndsAt = (start: Date, hours: number = TRIAL_DURATION_HOURS): Date =>
  new Date(start.getTime() + hours * 60 * 60 * 1000);

/** Espelho de public.store_effective_status(): considera o relógio, sem job agendado. */
export const effectiveStatus = (
  status: SubscriptionStatus,
  trialEnd: Date | null,
  validUntil: Date | null,
  now: Date = new Date(),
): SubscriptionStatus => {
  if (status === 'suspended') return 'suspended';
  if (status === 'expired') return 'expired';
  if (status === 'trial' && (!trialEnd || trialEnd.getTime() <= now.getTime())) return 'expired';
  if (status === 'active' && validUntil && validUntil.getTime() <= now.getTime()) return 'expired';
  return status;
};

/** Espelho de public.store_access_ok(): só trial/ativo vigentes liberam o acesso; admin da plataforma nunca é bloqueado. */
export const hasAccess = (
  input: {
    isActiveStore: boolean;
    status: SubscriptionStatus;
    trialEnd: Date | null;
    validUntil: Date | null;
    isPlatformAdmin?: boolean;
  },
  now: Date = new Date(),
): boolean => {
  if (input.isPlatformAdmin) return true;
  if (!input.isActiveStore) return false;
  const eff = effectiveStatus(input.status, input.trialEnd, input.validUntil, now);
  return eff === 'trial' || eff === 'active';
};

/** Segundos restantes (null = sem prazo ou status sem contagem). Nunca negativo. */
export const secondsRemaining = (
  status: SubscriptionStatus,
  trialEnd: Date | null,
  validUntil: Date | null,
  now: Date = new Date(),
): number | null => {
  const end = status === 'trial' ? trialEnd : status === 'active' ? validUntil : null;
  if (!end) return null;
  return Math.max(0, Math.floor((end.getTime() - now.getTime()) / 1000));
};

export const formatRemaining = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
  return `${m}min ${String(s).padStart(2, '0')}s`;
};

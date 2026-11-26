/**
 * Remove todos os caches do navegador deste app.
 * Chamado no logout e ao trocar de conta: respostas de uma loja não podem sobreviver para outra conta
 * no mesmo aparelho.
 */
/** Chave do nome da loja guardada enquanto o teste aguarda confirmação de e-mail. */
export const PENDING_TRIAL_KEY_NAME = 'pendingTrialStoreName';

/** Limpa dados de sessão que não podem sobreviver ao logout ou à troca de conta. */
export const clearSessionData = (): void => {
  try {
    localStorage.removeItem(PENDING_TRIAL_KEY_NAME);
    sessionStorage.removeItem('GESTAO_PRO_IMPERSONATED_STORE');
  } catch (err) {
    console.warn('Não foi possível limpar os dados de sessão:', err);
  }
};

export const clearAppCaches = async (): Promise<void> => {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch (err) {
    console.warn('Não foi possível limpar o cache do app:', err);
  }
};

/**
 * Remove todos os caches do navegador deste app.
 * Chamado no logout e ao trocar de conta: respostas de uma loja não podem sobreviver para outra conta
 * no mesmo aparelho.
 */
export const clearAppCaches = async (): Promise<void> => {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch (err) {
    console.warn('Não foi possível limpar o cache do app:', err);
  }
};

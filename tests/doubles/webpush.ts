// Dublê do web-push: o teste registra quem receberia a notificação.
export default {
  setVapidDetails: () => {},
  sendNotification: async (sub: { endpoint: string }, payload: string) =>
    (globalThis as any).__pushSent?.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }),
};

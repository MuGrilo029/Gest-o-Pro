// Service Worker para Web Push Notifications + cache de assets.
// v4: network-first para HTML (navegacoes), para que deploys novos cheguem aos aparelhos
// sem precisar de F5; cache-first apenas para assets estaticos versionados; ativacao
// apaga caches antigos.

const CACHE_VERSION = 'gestao-pro-v4';
const STATIC_CACHE = CACHE_VERSION + '-static';

// Assets estaticos pre-cacheados (shell). O HTML nao entra aqui: ele e buscado na rede.
const PRECACHE_URLS = [
  '/favicon.svg',
  '/app-icon.jpg',
  '/app-icon.png'
];

self.addEventListener('install', (event) => {
  console.log('[SW] instalado');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch(() => {
        console.warn('[SW] alguns assets nao puderam ser pre-cacheados');
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] ativado');
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE) {
            return caches.delete(key);
          }
        })
      );
      await self.clients.claim();
    })()
  );
});

// Push Notifications (mantido)
self.addEventListener('push', (event) => {
  let notificationData = {
    title: 'Nova Venda!',
    body: 'Uma nova venda foi registrada.',
    icon: '/app-icon.jpg',
    badge: '/app-icon.jpg',
    tag: 'sale-notification',
    requireInteraction: false
  };

  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = {
        ...notificationData,
        ...data,
        data: data.metadata || {}
      };
    } catch (e) {
      notificationData.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      tag: notificationData.tag,
      requireInteraction: notificationData.requireInteraction,
      data: notificationData.data,
      actions: [
        { action: 'open', title: 'Abrir', icon: '/app-icon.png' },
        { action: 'close', title: 'Fechar', icon: '/app-icon.png' }
      ]
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const clientUrl = event.notification.data?.url || '/';

  if (event.action === 'close') {
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === clientUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(clientUrl);
      }
    })
  );
});

// Fetch: network-first para navegacoes (HTML), cache-first para assets estaticos.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) {
    return;
  }

  // Supabase: sempre rede, nunca cache.
  if (reqUrl.pathname.includes('/rest/v1/') || reqUrl.hostname.includes('supabase') || reqUrl.pathname.includes('supabase')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Navegacao (HTML): network-first, fallback para cache apenas se offline.
  if (event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // Assets estaticos: cache-first, popula o cache quando vier da rede.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(STATIC_CACHE).then((cache) => {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(() => cached);
    })
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-sales') {
    event.waitUntil(
      fetch('/api/sync-sales')
        .then((response) => {
          if (response.ok) {
            console.log('[SW] vendas sincronizadas');
          }
        })
        .catch((error) => {
          console.error('[SW] erro ao sincronizar vendas:', error);
        })
    );
  }
});

const CACHE_NAME = 'unicorn-field-v7';
const API_CACHE_NAME = 'unicorn-api-v1';

const STATIC_ASSETS = [
  '/favicon.png',
  '/manifest.json'
];

const CACHEABLE_API_ROUTES = [
  '/api/work-orders',
  '/api/customers',
  '/api/objects',
  '/api/resources',
  '/api/clusters'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== API_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    caches.keys().then((cacheNames) => {
      return Promise.all(cacheNames.map((name) => caches.delete(name)));
    });
  }
  if (event.data && event.data.type === 'CACHE_WORK_ORDERS') {
    cacheWorkOrders(event.data.workOrders);
  }
});

async function cacheWorkOrders(workOrders) {
  try {
    const cache = await caches.open(API_CACHE_NAME);
    const response = new Response(JSON.stringify(workOrders), {
      headers: { 
        'Content-Type': 'application/json',
        'X-Cached-At': new Date().toISOString()
      }
    });
    await cache.put('/api/work-orders', response);
  } catch (error) {
    console.error('Failed to cache work orders:', error);
  }
}

function isCacheableApiRoute(url) {
  return CACHEABLE_API_ROUTES.some(route => url.pathname.startsWith(route));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  
  if (url.pathname.startsWith('/api/')) {
    if (isCacheableApiRoute(url)) {
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(API_CACHE_NAME).then((cache) => {
                cache.put(event.request, clone);
              });
            }
            return response;
          })
          .catch(async () => {
            const cached = await caches.match(event.request);
            if (cached) {
              const cachedAt = cached.headers.get('X-Cached-At');
              const modifiedResponse = new Response(cached.body, {
                status: cached.status,
                statusText: cached.statusText,
                headers: {
                  ...Object.fromEntries(cached.headers.entries()),
                  'X-From-Cache': 'true',
                  'X-Cached-At': cachedAt || 'unknown'
                }
              });
              return modifiedResponse;
            }
            return new Response(JSON.stringify({ 
              error: 'Offline', 
              offline: true,
              message: 'Du är offline. Data är inte tillgängligt.' 
            }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          })
      );
    } else {
      event.respondWith(
        fetch(event.request)
          .catch(() => new Response(JSON.stringify({ 
            error: 'Offline',
            offline: true 
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }))
      );
    }
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return fetch(event.request)
        .then((response) => {
          if (response.ok && url.pathname !== '/') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/field').then((fieldPage) => {
              if (fieldPage) return fieldPage;
              return new Response(`
                <!DOCTYPE html>
                <html lang="sv">
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>Offline - Unicorn</title>
                  <style>
                    body { font-family: Inter, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: white; }
                    .container { text-align: center; padding: 2rem; }
                    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
                    p { color: #94a3b8; }
                    button { background: #3b82f6; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; cursor: pointer; margin-top: 1rem; font-size: 1rem; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <h1>Du är offline</h1>
                    <p>Kontrollera din internetanslutning och försök igen.</p>
                    <button onclick="location.reload()">Försök igen</button>
                  </div>
                </body>
                </html>
              `, {
                status: 503,
                headers: { 'Content-Type': 'text/html' }
              });
            });
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
    })
  );
});

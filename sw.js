const CACHE_NAME = 'fridge-v17';
const CORE_ASSETS = [
  './index.html',
  './styles.css',
  './app.js',
  './features.js',
  './pwa.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(CORE_ASSETS);
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('fridge-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.destination === 'image') {
    const cached = caches.match(request);
    const response = cached.then((value) => {
      if (value) return value;
      return fetch(request).then(async (networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          await caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse.clone()));
        }
        return networkResponse;
      });
    });
    event.respondWith(response);
    return;
  }

  if (request.mode === 'navigate') {
    const cacheKey = new URL('./index.html', self.registration.scope).href;
    const response = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      try {
        const networkResponse = await fetch(request, { signal: controller.signal });
        if (networkResponse && networkResponse.ok) {
          await caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, networkResponse.clone()));
        }
        return networkResponse;
      } catch {
        return (await caches.match(cacheKey)) || Response.error();
      } finally {
        clearTimeout(timeout);
      }
    })();
    event.respondWith(response);
    return;
  }

  const cached = caches.match(request);
  const refresh = fetch(request).then(async (networkResponse) => {
    if (networkResponse && networkResponse.status === 200) {
      await caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse.clone()));
    }
    return networkResponse;
  });
  event.waitUntil(refresh.then(() => undefined).catch(() => undefined));
  event.respondWith(cached.then((value) => value || refresh).catch(() => Response.error()));
});

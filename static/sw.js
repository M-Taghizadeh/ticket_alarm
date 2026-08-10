const CACHE_NAME = 'bilit-alarm-v5';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Network first strategy to prevent stale code locking
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Offline-Speicher für die App-Dateien.
// Bei Änderungen an der App: VERSION hier UND die ?v=… Nummern in index.html erhöhen.
const VERSION = 3;
const CACHE = 'kleiderschrank-v' + VERSION;
const ASSETS = [
  './',
  'index.html',
  `style.css?v=${VERSION}`,
  `app.js?v=${VERSION}`,
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// Beim Installieren alles frisch vom Server holen (am Browser-Cache vorbei).
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Mit Internet: immer die aktuelle Version vom Server (und für offline merken).
// Ohne Internet (oder wenn der Server zu lange braucht): die gespeicherte Version.
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromCache = async () =>
      (await cache.match(req)) ||
      (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? await cache.match('index.html') : undefined);

    try {
      const res = await Promise.race([
        fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const cached = await fromCache();
      return cached || Response.error();
    }
  })());
});

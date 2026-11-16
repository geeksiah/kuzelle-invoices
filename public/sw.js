// Offline support. Same-origin files are network-first so a new deploy is picked
// up immediately; the cache is only a fallback when offline. API calls are never cached.
const CACHE = 'kuzelle-v4';
const SHELL = ['./', './index.html', './styles.css', './js/app.js', './js/util.js', './js/store.js', './js/document.js', './js/ui.js', './js/brand.js',
  './vendor/html2canvas.min.js', './vendor/jspdf.umd.min.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/')) return;
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? './index.html' : req, copy)); }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? './index.html' : req, { ignoreSearch: true })));
    return;
  }
  // fonts and other cross-origin assets: cache first
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});

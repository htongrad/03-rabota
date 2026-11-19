'use strict';

const cachePrefix = 'panel-03-shell-';
const release = '32';
const cacheName = cachePrefix + 'v' + release;
const scope = new URL(self.registration.scope);
const home = scope.href;
const index = new URL('index.html', scope).href;
const staticAssets = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'quality.css?v=32', 'team-readiness.js?v=32', 'financial-review.js?v=32', 'point-operations.js?v=32', 'product-launch.js?v=32', 'management.js?v=32', 'quality.js?v=32', 'backup.js?v=32', 'google-sync.js?v=32', 'calendar-sync.js?v=32', 'development.css?v=32', 'bar-menu.js?v=32', 'bar-operations.js?v=32', 'development.js?v=32']
  .map(path => new URL(path, scope).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const response = await fetch(new URL('index.html?release=' + release, scope).href, { cache: 'reload' });
    if (!response.ok || !(await response.clone().text()).includes('<meta name="panel-build" content="' + release + '">')) {
      throw Error('Файлы новой сборки ещё не опубликованы полностью.');
    }
    await cache.addAll(staticAssets.map(url => new Request(url, { cache: 'reload' })));
    await cache.put(home, response);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(cachePrefix) && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

// The HTML and its asset versions are activated together after a successful install.
async function fromRelease(request, key) {
  const cache = await caches.open(cacheName);
  return await cache.match(key) || fetch(request);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const canonical = url.origin + url.pathname;

  if (request.mode === 'navigate' && (canonical === home || canonical === index)) {
    event.respondWith(fromRelease(request, home));
  } else if (staticAssets.includes(url.href)) {
    event.respondWith(fromRelease(request, url.href));
  }
});

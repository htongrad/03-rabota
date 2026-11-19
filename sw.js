'use strict';

const cachePrefix = 'panel-03-shell-';
const cacheName = cachePrefix + 'v31';
const scope = new URL(self.registration.scope);
const home = scope.href;
const index = new URL('index.html', scope).href;
const staticAssets = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'quality.css?v=31', 'team-readiness.js?v=31', 'financial-review.js?v=31', 'point-operations.js?v=31', 'product-launch.js?v=31', 'management.js?v=31', 'quality.js?v=31', 'backup.js?v=31', 'google-sync.js?v=31', 'calendar-sync.js?v=31', 'development.css?v=31', 'bar-menu.js?v=31', 'bar-operations.js?v=31', 'development.js?v=31']
  .map(path => new URL(path, scope).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([home, ...staticAssets].map(url => new Request(url, { cache: 'reload' })));
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

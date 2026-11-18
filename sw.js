'use strict';

const cachePrefix = 'panel-03-shell-';
const cacheName = cachePrefix + 'v22';
const scope = new URL(self.registration.scope);
const home = scope.href;
const index = new URL('index.html', scope).href;
const staticAssets = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'quality.css?v=22', 'team-readiness.js?v=22', 'quality.js?v=22', 'backup.js?v=22', 'google-sync.js?v=22', 'calendar-sync.js?v=22', 'development.css?v=22', 'bar-menu.js?v=22', 'bar-operations.js?v=22', 'development.js?v=22']
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

async function refresh(request, cacheKey) {
  const cache = await caches.open(cacheName).catch(() => null);
  let response;
  try {
    response = await fetch(request);
  } catch {
    return await cache?.match(cacheKey) || Response.error();
  }

  const cacheable = request.mode !== 'navigate' || response.headers.get('content-type')?.includes('text/html');
  if (cache && response.ok && cacheable) {
    await cache.put(cacheKey, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const canonical = url.origin + url.pathname;

  if (request.mode === 'navigate' && (canonical === home || canonical === index)) {
    event.respondWith(refresh(request, home));
  } else if (staticAssets.includes(url.href)) {
    event.respondWith(refresh(request, url.href));
  }
});

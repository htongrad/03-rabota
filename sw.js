'use strict';

const cachePrefix = 'panel-03-shell-';
const cacheName = cachePrefix + 'v1';
const scope = new URL(self.registration.scope);
const home = scope.href;
const index = new URL('index.html', scope).href;
const staticAssets = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png']
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

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const canonical = url.origin + url.pathname;

  if (event.request.mode === 'navigate' && (canonical === home || canonical === index)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName).catch(() => null);
      let response;
      try {
        response = await fetch(event.request);
      } catch {
        return await cache?.match(home) || Response.error();
      }

      if (cache && response.ok && response.headers.get('content-type')?.includes('text/html')) {
        await cache.put(home, response.clone()).catch(() => {});
      }
      return response;
    })());
  } else if (staticAssets.includes(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return await cache.match(event.request) || fetch(event.request);
    })());
  }
});

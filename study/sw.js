'use strict';
const CACHE_PREFIX = 'law-sprint-shell-8ab66a5f99c7-';
const CACHE_NAME = CACHE_PREFIX + "ad3ef46df92a80ae";
const PRECACHE = [".","index.html","assets/index-BUaHG8dY.js","assets/index-DZA3Ct-k.css","manifest.webmanifest","favicon.svg","icon-192.png","icon-512.png","icon-maskable-512.png","apple-touch-icon.png"];
const SHELL_URLS = new Set(PRECACHE.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll([...SHELL_URLS])));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  url.hash = '';
  if (url.origin !== self.location.origin || !SHELL_URLS.has(url.href)) return;
  event.respondWith(caches.open(CACHE_NAME).then(cache => cache.match(url.href)).then(cached => cached || fetch(request)));
});

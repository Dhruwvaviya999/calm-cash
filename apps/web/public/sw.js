/* global self, caches, clients, importScripts, fetch, Response, URL */
// CalmCash service worker.
//
// What it may cache: public, non-personal files only — content-hashed Next.js build assets
// (/_next/static/…, including fonts), the app icons and manifest, and the offline page.
//
// What it never touches: API requests (/api/…: sessions, CSRF, balances, transactions, receipts,
// imports, notifications, AI), page HTML and React Server Component payloads, and any request
// that is not a same-origin GET. Those go straight to the network, so one person's financial data
// can never be served from a cache, and a page is never shown from a stale copy.
//
// Updates: a new deployment changes /sw-version.js, the browser installs this worker again, and
// the new one waits. The page asks the person before switching (see ServiceWorkerManager); it
// never reloads by itself, so an unfinished form or statement review is not lost. If installing
// fails, the browser keeps the previous worker.

importScripts('/sw-version.js');

const VERSION = typeof self.CALMCASH_VERSION === 'string' ? self.CALMCASH_VERSION : 'unversioned';
// Hashed assets never change under the same URL, so one cache serves every version (an open tab
// of the previous version can still load chunks it already used). Trimmed on activation.
const STATIC_CACHE = 'calmcash-static-v1';
const SHELL_CACHE = `calmcash-shell-${VERSION}`;
const OFFLINE_URL = '/offline';
const PUBLIC_FILES = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
];
const MAX_STATIC_ENTRIES = 400;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // The offline page is static and personal-data free; fetch it without cookies regardless.
      const response = await fetch(OFFLINE_URL, { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('The offline page is unavailable.');
      const html = await response.clone().text();
      const shell = await caches.open(SHELL_CACHE);
      await shell.put(OFFLINE_URL, response);
      // The offline page's own scripts and styles, so it works (retry, status) without a network.
      const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)<>\\]+/g) ?? [])];
      const statics = await caches.open(STATIC_CACHE);
      await statics.addAll([...assets, ...PUBLIC_FILES]);
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('calmcash-') && name !== STATIC_CACHE && name !== SHELL_CACHE) {
          await caches.delete(name);
        }
      }
      const statics = await caches.open(STATIC_CACHE);
      const keys = await statics.keys();
      for (const request of keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES))) {
        await statics.delete(request);
      }
      await clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  // Sent only after the person chose "Reload now" on the update notice.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkWithOfflineFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
    return offline ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never: personal data, sessions, CSRF tokens, receipts, and everything else the API serves.
  if (url.pathname.startsWith('/api/')) return;
  // Pages: always from the network; the offline page only when the network is unreachable.
  if (request.mode === 'navigate') {
    event.respondWith(networkWithOfflineFallback(request));
    return;
  }
  // Server Component payloads are page data: network only.
  if (request.headers.has('RSC') || url.searchParams.has('_rsc')) return;
  if (url.pathname.startsWith('/_next/static/') || PUBLIC_FILES.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else: the browser's normal behaviour.
});

/**
 * Demus PWA Service Worker
 *
 * Strategy overview:
 *  - App shell (HTML pages)   → Network-first, fall back to cache, then offline.html
 *  - Static assets (JS/CSS/fonts/images) → Cache-first (long-lived)
 *  - API routes (/api/*)       → Network-only (never cache sensitive data)
 *  - YouTube / CDN images      → Stale-while-revalidate
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `demus-static-${CACHE_VERSION}`;
const PAGES_CACHE = `demus-pages-${CACHE_VERSION}`;
const IMAGE_CACHE = `demus-images-${CACHE_VERSION}`;

const OFFLINE_URL = '/offline.html';

// Assets to precache on install
const PRECACHE_ASSETS = [
    '/',
    OFFLINE_URL,
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
];

// ── Install ───────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) =>
            cache.addAll(PRECACHE_ASSETS)
        ).then(() => self.skipWaiting())
    );
});

// ── Activate — purge old caches ───────────────────────────────
self.addEventListener('activate', (event) => {
    const validCaches = new Set([STATIC_CACHE, PAGES_CACHE, IMAGE_CACHE]);
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((k) => !validCaches.has(k))
                    .map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle same-origin + known CDN image requests
    const isSameOrigin = url.origin === self.location.origin;
    const isCDNImage =
        url.hostname === 'i.scdn.co' ||
        url.hostname === 'mosaic.scdn.co' ||
        url.hostname === 'image-cdn-ak.spotifycdn.com' ||
        url.hostname === 'img.youtube.com';

    // Skip non-GET
    if (request.method !== 'GET') return;

    // API routes — always network-only
    if (isSameOrigin && url.pathname.startsWith('/api/')) return;

    // CDN images — stale-while-revalidate
    if (isCDNImage) {
        event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
        return;
    }

    // Static assets (_next/static) — cache-first
    if (isSameOrigin && url.pathname.startsWith('/_next/static/')) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    // Local images / icons — cache-first
    if (isSameOrigin && (
        url.pathname.startsWith('/icons/') ||
        url.pathname.startsWith('/images/') ||
        /\.(png|jpg|jpeg|svg|webp|ico|gif)$/.test(url.pathname)
    )) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    // HTML navigation — network-first with cache fallback
    if (isSameOrigin && request.mode === 'navigate') {
        event.respondWith(networkFirstWithOfflineFallback(request));
        return;
    }
});

// ── Strategies ────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch {
        return new Response('Network error', { status: 503 });
    }
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    const fetchPromise = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
    }).catch(() => null);

    return cached || (await fetchPromise) ||
        new Response('', { status: 503 });
}

async function networkFirstWithOfflineFallback(request) {
    const cache = await caches.open(PAGES_CACHE);

    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch {
        const cached = await cache.match(request);
        if (cached) return cached;

        // Last resort: offline page
        const offline = await caches.match(OFFLINE_URL);
        return offline || new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
        });
    }
}

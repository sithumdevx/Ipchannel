/* StreamPulse service worker.
 *
 * Deliberately dependency-free and conservative:
 *   - Same-origin GET only. Cross-origin CDN requests (channel logos, HLS
 *     segments/keys) are never touched.
 *   - `/api/*` is never cached. That is where live manifests and segments flow
 *     through the proxy, and stale video data is worse than a network round trip.
 *   - Navigations are network-first (fresh HTML + auth state), with a cached
 *     shell / offline page as the fallback.
 *   - Hashed build assets and icons are cache-first.
 */

const CACHE_NAME = "streampulse-v1";
const APP_SHELL = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // allSettled semantics: one missing file must not abort the install.
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url))).then(() => self.skipWaiting())
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/* -------------------------------------------------------------------------- */
/* Fetch strategies                                                            */
/* -------------------------------------------------------------------------- */

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match("/")) ||
      (await cache.match("/offline.html")) ||
      new Response("You are offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cached || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin (streams, logos, analytics) — always straight to the network.
  if (url.origin !== self.location.origin) return;

  // Live API traffic (manifests, segments, auth, health) — never cached.
  if (url.pathname.startsWith("/api/")) return;

  // Range/RSC requests must hit the network (video seeking, RSC payloads).
  if (request.headers.has("range") || request.headers.get("RSC") || url.searchParams.has("_rsc")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(cacheFirst(request));
  }
});

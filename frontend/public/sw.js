/**
 * Space Journey — Service Worker
 * Stale-while-revalidate: serve from cache instantly, refresh in background.
 * All GET responses are cached on first fetch, so the app works fully offline
 * after the initial load.
 */

const CACHE = 'space-journey-v1';

self.addEventListener('install', (e) => {
  // Cache the shell immediately; skip waiting so the new SW activates fast
  e.waitUntil(
    caches.open(CACHE).then(c => c.add('.')).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  // Delete any caches from old versions
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Only handle GET; ignore cross-origin requests (YouTube iframe API etc.)
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        // Fire network request regardless — update cache in background
        const networkFetch = fetch(e.request)
          .then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => cached); // network failed — fall back to cached copy

        // Return cached copy immediately if available, else wait for network
        return cached ?? networkFetch;
      })
    )
  );
});

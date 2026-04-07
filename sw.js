const CACHE = 'past-skies-v2'; // ← bump this on every deploy

const STATIC = [
  '/index.html',
  '/style.css',
  '/app.js',
  '/fog-monster.png',
];

const API_HOSTS = [
  'api.open-meteo.com',
  'historical-forecast-api.open-meteo.com',
  'geocoding-api.open-meteo.com',
  'nominatim.openstreetmap.org',
];

// Pre-cache static assets on install
self.addEventListener('install', event => {
  self.skipWaiting();
});

// Delete old caches on activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-first for API calls — always want fresh weather data,
  // fall back to cache if offline
  if (API_HOSTS.includes(url.hostname)) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

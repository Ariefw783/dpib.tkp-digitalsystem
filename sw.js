// Nama tempat penyimpanan data sementara (Cache)
const CACHE_NAME = 'absensi-pkl-v2';
const ASSETS = [
  './',
  './index.html',
  './absensipkl.html',
  './style.css',
  './app.js',
  './datasiswa.js',
  './logosmk.png'
];

// Tahap instalasi Service Worker
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Tahap membaca data dari penyimpanan lokal agar lebih cepat
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});
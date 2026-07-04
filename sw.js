// Nama penyimpanan utama
const CACHE_NAME = 'absensi-pkl-v2';

// Daftar file aktif yang wajib disimpan untuk akses offline.
// Jika Anda menambah atau menghapus file dari daftar ini, sistem akan otomatis menyesuaikannya.
const ASSETS = [
  './',
  './index.html',
  './absensipkl.html',
  './style.css',
  './app.js',
  './datasiswa.js',
  './logosmk.png'
];

// 1. Tahap instalasi Service Worker
self.addEventListener('install', (e) => {
  // Langsung aktifkan sistem baru begitu terdeteksi ada perubahan file sw.js di GitHub
  self.skipWaiting();
  
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// 2. Tahap aktivasi: Sistem Pembersih Sampah Otomatis
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.keys().then((keys) => {
        return Promise.all(
          keys.map((request) => {
            // Ambil jalur folder/nama file dari alamat memori (misal: /logosmk.png)
            const urlPath = new URL(request.url).pathname;
            
            // Periksa apakah file yang ada di memori HP masih terdaftar di daftar ASSETS kita
            const isAssetStillNeeded = ASSETS.some(asset => {
              const normalizedAsset = asset.replace('./', '');
              return urlPath.endsWith(normalizedAsset) || urlPath === '/' || urlPath.endsWith('/');
            });

            // JIKA FILE TIDAK ADA DI DAFTAR ASSETS LAGI, HAPUS OTOMATIS DARI HP SISWA
            if (!isAssetStillNeeded) {
              return cache.delete(request);
            }
          })
        );
      });
    }).then(() => self.clients.claim()) // Langsung kendalikan halaman aktif
  );
});

// 3. Strategi Network-First (Utamakan Internet, Cadangan di Memori)
self.addEventListener('fetch', (e) => {
  // Hanya kelola berkas internal aplikasi kita sendiri untuk mencegah error pada Firebase (database)
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) {
    return; // Biarkan request database/eksternal langsung ke internet tanpa interupsi
  }

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // Jika internet aktif, langsung timpa data lama di memori dengan yang paling baru
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // Jika internet terputus/offline, ambil data cadangan dari memori HP
        return caches.match(e.request);
      })
  );
});
// Nama penyimpanan sementara (Cache). 
// Kiat: Jika nanti Anda melakukan update besar, ubah 'v2' menjadi 'v3' untuk memperbarui memori HP siswa secara paksa.
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

// 1. Tahap instalasi Service Worker
self.addEventListener('install', (e) => {
  // Langsung aktifkan Service Worker baru tanpa menunggu aplikasi ditutup (mengatasi delay update)
  self.skipWaiting();
  
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// 2. Tahap aktivasi: Membersihkan memori cache versi lama otomatis
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()) // Langsung kendalikan halaman web begitu aktif
  );
});

// 3. Strategi Network-First (Utamakan Internet, Cadangan di Memori)
self.addEventListener('fetch', (e) => {
  // BATASAN: Hanya kelola aset internal web kita (GET request & berasal dari domain yang sama)
  // Ini mencegah request database Firebase/Firestore agar tidak terganggu dan bebas dari error ERR_FAILED
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) {
    return; // Biarkan request database langsung meluncur ke internet tanpa diinterupsi oleh PWA
  }

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // Jika internet aktif, simpan salinan terbaru ke memori untuk persiapan offline, lalu tampilkan
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // Jika internet mati (offline), ambil cadangan halaman yang tersimpan di memori lokal
        return caches.match(e.request);
      })
  );
});
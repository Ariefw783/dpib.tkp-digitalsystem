// Nama tempat penyimpanan data sementara (Cache)
const CACHE_NAME = 'absensi-pkl-v2'; // Kita naikkan versinya agar browser memperbarui cache lama
const ASSETS = [
  './',
  './index.html',
  './absensipkl.html',
  './style.css',
  './app.js',
  './datasiswa.js',
  './logosmk.png'
];

// Tahap instalasi Service Worker (Dibuat toleran jika ada file gagal dimuat)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Menggunakan map agar jika ada satu file gagal, tidak menggagalkan seluruh instalasi aplikasi
      return Promise.all(
        ASSETS.map((url) => {
          return cache.add(url).catch((err) => {
            console.warn(`Aset dilewati karena tidak ditemukan di server Cloudflare: ${url}`, err);
          });
        })
      );
    })
  );
});

// Tahap membaca data dari penyimpanan lokal dengan aman
self.addEventListener('fetch', (e) => {
  // PENGAMAN UTAMA: Hanya tangani request berbasis HTTP/HTTPS (melewati chrome-extension, cloudflare beacon, dll)
  if (!e.request.url.startsWith('http')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      // Jika ada di memori lokal, pakai lokal. Jika tidak ada, ambil dari internet (Cloudflare)
      return cachedResponse || fetch(e.request).catch(() => {
        // Pengaman jika jaringan offline / gagal ambil data agar tidak memicu layar abu-abu "ERR_FAILED"
        return new Response('Koneksi internet bermasalah saat memuat aset.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'Content-Type': 'text/plain' })
        });
      });
    })
  );
});
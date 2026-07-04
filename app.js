// Impor database siswa dari berkas datasiswa.js
import { DATA_SISWA } from "./datasiswa.js";

// Import Firebase SDK v10 dari CDN secara dinamis (ES Modules)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 1. Firebase Configuration (Sesuai dengan config Firebase Anda)
const firebaseConfig = { 
  apiKey: "AIzaSyDDHwbFq1rFoSImy3I8g3O820vV_sPdEHE",
  authDomain: "dpib-system-v2.firebaseapp.com", 
  projectId: "dpib-system-v2",
  storageBucket: "dpib-system-v2.firebasestorage.app", 
  messagingSenderId: "444034231596",
  appId: "1:444034231596:web:087a500225bffabe7d5089" 
};

// Inisialisasi Firebase & Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const COLLECTION_NAME = "Absensi PKL";

// Tetapan Jangka Waktu PKL Resmi dari Sekolah (15 Juli s.d 27 November 2026)
const PKL_START_DATE = "2026-07-01";
const PKL_END_DATE = "2026-11-27";

// 2. Global State Application
let selectedKelas = "";
let selectedNama = "";
let activeType = ""; // 'Masuk', 'Pulang', 'Sakit', 'Izin', 'Libur'
let stream = null; // Stream webcam
let gpsCoords = { lat: null, lng: null };
let siswaStateToday = { masuk: false, pulang: false, nonHadir: false };
let isRekapTableInitialized = false; // Memaksa pembimbing memilih filter di awal

// State Paginasi Tabel Rekap (Maksimal 20 item per halaman)
let currentPage = 1;
const itemsPerPage = 20;

// LOGIKA BARU: Penghapus Loading Sistem yang Kebal dari Race Condition
const removeSystemLoader = () => {
  const loader = document.getElementById("system-loader");
  if (loader) {
    loader.classList.add("opacity-0", "pointer-events-none");
    setTimeout(() => loader.remove(), 500);
  }
};

// Jika halaman sudah siap sebelum script ini selesai dimuat, langsung hapus loader
if (document.readyState === "complete" || document.readyState === "interactive") {
  removeSystemLoader();
} else {
  // Jika halaman belum siap, tunggu hingga event load terpicu
  window.addEventListener("load", removeSystemLoader);
}

// Format Tanggal Hari Ini (WIB - format lokal YYYY-MM-DD)
const getTodayString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Inisialisasi input tanggal Panel Pembimbing dengan tanggal hari ini
const inputTanggalPembimbing = document.getElementById("pembimbing-date-input");
if (inputTanggalPembimbing) {
  inputTanggalPembimbing.value = getTodayString();
}

// Kontrol Tampilan Dropdown Bulan PKL sesuai pilihan Format Pemantauan
const selectPeriode = document.getElementById("pembimbing-filter-periode");
const containerBulan = document.getElementById("pembimbing-filter-bulan-container");
if (selectPeriode) {
  selectPeriode.addEventListener("change", (e) => {
    if (e.target.value === "bulan") {
      containerBulan.classList.remove("hidden");
    } else {
      containerBulan.classList.add("hidden");
    }
  });
}

// Jam Digital Aktual di Header Absensi
function runAbsenClock() {
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const d = new Date();
  
  const dayName = days[d.getDay()];
  const date = d.getDate();
  const monthName = months[d.getMonth()];
  const year = d.getFullYear();
  
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  
  const dateEl = document.getElementById("current-date-absen");
  const timeEl = document.getElementById("current-time-absen");
  if (dateEl) dateEl.textContent = `${dayName}, ${date} ${monthName} ${year}`;
  if (timeEl) timeEl.textContent = `${hours}:${minutes}:${seconds} WIB`;
}
setInterval(runAbsenClock, 1000);
runAbsenClock();

// ==========================================
// TAHAP 1: LOGIKA LOGIN & CEK STATUS HARIAN
// ==========================================

// Inisialisasi Dropdown Kelas
document.getElementById("select-kelas").addEventListener("change", (e) => {
  selectedKelas = e.target.value;
  const selectNama = document.getElementById("select-nama");
  const statusBox = document.getElementById("status-box");
  const btnLanjut = document.getElementById("btn-lanjut-absen");
  
  selectNama.innerHTML = '<option value="">-- Pilih Nama Anda --</option>';
  statusBox.classList.add("hidden");
  btnLanjut.disabled = true;

  if (selectedKelas && DATA_SISWA[selectedKelas]) {
    selectNama.disabled = false;
    DATA_SISWA[selectedKelas].forEach(nama => {
      const opt = document.createElement("option");
      opt.value = nama;
      opt.textContent = nama;
      selectNama.appendChild(opt);
    });
  } else {
    selectNama.disabled = true;
  }
});

// Cek Status Harian Firestore setelah nama dipilih
document.getElementById("select-nama").addEventListener("change", async (e) => {
  selectedNama = e.target.value;
  const statusBox = document.getElementById("status-box");
  const statusMessage = document.getElementById("status-message");
  const btnLanjut = document.getElementById("btn-lanjut-absen");

  if (!selectedNama) {
    statusBox.classList.add("hidden");
    btnLanjut.disabled = true;
    return;
  }

  statusBox.className = "p-3 rounded-xl text-center border bg-slate-50 border-slate-200 text-slate-600 text-xs";
  statusMessage.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> Mengecek status kehadiran...';
  statusBox.classList.remove("hidden");

  try {
    const todayStr = getTodayString();
    const q = query(
      collection(db, COLLECTION_NAME),
      where("nama", "==", selectedNama),
      where("tanggal", "==", todayStr)
    );
    const querySnapshot = await getDocs(q);

    // Reset state harian
    siswaStateToday = { masuk: false, pulang: false, nonHadir: false };

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.type === "Masuk") siswaStateToday.masuk = true;
      if (data.type === "Pulang") siswaStateToday.pulang = true;
      if (["Sakit", "Izin", "Libur"].includes(data.type)) siswaStateToday.nonHadir = true;
    });

    if (siswaStateToday.nonHadir) {
      statusBox.className = "p-3 rounded-xl text-center border bg-amber-50 border-amber-200 text-amber-700 text-xs";
      statusMessage.innerHTML = `<i class="fa-solid fa-circle-info"></i> Anda hari ini tercatat berhalangan hadir (Sakit/Izin/Libur).`;
      btnLanjut.disabled = true;
    } else if (siswaStateToday.masuk && siswaStateToday.pulang) {
      statusBox.className = "p-3 rounded-xl text-center border bg-emerald-50 border-emerald-200 text-emerald-700 text-xs";
      statusMessage.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span class="font-bold">Presensi Lengkap!</span> Anda telah menyelesaikan absensi Berangkat & Pulang hari ini.`;
      btnLanjut.disabled = true;
    } else if (siswaStateToday.masuk) {
      statusBox.className = "p-3 rounded-xl text-center border bg-blue-50 border-blue-200 text-blue-700 text-xs";
      statusMessage.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span class="font-bold">Anda sudah absen berangkat.</span> Silakan klik tombol di bawah untuk mengisi jurnal & absen pulang.`;
      btnLanjut.disabled = false;
    } else {
      statusBox.className = "p-3 rounded-xl text-center border bg-rose-50 border-rose-200 text-rose-700 text-xs";
      statusMessage.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Anda belum melakukan absensi hari ini. Silakan melakukan absensi keberangkatan.`;
      btnLanjut.disabled = false;
    }
  } catch (error) {
    console.error("Gagal verifikasi Firebase:", error);
    statusMessage.textContent = "Koneksi database bermasalah. Coba lagi.";
  }
});

// ==========================================
// TAHAP 2: KAMERA, GPS, DAN INTERAKSI FORM
// ==========================================

// Masuk ke Tampilan Presensi Kamera
document.getElementById("btn-lanjut-absen").addEventListener("click", () => {
  document.getElementById("view-login").classList.add("hidden");
  document.getElementById("view-absen").classList.remove("hidden");

  document.getElementById("absen-siswa-nama").textContent = selectedNama;
  document.getElementById("absen-siswa-kelas").textContent = selectedKelas;

  // Inisialisasi Tipe Kehadiran sesuai State
  const btnMasuk = document.getElementById("type-masuk");
  const btnPulang = document.getElementById("type-pulang");

  btnMasuk.textContent = "Absen Masuk";
  btnPulang.textContent = "Absen Pulang";

  if (siswaStateToday.masuk) {
    setAbsenType("Pulang");
    btnMasuk.disabled = true;
    btnMasuk.className = "py-2 px-3 border rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 opacity-40 cursor-not-allowed bg-slate-100 text-slate-400";
  } else {
    setAbsenType("Masuk");
    btnPulang.disabled = true;
    btnPulang.className = "py-2 px-3 border rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 opacity-40 cursor-not-allowed bg-slate-100 text-slate-400";
  }

  // Mulai Kamera & GPS
  startCamera();
  startGPS();
});

// Kontrol GPS Geolocation
function startGPS() {
  const gpsStatus = document.getElementById("gps-status");
  if (!navigator.geolocation) {
    gpsStatus.textContent = "GPS tidak didukung oleh browser Anda.";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      gpsCoords.lat = pos.coords.latitude;
      gpsCoords.lng = pos.coords.longitude;
      gpsStatus.textContent = `LOKASI: ${gpsCoords.lat.toFixed(6)}, ${gpsCoords.lng.toFixed(6)} (Akurat)`;
    },
    () => {
      gpsStatus.textContent = "GPS gagal dimuat. Izinkan lokasi Anda.";
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// Kontrol Aliran Kamera Riil (Webcam)
async function startCamera() {
  const video = document.getElementById("webcam");
  const scannerContainer = document.getElementById("scanner-container");
  scannerContainer.classList.remove("hidden");

  try {
    stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: "user" }, 
      audio: false 
    });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
    };
  } catch (err) {
    console.error("Gagal mengaktifkan webcam:", err);
    scannerContainer.innerHTML = `
      <div class="p-4 text-center text-rose-500 text-xs font-semibold flex flex-col justify-center items-center h-full">
        <i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i> 
        <span>Izin kamera diblokir atau browser tidak aman.</span>
        <span class="text-[9px] text-slate-400 font-normal mt-1">Gunakan alamat 'localhost' atau protokol HTTPS untuk mengaktifkan kamera.</span>
      </div>`;
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
}

// Handler Jenis Kehadiran
function setAbsenType(type) {
  activeType = type;
  const types = ["Masuk", "Pulang", "Sakit", "Izin", "Libur"];
  const scannerContainer = document.getElementById("scanner-container");
  const journalContainer = document.getElementById("journal-container");
  const journalLabel = document.getElementById("journal-label");
  const journalText = document.getElementById("journal-text");

  // Reset Tombol
  types.forEach(t => {
    const el = document.getElementById(`type-${t.toLowerCase()}`);
    if (el) {
      el.classList.remove("btn-status-active");
      el.classList.add("btn-status-inactive");
    }
  });

  // Set Tombol Aktif
  const activeEl = document.getElementById(`type-${type.toLowerCase()}`);
  if (activeEl) {
    activeEl.classList.remove("btn-status-inactive");
    activeEl.classList.add("btn-status-active");
  }

  // Pengaturan Kondisional Kamera & Jurnal
  if (["Sakit", "Izin", "Libur"].includes(type)) {
    stopCamera();
    scannerContainer.classList.add("hidden");
    journalContainer.classList.remove("hidden");
    journalLabel.textContent = `Alasan Keterangan (${type})`;
    journalText.placeholder = `Tuliskan alasan lengkap mengapa ${type.toLowerCase()} hari ini...`;
    journalText.required = true;
  } else {
    if (!stream) startCamera();
    scannerContainer.classList.remove("hidden");
    if (type === "Pulang") {
      journalContainer.classList.remove("hidden");
      journalLabel.textContent = "Jurnal Ringkasan Kegiatan Hari Ini";
      journalText.placeholder = "Tuliskan ringkasan kegiatan PKL Anda secara jelas hari ini...";
      journalText.required = true;
    } else {
      journalContainer.classList.add("hidden");
      journalText.required = false;
    }
  }
}

// Event Pilihan Status (Manual Click)
["Masuk", "Pulang", "Sakit", "Izin", "Libur"].forEach(t => {
  const el = document.getElementById(`type-${t.toLowerCase()}`);
  if (el) {
    el.addEventListener("click", () => {
      if (!el.disabled) setAbsenType(t);
    });
  }
});

// Tombol Keluar (Kembali ke Login)
document.getElementById("btn-keluar").addEventListener("click", () => {
  stopCamera();
  document.getElementById("view-absen").classList.add("hidden");
  document.getElementById("view-login").classList.remove("hidden");
  document.getElementById("form-login").reset();
  document.getElementById("status-box").classList.add("hidden");
});

// ==========================================
// TAHAP 3: ALGORITMA SCANNING & SUBMIT DATABASE (CROP PORTRAIT 3:4)
// ==========================================
document.getElementById("form-absen-action").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btnSubmit = document.getElementById("btn-submit-absen");
  const successContainer = document.getElementById("success-container");
  const laser = document.querySelector(".scanner-laser");
  const journalVal = document.getElementById("journal-text").value;
  const tempatPklVal = document.getElementById("input-perusahaan").value;

  // Tombol Loading State
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch animate-spin"></i> Menghubungkan...`;

  // Capture Gambar dari Kamera ke Base64 (ASPEK RASIO POTRET 3:4 - NO STRETCH)
  let capturedPhotoBase64 = "";
  if (["Masuk", "Pulang"].includes(activeType) && stream) {
    try {
      const video = document.getElementById("webcam");
      const canvas = document.getElementById("canvas-photo");
      
      canvas.width = 360;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");

      const vWidth = video.videoWidth;
      const vHeight = video.videoHeight;

      let sWidth = vWidth;
      let sHeight = vWidth * (4 / 3);

      if (sHeight > vHeight) {
        sHeight = vHeight;
        sWidth = vHeight * (3 / 4);
      }

      const sX = (vWidth - sWidth) / 2;
      const sY = (vHeight - sHeight) / 2;

      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);

      ctx.drawImage(video, sX, sY, sWidth, sHeight, 0, 0, canvas.width, canvas.height);

      capturedPhotoBase64 = canvas.toDataURL("image/jpeg", 0.6);
    } catch (photoErr) {
      console.warn("Gagal menangkap foto kamera potret 3:4:", photoErr);
    }
  }

  // Simulasi Pemindaian Wajah Selama 2 Detik (Khas Futuristik)
  if (["Masuk", "Pulang"].includes(activeType)) {
    btnSubmit.innerHTML = `<i class="fa-solid fa-fingerprint animate-pulse text-blue-300"></i> Memindai Wajah...`;
    laser.style.animationDuration = "0.5s";
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Pemrosesan Pengiriman Data ke Firestore
  try {
    const todayStr = getTodayString();
    const uniqueStringCode = `PKL-${selectedKelas.replace(/\s+/g, '')}-${Date.now()}`;

    const documentData = {
      nama: selectedNama,
      kelas: selectedKelas,
      tempatPkl: tempatPklVal,
      tanggal: todayStr,
      waktu: new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB",
      type: activeType,
      gps: gpsCoords.lat ? `${gpsCoords.lat}, ${gpsCoords.lng}` : "Tidak Terdeteksi",
      jurnal: journalVal || "Hadir tepat waktu",
      buktiCode: uniqueStringCode,
      foto: capturedPhotoBase64
    };

    // Push ke Koleksi Firebase "Absensi PKL"
    await addDoc(collection(db, COLLECTION_NAME), documentData);

    // Stop Kamera & Sembunyikan Form
    stopCamera();
    document.getElementById("scanner-container").classList.add("hidden");
    document.getElementById("form-absen-action").classList.add("hidden");
    successContainer.classList.remove("hidden");

    // Dual Opsi Ekspor: Pratinjau (HTML) vs Unduh Langsung (jsPDF)
    document.getElementById("btn-export-slip").onclick = () => {
      printSingleSlipHTML(documentData);
    };
    document.getElementById("btn-download-slip").onclick = () => {
      downloadSinglePDFDirect(documentData);
    };

  } catch (error) {
    console.error("Gagal upload data:", error);
    alert("Gagal melakukan absensi. Periksa koneksi internet Anda.");
    btnSubmit.disabled = false;
    btnSubmit.textContent = "Kirim Data Presensi";
  }
});

// ==========================================
// TAHAP 4: DUAL OPSI EKSPOR PDF & PRATINJAU (FOTO DI-PERBESAR)
// ==========================================

// OPSI A: PRATINJAU & CETAK HTML MANDIRI (FOTO DIPERBESAR - LEBIH PRO)
function printSingleSlipHTML(data) {
  const printWindow = window.open("", "_blank");
  
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cetak Slip Presensi - ${data.nama}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @media print {
          body, div, table, tr, td, th, h1, h2, h3, p, span, img {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body {
            background-color: #ffffff !important;
          }
        }
        /* Memaksa garis tabel tetap solid dan tidak putus-putus */
        table, th, td {
          border-style: solid !important;
          border-color: #cbd5e1 !important;
        }
      </style>
    </head>
    <body class="bg-white p-6 text-slate-800" onload="window.print()">
      <div class="max-w-2xl mx-auto border border-slate-300 rounded-2xl overflow-hidden shadow-sm">
        <!-- Header Slip -->
        <div class="bg-blue-600 p-6 text-white">
          <h1 class="text-xl font-black tracking-wide uppercase">BUKTI RESMI PRESENSI PKL</h1>
          <p class="text-[9px] text-blue-100 font-medium mt-1 leading-tight">KOMPETENSI KEAHLIAN: DESAIN PEMODELAN & INFORMASI BANGUNAN - TEKNIK KONSTRUKSI & PERUMAHAN</p>
        </div>

        <div class="p-6 space-y-6">
          <div class="flex flex-col-reverse sm:flex-row gap-6 justify-between items-start">
            <!-- Rincian Data Siswa -->
            <div class="space-y-3 flex-grow">
              <h2 class="text-xs font-bold text-blue-600 uppercase tracking-wider border-b pb-1">DATA PESERTA PKL</h2>
              <table class="w-full text-xs text-left">
                <tbody>
                  <tr class="border-b border-slate-100"><td class="py-1.5 font-bold text-slate-500 w-32">Nama Lengkap</td><td class="py-1.5 text-slate-800 font-black">${data.nama}</td></tr>
                  <tr class="border-b border-slate-100"><td class="py-1.5 font-bold text-slate-500">Kelas</td><td class="py-1.5 text-slate-800 font-semibold">${data.kelas}</td></tr>
                  <tr class="border-b border-slate-100"><td class="py-1.5 font-bold text-slate-500">Tempat PKL</td><td class="py-1.5 text-slate-800 font-medium">${data.tempatPkl}</td></tr>
                  <tr class="border-b border-slate-100"><td class="py-1.5 font-bold text-slate-500">Tanggal</td><td class="py-1.5 text-slate-800 font-medium">${data.tanggal}</td></tr>
                  <tr class="border-b border-slate-100"><td class="py-1.5 font-bold text-slate-500">Waktu Absen</td><td class="py-1.5 text-slate-800 font-medium">${data.waktu}</td></tr>
                  <tr class="border-b border-slate-100"><td class="py-1.5 font-bold text-slate-500">Status Presensi</td><td class="py-1.5 text-slate-800 font-bold uppercase text-blue-600">${data.type}</td></tr>
                  <tr class="border-b border-slate-100"><td class="py-1.5 font-bold text-slate-500">Koordinat GPS</td><td class="py-1.5 text-slate-800 font-mono text-[10px]">${data.gps}</td></tr>
                  <tr class="border-b border-slate-100"><td class="py-1.5 font-bold text-slate-500">Kode Enkripsi Bukti</td><td class="py-1.5 text-slate-800 font-mono text-[10px] font-bold">${data.buktiCode}</td></tr>
                </tbody>
              </table>
            </div>

            <!-- Foto Lampiran (Potret 3:4 Diperbesar) -->
            <div class="w-36 sm:w-44 shrink-0 flex flex-col items-center">
              ${data.foto === "KOREKSI" ? `
                <!-- Lencana Koreksi Manual Pembimbing -->
                <div class="border-2 border-amber-500 bg-amber-50 text-amber-700 rounded-xl aspect-[3/4] w-full flex flex-col justify-center items-center text-center p-3 font-bold shadow-inner">
                  <i class="fa-solid fa-signature text-3xl mb-2"></i>
                  <span class="text-[9px] uppercase tracking-wider leading-tight">Otorisasi Manual Pembimbing</span>
                </div>
              ` : data.foto ? `
                <div class="border border-slate-300 rounded-lg overflow-hidden shadow-sm aspect-[3/4] w-full bg-slate-100">
                  <img src="${data.foto}" class="w-full h-full object-cover">
                </div>
                <span class="text-[8px] font-bold text-slate-400 mt-1 uppercase tracking-wider">Foto Live Kamera</span>
              ` : `
                <div class="border border-dashed border-slate-300 rounded-lg aspect-[3/4] w-full flex flex-col justify-center items-center text-center p-2 bg-slate-50">
                  <span class="text-[8px] font-bold text-slate-400 leading-tight uppercase">Foto Presensi Tidak Tersedia</span>
                </div>
              `}
            </div>
          </div>

          <!-- Jurnal Kegiatan -->
          <div class="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-1.5">
            <h3 class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ringkasan Kegiatan / Jurnal Harian:</h3>
            <p class="text-xs text-slate-700 italic leading-relaxed font-serif">${data.jurnal}</p>
          </div>
        </div>

        <!-- Footer Slip -->
        <div class="bg-slate-50 border-t p-4 text-center">
          <p class="text-[8px] text-slate-400 font-medium">Dokumen ini dihasilkan secara resmi dan otomatis melalui Sistem Portal Digital PKL Angkatan 2026/2027.</p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  printWindow.document.write(htmlContent);
  printWindow.document.close();
}

// OPSI B: UNDUH PDF LANGSUNG (jsPDF + FOTO DI-PERBESAR)
function downloadSinglePDFDirect(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Header Slip PDF
  doc.setFillColor(37, 99, 235); // Biru Tua
  doc.rect(0, 0, 210, 40, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(18);
  doc.text("BUKTI RESMI PRESENSI PKL", 20, 20);
  
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9);
  doc.text("KOMPETENSI KEAHLIAN: DESAIN PEMODELAN & INFORMASI BANGUNAN - TEKNIK KONSTRUKSI & PERUMAHAN", 20, 28);

  // Content Data
  doc.setTextColor(51, 65, 85);
  doc.setFontSize(11);
  doc.setFont("Helvetica", "bold");
  doc.text("DATA PESERTA PKL", 20, 55);
  doc.line(20, 58, 190, 58);

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(10);
  
  const labelX = 20;
  const valueX = 65;
  
  const rows = [
    ["Nama Lengkap", `: ${data.nama}`],
    ["Kelas", `: ${data.kelas}`],
    ["Tempat PKL", `: ${data.tempatPkl}`],
    ["Tanggal", `: ${data.tanggal}`],
    ["Waktu Absen", `: ${data.waktu}`],
    ["Status Presensi", `: ${data.type}`],
    ["Koordinat GPS", `: ${data.gps}`],
    ["Kode Enkripsi Bukti", `: ${data.buktiCode}`],
  ];

  let currentY = 68;
  rows.forEach(row => {
    doc.text(row[0], labelX, currentY);
    doc.text(row[1], valueX, currentY);
    currentY += 10;
  });

  // FOTO DIPERBESAR DI PDF (Dari 45x45 menjadi 54x72 pas rasio 3:4)
  if (data.foto === "KOREKSI") {
    doc.rect(135, 68, 54, 72);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(7);
    doc.text("OTORISASI MANUAL", 139, 102);
    doc.text("PEMBIMBING", 145, 106);
  } else if (data.foto) {
    try {
      doc.setDrawColor(37, 99, 235);
      doc.setLineWidth(0.5);
      doc.rect(134, 67, 56, 74);
      doc.addImage(data.foto, "JPEG", 135, 68, 54, 72);
    } catch (e) {
      console.error("Gagal menggambar foto pada PDF:", e);
    }
  } else {
    doc.rect(135, 68, 54, 72);
    doc.setFontSize(8);
    doc.text("FOTO PRESENSI", 147, 102);
    doc.text("TIDAK TERSEDIA", 146, 106);
  }

  // Jurnal Harian Box
  currentY += 15;
  doc.setFontSize(10);
  doc.setFont("Helvetica", "bold");
  doc.text("RINGKASAN KEGIATAN / JURNAL:", 20, currentY);
  currentY += 6;
  doc.setFont("Helvetica", "italic");
  const splitText = doc.splitTextToSize(data.jurnal, 170);
  doc.text(splitText, 20, currentY);

  // Footer Slip
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("Dokumen ini dihasilkan secara resmi dan otomatis melalui Sistem Portal Digital PKL Angkatan 2026/2027.", 20, 280);

  doc.save(`Bukti_Absen_${data.nama.replace(/\s+/g, '_')}_${data.tanggal}.pdf`);
}

// Ekspos fungsi pratinjau slip ke window global agar dapat dipicu oleh innerHTML dinamis
window.printSingleSlipHTML = printSingleSlipHTML;

// ==========================================
// TAHAP 5: PANEL PEMBIMBING RAHASIA & POPUP MODAL PIN
// ==========================================

const secretTrigger = document.getElementById("btn-secret-trigger");
const panelPembimbing = document.getElementById("view-pembimbing");
const closePembimbing = document.getElementById("btn-close-pembimbing");

// Elemen-Elemen Modal Autentikasi Baru
const modalAuth = document.getElementById("modal-auth");
const modalAuthSuccess = document.getElementById("modal-auth-success");
const modalAuthError = document.getElementById("modal-auth-error");
const inputPin = document.getElementById("input-pin");
const btnCancelAuth = document.getElementById("btn-cancel-auth");
const btnSubmitAuth = document.getElementById("btn-submit-auth");

// Tampilkan Modal Form Password PIN
secretTrigger.addEventListener("click", () => {
  modalAuth.classList.remove("hidden");
  inputPin.value = "";
  inputPin.focus();
});

// Deteksi Otomatis: Buka kotak PIN jika guru datang dari halaman tutup.html membawa kunci rahasia
if (window.location.search.includes("admin=true")) {
  modalAuth.classList.remove("hidden");
  inputPin.value = "";
  inputPin.focus();
}

btnCancelAuth.addEventListener("click", () => {
  modalAuth.classList.add("hidden");
});

// Verifikasi PIN via Modal Interaktif
async function verifyPinAction() {
  const pin = inputPin.value;
  if (pin === "2026") {
    modalAuth.classList.add("hidden");
    modalAuthSuccess.classList.remove("hidden");
    
    setTimeout(() => {
      modalAuthSuccess.classList.add("hidden");
      panelPembimbing.classList.remove("hidden");
      isRekapTableInitialized = false;
      loadPembimbingData();
    }, 1500);

  } else {
    modalAuth.classList.add("hidden");
    modalAuthError.classList.remove("hidden");
    
    setTimeout(() => {
      modalAuthError.classList.add("hidden");
      modalAuth.classList.remove("hidden");
      inputPin.value = "";
      inputPin.focus();
    }, 1500);
  }
}

btnSubmitAuth.addEventListener("click", verifyPinAction);
inputPin.addEventListener("keyup", (e) => {
  if (e.key === "Enter") verifyPinAction();
});

closePembimbing.addEventListener("click", () => {
  panelPembimbing.classList.add("hidden");
});

// ==========================================
// TAHAP 6: LOGIKA FILTER, PAGINASI, DAN AKUMULASI STATISTIK SISWA [1][2]
// ==========================================

// Paginasi Tanggal (Prev-Next Day)
document.getElementById("btn-prev-day").addEventListener("click", () => {
  const currentDate = new Date(inputTanggalPembimbing.value);
  currentDate.setDate(currentDate.getDate() - 1);
  inputTanggalPembimbing.value = currentDate.toISOString().split("T")[0];
  isRekapTableInitialized = true;
  loadPembimbingData();
});

document.getElementById("btn-next-day").addEventListener("click", () => {
  const currentDate = new Date(inputTanggalPembimbing.value);
  currentDate.setDate(currentDate.getDate() + 1);
  inputTanggalPembimbing.value = currentDate.toISOString().split("T")[0];
  isRekapTableInitialized = true;
  loadPembimbingData();
});

// Listener Filter (Otomatis me-reset halaman aktif ke halaman 1)
["pembimbing-filter-kelas", "pembimbing-date-input", "pembimbing-filter-periode", "pembimbing-search", "pembimbing-filter-status-absen"].forEach(id => {
  document.getElementById(id).addEventListener("change", () => {
    isRekapTableInitialized = true;
    currentPage = 1; // Reset halaman
    loadPembimbingData();
  });
});
document.getElementById("pembimbing-search").addEventListener("input", () => {
  isRekapTableInitialized = true;
  loadPembimbingData();
});

// Handler filter pilihan bulan
document.getElementById("pembimbing-filter-bulan").addEventListener("change", () => {
  isRekapTableInitialized = true;
  loadPembimbingData();
});

// Fungsi Menghitung Seluruh Hari Kalender Aktif (Termasuk Sabtu & Minggu) [2]
function getElapsedCalendarDays(startDateStr, endDateStr) {
  let start = new Date(startDateStr);
  let end = new Date(endDateStr);
  if (end < start) return 0;
  
  const diffTime = Math.abs(end - start);
  // Tambahkan 1 hari agar perhitungannya bersifat inklusif
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays;
}

// Fungsi Menghitung Statistik Kumulatif Siswa dari 15 Juli 2026 s.d Tanggal Filter [2]
// Fungsi Menghitung Statistik Kumulatif (Versi Akurat sesuai Matriks)
function calculateSiswaStats(siswaNama, allRecords, upToDateStr) {
  let limitDate = upToDateStr;
  
  // Menggunakan pengaturan tanggal dari atas
  if (new Date(limitDate) > new Date(PKL_END_DATE)) limitDate = PKL_END_DATE;
  if (new Date(limitDate) < new Date(PKL_START_DATE)) return { hadir: 0, sakit: 0, izin: 0, alpa: 0 };

  const studentRecords = allRecords.filter(r => r.nama === siswaNama && r.tanggal >= PKL_START_DATE && r.tanggal <= limitDate);
  
  // Kelompokkan catatan ke dalam map tanggal
  const recordsByDate = {};
  studentRecords.forEach(r => {
    if (!recordsByDate[r.tanggal]) recordsByDate[r.tanggal] = [];
    recordsByDate[r.tanggal].push(r);
  });

  let hadir = 0, sakit = 0, izin = 0, libur = 0;

  // Evaluasi status paling dominan di setiap harinya
  Object.keys(recordsByDate).forEach(date => {
    const dailyDocs = recordsByDate[date];
    const hasSakit = dailyDocs.find(d => d.type === "Sakit");
    const hasIzin = dailyDocs.find(d => d.type === "Izin");
    const hasLibur = dailyDocs.find(d => d.type === "Libur");
    const hasMasukPulang = dailyDocs.find(d => d.type === "Masuk" || d.type === "Pulang");

    // Jika ada izin/sakit/libur, status itu yang diutamakan dari pada Hadir
    if (hasLibur) libur++;
    else if (hasSakit) sakit++;
    else if (hasIzin) izin++;
    else if (hasMasukPulang) hadir++;
  });
  
  let totalSchoolDays = getElapsedCalendarDays(PKL_START_DATE, limitDate);
  
  // LOGIKA BARU: Jika tanggal yang dicek adalah hari ini, jangan jadikan hari ini sebagai target Alpa
  const todayStr = getTodayString();
  if (limitDate >= todayStr) {
    totalSchoolDays -= 1; // Kurangi 1 hari agar hari ini dimaafkan (belum dihitung Alpa)
  }
  
  let alpa = totalSchoolDays - (hadir + sakit + izin + libur);
  if (alpa < 0) alpa = 0; // Cegah angka minus jika siswa sudah absen hari ini

  return { hadir, sakit, izin, alpa };
}

// Load Seluruh Data Berdasarkan Pilihan Filter
async function loadPembimbingData() {
  const filterKelas = document.getElementById("pembimbing-filter-kelas").value;
  const filterPeriode = document.getElementById("pembimbing-filter-periode").value;
  const filterStatusAbsen = document.getElementById("pembimbing-filter-status-absen").value;
  const filterSearch = document.getElementById("pembimbing-search").value.toLowerCase();
  const selectedDateStr = inputTanggalPembimbing.value;
  const selectedBulan = parseInt(document.getElementById("pembimbing-filter-bulan").value);
  
  const thead = document.getElementById("tabel-rekap-head");
  const tbody = document.getElementById("tabel-rekap-body");

  // Nama Bulan Dinamis
  const namaBulanArr = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const namaBulanTerpilih = namaBulanArr[selectedBulan - 1];

// --- KONTROL NAVIGASI TANGGAL BAWAH (INSTRUKSI BARU) ---
  const dateNavContainer = document.getElementById("pembimbing-date-nav");
  const btnNext = document.getElementById("btn-next-day");
  
  if (dateNavContainer) {
    if (filterPeriode === "bulan") {
      // Sembunyikan navigasi bawah saat Format Bulanan dipilih
      dateNavContainer.classList.add("hidden");
      dateNavContainer.classList.remove("flex", "sm:flex-row");
    } else {
      // Tampilkan kembali saat Format Harian dipilih
      dateNavContainer.classList.remove("hidden");
      dateNavContainer.classList.add("flex", "sm:flex-row");
    }
  }

  if (btnNext) {
    const todayStr = getTodayString();
    // Matikan tombol 'Berikutnya' jika kalender sedang berada di hari ini atau di masa depan
    if (selectedDateStr >= todayStr) {
      btnNext.disabled = true;
      btnNext.classList.add("opacity-50", "cursor-not-allowed");
    } else {
      btnNext.disabled = false;
      btnNext.classList.remove("opacity-50", "cursor-not-allowed");
    }
  }
  // --------------------------------------------------------

  if (!isRekapTableInitialized) {
    thead.innerHTML = "";
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="text-center py-12 text-slate-400">
          <div class="flex flex-col items-center gap-3 max-w-sm mx-auto">
            <div class="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-sm border border-blue-100">
              <i class="fa-solid fa-filter"></i>
            </div>
            <p class="text-xs font-bold text-slate-700">Otentikasi Sukses!</p>
            <p class="text-[10px] text-slate-400">Silakan ubah salah satu filter di atas atau klik tombol di bawah untuk memuat rekap.</p>
            <button id="btn-load-all-today" class="mt-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl text-[10px] transition-all shadow-sm">
              Lihat Seluruh Data Hari Ini
            </button>
          </div>
        </td>
      </tr>
    `;
    document.getElementById("btn-load-all-today").onclick = () => {
      isRekapTableInitialized = true;
      inputTanggalPembimbing.value = getTodayString();
      document.getElementById("pembimbing-filter-kelas").value = "SEMUA";
      document.getElementById("pembimbing-filter-periode").value = "hari";
      document.getElementById("pembimbing-filter-status-absen").value = "SEMUA";
      loadPembimbingData();
    };
    return;
  }
  
  tbody.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner animate-spin"></i> Memuat database presensi...</td></tr>`;

  try {
    const qAll = query(collection(db, COLLECTION_NAME));
    const querySnapshot = await getDocs(qAll);
    let allDbRecords = [];
    querySnapshot.forEach(docSnap => { allDbRecords.push(docSnap.data()); });

    // === MENYARING SELURUH SISWA (TANPA PAGINASI) ===
    let matchingStudents = [];
    const kelasList = filterKelas === "SEMUA" ? Object.keys(DATA_SISWA) : [filterKelas];

    kelasList.forEach(kelas => {
      DATA_SISWA[kelas].forEach(siswaNama => {
        if (filterSearch && !siswaNama.toLowerCase().includes(filterSearch)) return;

        if (filterPeriode === "hari") {
          const recordMasuk = allDbRecords.find(r => r.nama === siswaNama && r.type === "Masuk" && r.tanggal === selectedDateStr);
          const recordPulang = allDbRecords.find(r => r.nama === siswaNama && r.type === "Pulang" && r.tanggal === selectedDateStr);
          const recordIzin = allDbRecords.find(r => r.nama === siswaNama && ["Sakit", "Izin", "Libur"].includes(r.type) && r.tanggal === selectedDateStr);
          const isSudahAbsen = (recordMasuk || recordPulang || recordIzin);

          if (filterStatusAbsen === "SUDAH" && !isSudahAbsen) return;
          if (filterStatusAbsen === "BELUM" && isSudahAbsen) return;
        }
        matchingStudents.push({ nama: siswaNama, kelas: kelas });
      });
    });

    tbody.innerHTML = "";
    let globalNo = 1;

    if (matchingStudents.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-slate-400">Tidak ada data siswa yang cocok dengan kriteria pencarian.</td></tr>`;
      thead.innerHTML = "";
      return;
    }

    if (filterPeriode === "hari") {
      // ==== TABEL HARIAN ====
      thead.innerHTML = `
        <tr class="border-b border-slate-100 text-[9px] font-bold uppercase text-slate-400 bg-slate-50/30">
          <th class="py-2.5 px-2 w-10 text-center">No</th>
          <th class="py-2.5 px-3 w-44">Nama Lengkap</th>
          <th class="py-2.5 px-3">Tempat PKL</th>
          <th class="py-2.5 px-2 w-16 text-center">Datang</th>
          <th class="py-2.5 px-2 w-16 text-center">Pulang</th>
          <th class="py-2.5 px-2 w-16 text-center">S/I/A/L</th>
          <th class="py-2.5 px-1.5 w-10 text-center bg-blue-50/50 text-blue-600">H</th>
          <th class="py-2.5 px-1.5 w-10 text-center bg-emerald-50/50 text-emerald-600">S</th>
          <th class="py-2.5 px-1.5 w-10 text-center bg-amber-50/50 text-amber-600">I</th>
          <th class="py-2.5 px-1.5 w-10 text-center bg-rose-50/50 text-rose-600">A</th>
          <th class="py-2.5 px-3 w-32 text-center">Bukti Slip</th>
        </tr>
      `;

      matchingStudents.forEach(siswa => {
        const siswaNama = siswa.nama;
        const kelas = siswa.kelas;

        const recordMasuk = allDbRecords.find(r => r.nama === siswaNama && r.type === "Masuk" && r.tanggal === selectedDateStr);
        const recordPulang = allDbRecords.find(r => r.nama === siswaNama && r.type === "Pulang" && r.tanggal === selectedDateStr);
        const recordIzin = allDbRecords.find(r => r.nama === siswaNama && ["Sakit", "Izin", "Libur"].includes(r.type) && r.tanggal === selectedDateStr);
        const stats = calculateSiswaStats(siswaNama, allDbRecords, selectedDateStr);
        
        const currentPlace = recordMasuk?.tempatPkl || recordPulang?.tempatPkl || recordIzin?.tempatPkl || "-";
        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50/50 transition-colors text-slate-700 border-b border-slate-100/50 text-[11px]";

        const todayStr = getTodayString();
        const isToday = (selectedDateStr === todayStr);

        let iconDatang = `<span class="text-slate-300 font-bold">-</span>`;
        let iconPulang = `<span class="text-slate-300 font-bold">-</span>`;
        let labelStatus = "";
        let colorStatus = "";
        let linkToRender = [];

        if (recordIzin && recordIzin.type === "Libur") {
          labelStatus = "LIBUR"; colorStatus = "text-slate-500 bg-slate-100 border-slate-300";
        } else if (recordIzin && !recordMasuk) {
          labelStatus = recordIzin.type.toUpperCase();
          colorStatus = recordIzin.type === "Sakit" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-amber-700 bg-amber-50 border-amber-200";
          linkToRender.push({ label: recordIzin.type, data: recordIzin });
        } else if (recordMasuk && recordIzin) {
          labelStatus = recordIzin.type.toUpperCase();
          colorStatus = recordIzin.type === "Sakit" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-amber-700 bg-amber-50 border-amber-200";
          iconDatang = `<i class="fa-solid fa-circle-check text-emerald-500 text-sm"></i> <span class="text-[8px] text-emerald-600 font-bold">${recordMasuk.waktu.split(" ")[0]}</span>`;
          let pColor = recordIzin.type === "Sakit" ? "text-emerald-500" : "text-amber-500";
          iconPulang = `<i class="fa-solid fa-circle-info ${pColor} text-sm"></i> <span class="text-[8px] ${pColor} font-bold">${recordIzin.type}</span>`;
          linkToRender.push({ label: "Datang", data: recordMasuk }); linkToRender.push({ label: recordIzin.type, data: recordIzin });
        } else if (recordMasuk && recordPulang) {
          labelStatus = "HADIR"; colorStatus = "text-blue-700 bg-blue-50 border-blue-200";
          iconDatang = `<i class="fa-solid fa-circle-check text-emerald-500 text-sm"></i> <span class="text-[8px] text-emerald-600 font-bold">${recordMasuk.waktu.split(" ")[0]}</span>`;
          iconPulang = `<i class="fa-solid fa-circle-check text-emerald-500 text-sm"></i> <span class="text-[8px] text-emerald-600 font-bold">${recordPulang.waktu.split(" ")[0]}</span>`;
          linkToRender.push({ label: "Datang", data: recordMasuk }); linkToRender.push({ label: "Pulang", data: recordPulang });
        } else if (recordMasuk && !recordPulang) {
          iconDatang = `<i class="fa-solid fa-circle-check text-emerald-500 text-sm"></i> <span class="text-[8px] text-emerald-600 font-bold">${recordMasuk.waktu.split(" ")[0]}</span>`;
          if (isToday) {
            iconPulang = `<i class="fa-solid fa-triangle-exclamation text-amber-500 text-sm"></i>`;
            labelStatus = "BELUM LENGKAP"; colorStatus = "text-amber-600 bg-amber-50 border-amber-200";
          } else {
            iconPulang = `<i class="fa-solid fa-circle-xmark text-rose-500 text-sm"></i>`;
            labelStatus = "ALPA"; colorStatus = "text-rose-700 bg-rose-50 border-rose-200";
          }
          linkToRender.push({ label: "Datang", data: recordMasuk });
        } else {
          if (isToday) {
            iconDatang = `<i class="fa-solid fa-triangle-exclamation text-amber-500 text-sm"></i>`;
            iconPulang = `<i class="fa-solid fa-triangle-exclamation text-amber-500 text-sm"></i>`;
            labelStatus = "BELUM LENGKAP"; colorStatus = "text-amber-600 bg-amber-50 border-amber-200";
          } else {
            iconDatang = `<i class="fa-solid fa-circle-xmark text-rose-500 text-sm"></i>`;
            iconPulang = `<i class="fa-solid fa-circle-xmark text-rose-500 text-sm"></i>`;
            labelStatus = "ALPA"; colorStatus = "text-rose-700 bg-rose-50 border-rose-200";
          }
        }

        tr.innerHTML = `
          <td class="py-3 px-2 text-center font-bold text-slate-400">${globalNo++}</td>
          <td class="py-3 px-3 font-semibold text-slate-800">${siswaNama} <div class="text-[8px] text-slate-400 font-normal">${kelas}</div></td>
          <td class="py-3 px-3 font-medium text-slate-600">${currentPlace}</td>
          <td class="py-3 px-2 text-center"><div class="flex flex-col items-center justify-center gap-0.5">${iconDatang}</div></td>
          <td class="py-3 px-2 text-center"><div class="flex flex-col items-center justify-center gap-0.5">${iconPulang}</div></td>
          <td class="py-3 px-2 text-center"><span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded border ${colorStatus} uppercase">${labelStatus}</span></td>
          <td class="py-3 px-1.5 text-center bg-blue-50/20 font-black text-blue-600 border-x border-slate-100">${stats.hadir}</td>
          <td class="py-3 px-1.5 text-center bg-emerald-50/20 font-black text-emerald-600 border-r border-slate-100">${stats.sakit}</td>
          <td class="py-3 px-1.5 text-center bg-amber-50/20 font-black text-amber-600 border-r border-slate-100">${stats.izin}</td>
          <td class="py-3 px-1.5 text-center bg-rose-50/20 font-black text-rose-600 border-r border-slate-100">${stats.alpa}</td>
        `;

        const tdBukti = document.createElement("td");
        tdBukti.className = "py-3 px-3 text-center";
        const wrapperLink = document.createElement("div");
        wrapperLink.className = "flex flex-col gap-1 items-center justify-center";
        if (linkToRender.length > 0) {
          linkToRender.forEach(link => {
            const btn = document.createElement("button");
            btn.className = "text-[9px] text-blue-600 hover:text-blue-800 font-bold underline block truncate max-w-[100px]";
            btn.textContent = `${link.label}: ${link.data.buktiCode}`;
            btn.title = `Pratinjau Absen ${link.label}`;
            btn.onclick = () => printSingleSlipHTML(link.data);
            wrapperLink.appendChild(btn);
          });
        } else {
          wrapperLink.innerHTML = `<span class="text-slate-300">-</span>`;
        }
        tdBukti.appendChild(wrapperLink);
        tr.appendChild(tdBukti);
        tbody.appendChild(tr);
      });

    } else {
      // ==== TABEL BULANAN ====
      const daysInMonth = new Date(2026, selectedBulan, 0).getDate();
      let headerDatesHTML = "";
      for (let d = 1; d <= daysInMonth; d++) {
        headerDatesHTML += `<th class="py-2 w-6 text-center border-r border-slate-200/50">${d}</th>`;
      }

      thead.innerHTML = `
        <tr class="border-b border-slate-200 bg-slate-100">
          <th colspan="2" class="py-2 px-2 text-center border-r border-slate-200/50"></th>
          <th colspan="${daysInMonth}" class="py-2 text-center text-[11px] font-black uppercase text-blue-800 tracking-widest border-r border-slate-200/50">REKAPITULASI BULAN ${namaBulanTerpilih.toUpperCase()} 2026</th>
          <th colspan="4" class="py-2 text-center text-[10px] font-black uppercase text-slate-700">TOTAL KUMULATIF</th>
        </tr>
        <tr class="border-b border-slate-200 text-[8px] font-black uppercase text-slate-400 bg-slate-50/40">
          <th class="py-2.5 px-2 w-10 text-center border-r border-slate-200/50">No</th>
          <th class="py-2.5 px-3 w-40 border-r border-slate-200/50">Nama & Kelas</th>
          ${headerDatesHTML}
          <th class="py-2.5 w-8 text-center bg-blue-50 text-blue-600 border-r border-slate-200/50">H</th>
          <th class="py-2.5 w-8 text-center bg-emerald-50 text-emerald-600 border-r border-slate-200/50">S</th>
          <th class="py-2.5 w-8 text-center bg-amber-50 text-amber-600 border-r border-slate-200/50">I</th>
          <th class="py-2.5 w-8 text-center bg-rose-50 text-rose-600">A</th>
        </tr>
      `;

      matchingStudents.forEach(siswa => {
        const siswaNama = siswa.nama;
        const kelas = siswa.kelas;

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50/50 transition-colors text-slate-700 border-b border-slate-200/50 text-[10px]";

        let rowDaysHTML = "";
        let hadirCount = 0, sakitCount = 0, izinCount = 0, liburCount = 0, alpaCount = 0;

        for (let d = 1; d <= daysInMonth; d++) {
          const dayStr = String(d).padStart(2, '0');
          const monthStr = String(selectedBulan).padStart(2, '0');
          const currentDateLoopStr = `2026-${monthStr}-${dayStr}`;

          const recordMasuk = allDbRecords.find(r => r.nama === siswaNama && r.type === "Masuk" && r.tanggal === currentDateLoopStr);
          const recordPulang = allDbRecords.find(r => r.nama === siswaNama && r.type === "Pulang" && r.tanggal === currentDateLoopStr);
          const recordIzin = allDbRecords.find(r => r.nama === siswaNama && ["Sakit", "Izin", "Libur"].includes(r.type) && r.tanggal === currentDateLoopStr);

          let symbol = "-";
          let colorClass = "text-slate-300";

          if (currentDateLoopStr < PKL_START_DATE || currentDateLoopStr > PKL_END_DATE) {
            symbol = "-";
          } else if (recordIzin) {
            if (recordIzin.type === "Sakit") { symbol = "S"; colorClass = "text-emerald-600 font-bold"; sakitCount++; }
            if (recordIzin.type === "Izin") { symbol = "I"; colorClass = "text-amber-500 font-bold"; izinCount++; }
            if (recordIzin.type === "Libur") { symbol = "L"; colorClass = "text-slate-500 font-bold"; liburCount++; }
          } else if (recordMasuk || recordPulang) {
            symbol = `<i class="fa-solid fa-check text-blue-600 text-[10px]"></i>`;
            colorClass = "";
            hadirCount++;
          } else {
            const todayStr = getTodayString();
            if (currentDateLoopStr < todayStr) {
              symbol = "A"; colorClass = "text-rose-600 font-black"; alpaCount++;
            }
          }
          rowDaysHTML += `<td class="py-2.5 text-center border-r border-slate-200/50 ${colorClass}">${symbol}</td>`;
        }

        tr.innerHTML = `
          <td class="py-2.5 text-center font-bold text-slate-400 border-r border-slate-200/50">${globalNo++}</td>
          <td class="py-2.5 px-2 font-semibold text-slate-800 border-r border-slate-200/50">${siswaNama} <div class="text-[8px] text-slate-400 font-normal">${kelas}</div></td>
          ${rowDaysHTML}
          <td class="py-2.5 text-center bg-blue-50/30 font-black text-blue-600 border-r border-slate-200/50">${hadirCount}</td>
          <td class="py-2.5 text-center bg-emerald-50/30 font-black text-emerald-600 border-r border-slate-200/50">${sakitCount}</td>
          <td class="py-2.5 text-center bg-amber-50/30 font-black text-amber-600 border-r border-slate-200/50">${izinCount}</td>
          <td class="py-2.5 text-center bg-rose-50/30 font-black text-rose-600">${alpaCount}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (error) { console.error("Gagal memuat rekap:", error); }
}

// Handler Filter & Pencarian Admin
document.getElementById("pembimbing-filter-kelas").addEventListener("change", loadPembimbingData);
document.getElementById("pembimbing-filter-periode").addEventListener("change", loadPembimbingData);
document.getElementById("pembimbing-search").addEventListener("input", loadPembimbingData);
document.getElementById("pembimbing-filter-bulan").addEventListener("change", loadPembimbingData);

// ==========================================
// TAHAP 7: PRINT REKAP KELAS HTML
// ==========================================
document.getElementById("btn-export-rekap").addEventListener("click", () => {
  const filterKelas = document.getElementById("pembimbing-filter-kelas").value;
  const filterPeriode = document.getElementById("pembimbing-filter-periode").value;
  const searchVal = document.getElementById("pembimbing-search").value;
  const selectedDateStr = inputTanggalPembimbing.value;
  
  const printWindow = window.open("", "_blank");

  const theadHTML = document.getElementById("tabel-rekap-head").innerHTML;
  const tbodyHTML = document.getElementById("tabel-rekap-body").innerHTML;

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Laporan Rekapitulasi PKL - Kelas ${filterKelas}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @media print {
          body, div, table, tr, td, th, h1, h2, h3, p, span {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
        /* Penguat garis solid untuk hasil cetak tabel lebar */
        table, th, td {
          border-style: solid !important;
          border-color: #cbd5e1 !important;
        }
      </style>
    </head>
    <body class="bg-white p-6 text-slate-800" onload="window.print()">
      <div class="max-w-6xl mx-auto space-y-6">
        <!-- Header Laporan -->
        <div class="border-b-2 border-slate-800 pb-4">
          <h1 class="text-xl font-black uppercase text-slate-900">LAPORAN REKAPITULASI PRESENSI PKL</h1>
          <p class="text-xs text-slate-500 mt-1 font-semibold uppercase">
            KELAS: ${filterKelas} | PERIODE: ${filterPeriode.toUpperCase()} | TANGGAL FILTER: ${selectedDateStr} | PENCARIAN: ${searchVal || "SEMUA"}
          </p>
          <p class="text-[10px] text-slate-400 mt-0.5">Tanggal Cetak Laporan: ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</p>
          <p class="text-[9px] text-slate-400 italic">Akumulasi dihitung sejak masa mulai PKL: 15 Juli 2026 s.d target filter.</p>
        </div>

        <!-- Tabel Laporan Cetak -->
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border border-slate-300">
            <thead class="bg-slate-100 border-b border-slate-200">
              ${theadHTML}
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${tbodyHTML}
            </tbody>
          </table>
        </div>

        <!-- Tanda Tangan Pembimbing -->
        <div class="flex justify-end pt-12">
          <div class="text-center w-48 space-y-16">
            <p class="text-xs font-semibold text-slate-700">Pembimbing PKL,</p>
            <div class="border-b border-slate-400 w-full"></div>
            <p class="text-[10px] font-bold text-slate-500 uppercase">NIP. .............................</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  printWindow.document.write(htmlContent);
  printWindow.document.close();
});

// =======================================================
// LOGIKA OPERASIONAL MODAL KOREKSI PRESENSI (KATA SANDI "change")
// =======================================================
const btnOpenCorrection = document.getElementById("btn-open-correction");
const modalCorrection = document.getElementById("modal-correction");
const btnCancelCorrection = document.getElementById("btn-cancel-correction");
const selectSiswaKoreksi = document.getElementById("correction-select-siswa");
const formCorrection = document.getElementById("form-correction");

// Tanggal default form koreksi diisi hari ini
document.getElementById("correction-date").value = getTodayString();

// Buka Modal & Load Dropdown Nama Siswa Lengkap
if (btnOpenCorrection) {
  btnOpenCorrection.addEventListener("click", () => {
    modalCorrection.classList.remove("hidden");
    selectSiswaKoreksi.innerHTML = '<option value="">-- Pilih Nama Siswa --</option>';
    
    // Gabungkan seluruh siswa dari datasiswa.js ke dropdown koreksi
    Object.keys(DATA_SISWA).forEach(kelas => {
      DATA_SISWA[kelas].forEach(nama => {
        const opt = document.createElement("option");
        opt.value = `${nama}|${kelas}`;
        opt.textContent = `${nama} (${kelas})`;
        selectSiswaKoreksi.appendChild(opt);
      });
    });
  });
}

btnCancelCorrection.addEventListener("click", () => {
  modalCorrection.classList.add("hidden");
  formCorrection.reset();
});

// Otomatisasi pengisian default waktu saat tipe koreksi berubah
document.getElementById("correction-type").addEventListener("change", (e) => {
  const waktuInput = document.getElementById("correction-waktu");
  if (e.target.value === "Masuk") waktuInput.value = "08:00:00 WIB";
  else if (e.target.value === "Pulang") waktuInput.value = "17:00:00 WIB";
  else waktuInput.value = "00:00:00 WIB";
});

// Submit Data Koreksi ke Firestore
formCorrection.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const siswaVal = selectSiswaKoreksi.value;
  const tanggalVal = document.getElementById("correction-date").value;
  const tempatVal = document.getElementById("correction-tempat").value;
  const typeVal = document.getElementById("correction-type").value;
  const waktuVal = document.getElementById("correction-waktu").value;
  const jurnalVal = document.getElementById("correction-jurnal").value;
  const passwordVal = document.getElementById("correction-password").value;

  // Proteksi Kata Sandi Otorisasi Perubahan
  if (passwordVal !== "change") {
    alert("Gagal: Kata sandi otorisasi perubahan salah!");
    return;
  }

  const [namaSiswa, kelasSiswa] = siswaVal.split("|");
  const uniqueCodeKoreksi = `KOR-${kelasSiswa.replace(/\s+/g, '')}-${Date.now()}`;

  try {
    const docKoreksi = {
      nama: namaSiswa,
      kelas: kelasSiswa,
      tempatPkl: tempatVal,
      tanggal: tanggalVal,
      waktu: waktuVal + " (Koreksi)",
      type: typeVal,
      gps: "Disetujui Manual (Tanpa GPS)",
      jurnal: jurnalVal || `Disetujui melalui Otorisasi Manual Pembimbing.`,
      buktiCode: uniqueCodeKoreksi,
      foto: "KOREKSI" // Nilai penanda otorisasi manual
    };

    await addDoc(collection(db, COLLECTION_NAME), docKoreksi);
    
    alert("Otorisasi Sukses: Data koreksi berhasil disimpan!");
    modalCorrection.classList.add("hidden");
    formCorrection.reset();
    
    // Memuat ulang data rekap
    isRekapTableInitialized = true;
    loadPembimbingData();

  } catch (err) {
    console.error("Gagal menyimpan koreksi manual:", err);
    alert("Gagal menyimpan data ke database. Coba lagi.");
  }
});
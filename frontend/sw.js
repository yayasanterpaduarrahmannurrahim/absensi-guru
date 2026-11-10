/**
 * sw.js — Service Worker: menyimpan tampilan aplikasi (app shell) di perangkat
 * agar cepat dibuka dan tetap tampil saat sinyal lemah.
 *
 * Yang TIDAK pernah disimpan: permintaan ke backend (script.google.com) dan login Google.
 * Absensi selalu membutuhkan koneksi karena jam & lokasi diverifikasi server.
 *
 * Saat merilis versi baru: naikkan VERSION di sini DAN ?v= di index.html (harus sama).
 */
const VERSION = '1.1.0';
const SHELL_CACHE = 'absensi-shell-' + VERSION;
const RUNTIME_CACHE = 'absensi-runtime-v1';
const V = '?v=' + VERSION;

const SHELL = [
  './', './index.html', './privacy.html', './panduan.html', './favicon.svg', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './css/app.css' + V,
  './js/config.js' + V, './js/api.js' + V, './js/ui.js' + V, './js/brand.js' + V, './js/geo.js' + V,
  './js/pwa.js' + V, './js/leave.js' + V, './js/guru.js' + V, './js/admin.js' + V, './js/app.js' + V,
];

// Domain pihak ketiga statis yang aman disimpan (ikon, font, modul Excel).
const CDN_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)));
  // Tidak langsung aktif: pengguna diberi tahu "Versi baru tersedia" lalu memilih memuat ulang.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('absensi-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Halaman: utamakan jaringan (agar selalu versi terbaru), cadangan dari cache saat offline.
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    // Halaman .html lain (privacy, panduan) disimpan dengan namanya sendiri; selain itu = aplikasi.
    const page = /\/([a-z0-9-]+\.html)$/i.exec(url.pathname);
    const key = page && page[1] !== 'index.html' ? './' + page[1] : './index.html';
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) (await caches.open(SHELL_CACHE)).put(key, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(key);
        return cached || Response.error();
      }
    })());
    return;
  }

  // Aset aplikasi sendiri: dari cache dulu (berkas sudah berversi ?v=).
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) (await caches.open(RUNTIME_CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

  // CDN statis: tampilkan dari cache sambil memperbarui di latar belakang.
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })());
  }
  // Selain itu (backend Apps Script, login Google): biarkan browser menangani langsung.
});

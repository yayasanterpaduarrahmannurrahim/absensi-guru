# Sistem Informasi Absensi Guru

Aplikasi absensi guru berbasis PWA dengan validasi lokasi GPS. Seluruh infrastruktur gratis:
Google Apps Script, Google Sheets, Google Drive, dan GitHub Pages.

## Arsitektur

```
 HP Guru / Admin (PWA)                      Akun Google sekolah (pemilik)
┌────────────────────────┐   HTTPS POST   ┌───────────────────────────────┐
│ GitHub Pages           │  JSON (text/   │ Google Apps Script Web App    │
│ HTML + CSS + JS        │  plain)        │  Api.gs   router + hak akses  │
│ Service Worker, Manifest├──────────────►│  Auth.gs  verifikasi Google   │
│ Sign in with Google    │                │  Absensi  validasi GPS ulang  │
│ Geolocation API        │◄───────────────┤  LockService (anti bentrok)   │
└────────────────────────┘   { ok, data } └──────────────┬────────────────┘
                                                         │ SpreadsheetApp
                                          ┌──────────────▼────────────────┐
                                          │ Google Sheets (privat)        │
                                          │ USERS ABSENSI PENGAJUAN       │
                                          │ SETTINGS AUDIT_LOG SESSIONS   │
                                          └───────────────────────────────┘
```

- **Frontend** di GitHub Pages: dapat diinstal (manifest, Service Worker, standalone,
  splash screen). Frontend tidak pernah menyimpan Spreadsheet ID atau kredensial.
- **Backend** Apps Script dijalankan sebagai pemilik ("Execute as: Me"), jadi guru
  **tidak pernah** mendapat akses ke Google Sheets.
- **Login** memakai akun Google masing-masing guru. Backend memverifikasi ID token Google,
  lalu mencocokkan email dengan sheet USERS. Hanya email yang didaftarkan admin yang bisa masuk.
- **Jam absensi** selalu diambil dari waktu server (WIB), bukan dari jam HP.
- **Lokasi** dihitung di frontend untuk tampilan real-time, lalu **dihitung ulang di backend**
  (Haversine) sebelum disimpan.

### Batasan GPS (jujur)

GPS dari browser **tidak kebal** terhadap aplikasi pemalsu lokasi (*fake GPS*). Sistem ini
menolak akurasi yang buruk, menghitung ulang jarak di server, dan mencatat anomali
(misalnya akurasi yang terlalu sempurna, lompatan lokasi yang mustahil, atau koordinat yang
identik berulang) ke kolom `anomali` untuk ditinjau admin. Pemeriksaan ini mempersulit
kecurangan, tetapi tidak bisa menjamin 100%.

## Struktur folder

```
backend/        Kode Google Apps Script (dipush dengan clasp)
  Config.gs     konstanta, skema sheet, pengaturan default
  Utils.gs      waktu WIB, ID, hash, LockService
  Db.gs         akses data Sheets (baca/cari/tambah/ubah/hapus)
  Settings.gs   pembacaan pengaturan + cache
  Audit.gs      pencatatan AUDIT_LOG
  Api.gs        doGet/doPost + router aksi
  Setup.gs      pembuatan struktur database
  Tests.gs      pengujian per tahap
frontend/       PWA untuk GitHub Pages (mulai Tahap 2)
docs/           panduan deployment & konfigurasi
```

## Struktur Google Sheets

| Sheet | Kolom |
|---|---|
| USERS | user_id, nama_guru, email, nip, jenjang (TK/SD), role, status_akun, created_at, updated_at, last_login |
| ABSENSI | attendance_id, user_id, nama_guru, tanggal, jam_masuk, latitude_masuk, longitude_masuk, accuracy_masuk, jarak_masuk, jam_pulang, latitude_pulang, longitude_pulang, accuracy_pulang, jarak_pulang, status, keterangan, anomali, created_at, updated_at |
| PENGAJUAN | submission_id, user_id, nama_guru, jenis_pengajuan, tanggal_mulai, tanggal_selesai, alasan, bukti_url, status_persetujuan, catatan_admin, diproses_oleh, diproses_at, created_at |
| SETTINGS | key, value, keterangan (satu baris per pengaturan) |
| AUDIT_LOG | log_id, waktu, user_id, aktivitas, detail |
| SESSIONS | token_hash, user_id, role, created_at, expires_at |

Perbedaan dari rancangan awal:
- `username` dan `password_hash` diganti `email`, karena login memakai akun Google.
- PENGAJUAN memakai `tanggal_mulai` dan `tanggal_selesai`, sehingga sakit beberapa hari cukup diajukan sekali.
- SETTINGS berbentuk key-value supaya pengaturan baru bisa ditambah tanpa mengubah struktur.
- Sheet SESSIONS menyimpan **hash** token sesi, bukan tokennya.

## Tahapan

| Tahap | Isi | Status |
|---|---|---|
| 1 | Struktur Google Sheets & backend dasar | Selesai — 11/11 tes lulus, Web App ter-deploy (2026-10-31) |
| 2 | Login Google admin & guru, sesi, kelola pengguna | Selesai — 10/10 tes lulus, uji login manual sesuai (2026-10-31) |
| 3 | Validasi GPS radius | Selesai — 11/11 tes, uji di lokasi uji sesuai (2026-10-31) |
| 4 | Absen masuk & pulang, pengaturan jam kerja | Selesai — tes & uji aplikasi sesuai (2026-10-31) |
| 5 | Izin/sakit, bukti Drive, Tanpa Keterangan otomatis | Selesai — 10/10 tes & uji aplikasi sesuai (2026-10-31) |
| 6 | Dashboard admin & guru, rekap, koreksi, log | Ter-deploy, menunggu runTahap6Tests & uji aplikasi |
| 7 | Laporan & ekspor Excel/CSV | — |
| 8 | PWA | — |
| 9 | Pengujian keamanan & beban | — |

Panduan: [docs/PANDUAN-DEPLOY.md](docs/PANDUAN-DEPLOY.md)

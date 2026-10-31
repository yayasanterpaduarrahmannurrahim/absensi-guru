# Panduan Deployment

Semua langkah dilakukan dengan akun Google sekolah (pemilik aplikasi).
**Jangan pernah membagikan password akun Google kepada siapa pun**, termasuk kepada
pengembang atau AI. Password tidak dibutuhkan untuk langkah mana pun di bawah ini.

---

## Tahap 1 — Backend & database

### 1. Aktifkan Google Apps Script API (sekali saja)

1. Buka https://script.google.com/home/usersettings dengan akun Google sekolah.
2. Ubah **Google Apps Script API** menjadi **On**.

### 2. Login clasp (sekali saja)

Di terminal, dari folder project:

```
clasp login
```

Browser akan terbuka. Pilih akun Google sekolah, lalu klik **Allow**. Kredensial clasp
disimpan di `C:\Users\<nama>\.clasprc.json`. Jangan bagikan file itu.

### 3. Buat project Apps Script & push kode

```
clasp create-script --type standalone --title "Absensi Guru - Backend" --rootDir backend
clasp push
```

Perintah `create-script` cukup dijalankan sekali. Perintah ini membuat file `.clasp.json`
yang berisi scriptId. Setiap kali kode diperbarui, cukup jalankan `clasp push`.

> Perhatian: `create-script` menimpa `backend/appsscript.json` dengan versi bawaan Google
> (zona waktu America/New_York). Kembalikan file itu ke versi di repo (`Asia/Jakarta`),
> lalu jalankan `clasp push` lagi.

### 4. Jalankan setup database

1. Jalankan `clasp open-script` atau buka https://script.google.com, lalu pilih project
   **Absensi Guru - Backend**.
2. Buka file `Setup.gs`, pilih fungsi **setup** di toolbar, lalu klik **Run**.
3. Saat diminta izin, klik **Review permissions**, pilih akun sekolah, lalu klik
   **Advanced > Go to Absensi Guru - Backend (unsafe) > Allow**. Peringatan "unsafe"
   muncul karena aplikasinya buatan sendiri dan belum diverifikasi Google. Itu normal.
4. Di **Execution log** akan muncul:
   - `Spreadsheet: https://docs.google.com/spreadsheets/d/...` (database baru di Drive Anda)
   - `Admin pertama dibuat: <email akun sekolah>`

`setup()` aman dijalankan ulang. Data lama tidak akan terhapus.

### 5. Jalankan pengujian Tahap 1

Buka `Tests.gs`, pilih fungsi **runTahap1Tests**, lalu klik **Run**. Semua baris harus
`[LULUS]` dan baris terakhir `Hasil: 11/11 lulus.`

### 6. Deploy sebagai Web App

1. Di editor, klik **Deploy > New deployment**, lalu pilih tipe **Web app**.
2. Isi **Execute as: Me**, lalu **Who has access: Anyone**.
3. Klik **Deploy** dan salin **Web app URL** (berakhiran `/exec`).
4. Uji di browser: `<Web app URL>?action=ping`. Hasilnya harus berupa JSON
   `{"ok":true,"data":{"app":"Absensi Guru",...,"timezone":"Asia/Jakarta"}}`.

> "Anyone" berarti URL API dapat dipanggil tanpa login Google. Ini diperlukan agar
> frontend GitHub Pages bisa berkomunikasi. Data **tidak** terbuka: semua aksi selain
> `ping` dan `getPublicConfig` akan mewajibkan sesi login yang diverifikasi backend.

**Memperbarui deployment** setelah `clasp push`: **Deploy > Manage deployments**, klik ikon
pensil, pilih **Version: New version**, lalu **Deploy**. Dengan cara ini URL `/exec` tetap sama.

---

## Konfigurasi Spreadsheet ID

Spreadsheet ID disimpan di **Script Properties**, bukan di kode, dan tidak pernah dikirim
ke frontend.

- **Otomatis:** `setup()` membuat spreadsheet baru dan menyimpan ID-nya sendiri.
- **Memakai spreadsheet yang sudah ada:** di editor Apps Script, buka **Project Settings
  (ikon gerigi) > Script Properties > Add script property**. Isi Property
  `SPREADSHEET_ID` dan Value berupa bagian URL spreadsheet di antara `/d/` dan `/edit`.
  Setelah itu jalankan `setup()`.

Jangan bagikan spreadsheet kepada guru. Backend mengaksesnya atas nama pemilik.

## Mendapatkan koordinat sekolah

1. Buka Google Maps di HP atau PC.
2. Tekan lama (HP) atau klik kanan (PC) **titik tengah area sekolah**, misalnya halaman
   utama atau ruang guru.
3. Koordinat seperti `-6.2088123, 106.8456789` akan muncul. Angka pertama adalah
   **latitude**, angka kedua **longitude**.
4. Untuk sementara, isi koordinat di sheet SETTINGS pada baris `school_latitude` dan
   `school_longitude`. Mulai Tahap 6, koordinat bisa diubah dari halaman Pengaturan Admin.
   Gunakan titik desimal, bukan koma.

## Mengatur radius 50 meter

Baris `radius_meter` di SETTINGS berisi `50` secara default. Pilih titik pusat yang
benar-benar berada di tengah area sekolah. Jika gedung sekolah lebih panjang dari 100 meter,
naikkan radius secukupnya, karena GPS di dalam gedung bisa meleset 10–30 meter.
Baris `max_accuracy_meter` (default `30`) menentukan akurasi GPS terburuk yang masih diterima.

---

## Tahap 2 — Google Cloud & GitHub (disiapkan nanti)

Login Google membutuhkan **OAuth Client ID** dari project Google Cloud Anda, dan Client ID
membutuhkan alamat GitHub Pages. Panduan lengkapnya akan ditambahkan di Tahap 2.

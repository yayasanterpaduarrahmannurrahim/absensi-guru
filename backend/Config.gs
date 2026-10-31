/**
 * Config.gs — Konstanta global: identitas aplikasi, nama sheet, skema kolom,
 * enum status, dan nilai default pengaturan.
 *
 * Tidak ada data sensitif di file ini. Spreadsheet ID disimpan di
 * Script Properties (Project Settings > Script Properties), bukan di kode.
 */

const APP = Object.freeze({
  NAME: 'Absensi Guru',
  VERSION: '0.1.0',
  TIMEZONE: 'Asia/Jakarta',
  PROP_SPREADSHEET_ID: 'SPREADSHEET_ID',
  LOCK_TIMEOUT_MS: 15000,
  MAX_REQUEST_BYTES: 100 * 1024,
});

const SHEETS = Object.freeze({
  USERS: 'USERS',
  ABSENSI: 'ABSENSI',
  PENGAJUAN: 'PENGAJUAN',
  SETTINGS: 'SETTINGS',
  AUDIT_LOG: 'AUDIT_LOG',
  SESSIONS: 'SESSIONS',
});

const ROLES = Object.freeze({ ADMIN: 'admin', GURU: 'guru' });

/** Jenjang tempat guru mengajar. Admin yayasan boleh kosong. */
const JENJANG = Object.freeze({ TK: 'TK', SD: 'SD' });

const STATUS_AKUN =Object.freeze({ AKTIF: 'aktif', NONAKTIF: 'nonaktif' });

const STATUS_HADIR = Object.freeze({
  HADIR: 'Hadir',
  TERLAMBAT: 'Terlambat',
  IZIN: 'Izin',
  SAKIT: 'Sakit',
  TANPA_KETERANGAN: 'Tanpa Keterangan',
});

const STATUS_PENGAJUAN = Object.freeze({
  MENUNGGU: 'Menunggu',
  DISETUJUI: 'Disetujui',
  DITOLAK: 'Ditolak',
});

/**
 * Skema setiap sheet.
 * - key     : kolom ID unik baris.
 * - columns : urutan header saat sheet dibuat.
 * - formats : format angka khusus. Kolom yang tidak disebut diformat teks ('@')
 *             agar tanggal, jam, dan ID tidak dikonversi otomatis oleh Sheets.
 */
const SCHEMA = {
  USERS: {
    key: 'user_id',
    columns: ['user_id', 'nama_guru', 'email', 'nip', 'jenjang', 'role', 'status_akun',
      'created_at', 'updated_at', 'last_login'],
    formats: {},
  },
  ABSENSI: {
    key: 'attendance_id',
    columns: ['attendance_id', 'user_id', 'nama_guru', 'tanggal',
      'jam_masuk', 'latitude_masuk', 'longitude_masuk', 'accuracy_masuk', 'jarak_masuk',
      'jam_pulang', 'latitude_pulang', 'longitude_pulang', 'accuracy_pulang', 'jarak_pulang',
      'status', 'keterangan', 'anomali', 'created_at', 'updated_at'],
    formats: {
      latitude_masuk: '0.0000000', longitude_masuk: '0.0000000',
      accuracy_masuk: '0.0', jarak_masuk: '0.0',
      latitude_pulang: '0.0000000', longitude_pulang: '0.0000000',
      accuracy_pulang: '0.0', jarak_pulang: '0.0',
    },
  },
  PENGAJUAN: {
    key: 'submission_id',
    columns: ['submission_id', 'user_id', 'nama_guru', 'jenis_pengajuan',
      'tanggal_mulai', 'tanggal_selesai', 'alasan', 'bukti_url',
      'status_persetujuan', 'catatan_admin', 'diproses_oleh', 'diproses_at', 'created_at'],
    formats: {},
  },
  SETTINGS: {
    key: 'key',
    columns: ['key', 'value', 'keterangan'],
    formats: {},
  },
  AUDIT_LOG: {
    key: 'log_id',
    columns: ['log_id', 'waktu', 'user_id', 'aktivitas', 'detail'],
    formats: {},
  },
  SESSIONS: {
    key: 'token_hash',
    columns: ['token_hash', 'user_id', 'role', 'created_at', 'expires_at'],
    formats: {},
  },
};

/**
 * Pengaturan default. setup() hanya menambahkan key yang belum ada,
 * tidak pernah menimpa nilai yang sudah diubah admin.
 * Format: [key, value, keterangan]
 */
const DEFAULT_SETTINGS = [
  ['school_name', 'Yayasan Arrahman Nurrahim', 'Nama sekolah yang tampil di aplikasi'],
  ['school_logo_url', '', 'URL gambar logo sekolah (HTTPS)'],
  ['school_latitude', '', 'Latitude titik pusat sekolah, contoh -6.2000000'],
  ['school_longitude', '', 'Longitude titik pusat sekolah, contoh 106.8166667'],
  ['radius_meter', '50', 'Jarak maksimal absensi dari titik sekolah (meter)'],
  ['max_accuracy_meter', '30', 'Akurasi GPS terburuk yang masih diterima (meter)'],
  ['jam_masuk', '07:00', 'Jam masuk kerja (HH:mm WIB)'],
  ['batas_terlambat', '07:15', 'Absen masuk setelah jam ini berstatus Terlambat'],
  ['batas_absen_masuk', '12:00', 'Setelah jam ini absen masuk ditutup; yang belum absen & tanpa izin disetujui menjadi Tanpa Keterangan'],
  ['jam_pulang', '14:00', 'Absen pulang baru dapat dilakukan mulai jam ini'],
  ['hari_kerja', '1,2,3,4,5,6', 'Hari kerja, 1=Senin ... 7=Minggu, pisahkan dengan koma'],
  ['zona_waktu', 'Asia/Jakarta', 'Zona waktu sistem (WIB)'],
  ['session_ttl_jam', '168', 'Masa berlaku sesi login (jam)'],
];

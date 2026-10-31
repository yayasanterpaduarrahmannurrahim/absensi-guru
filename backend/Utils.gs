/**
 * Utils.gs — Utilitas umum: error aplikasi, waktu server WIB, ID unik,
 * hash SHA-256, dan penguncian (LockService).
 */

/**
 * Error yang pesannya aman ditampilkan ke pengguna.
 * Error lain (bug, kegagalan Google) disembunyikan dan hanya dicatat di log.
 */
class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

function fmtWib_(date, pattern) {
  return Utilities.formatDate(date, APP.TIMEZONE, pattern);
}

/**
 * Waktu server saat ini dalam WIB. Seluruh pencatatan jam absensi memakai
 * fungsi ini — jam perangkat guru tidak pernah dipakai.
 * hari: 1 = Senin ... 7 = Minggu.
 */
function nowWib_() {
  const d = new Date();
  return {
    date: d,
    tanggal: fmtWib_(d, 'yyyy-MM-dd'),
    jam: fmtWib_(d, 'HH:mm:ss'),
    waktu: fmtWib_(d, 'yyyy-MM-dd HH:mm:ss'),
    hari: Number(fmtWib_(d, 'u')),
  };
}

/** ID unik berawalan, contoh: USR-3F9A1C2B7D4E. */
function generateId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}

/** Hash SHA-256 dalam bentuk hex. */
function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

let lockDepth_ = 0;

/**
 * Menjalankan fn di dalam script lock agar penulisan dari banyak guru
 * yang absen bersamaan tidak saling menimpa. Bersifat reentrant: pemanggilan
 * bersarang dalam satu eksekusi tidak meminta lock dua kali.
 * Operasi "cek lalu tulis" (mis. cegah absen ganda) WAJIB berada dalam satu withLock_.
 */
function withLock_(fn) {
  if (lockDepth_ > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_TIMEOUT_MS)) {
    throw new AppError('BUSY', 'Server sedang sibuk. Silakan coba lagi beberapa detik lagi.');
  }
  lockDepth_++;
  try {
    return fn();
  } finally {
    lockDepth_--;
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

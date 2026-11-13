/**
 * Auth.gs — Login dengan akun Google dan manajemen sesi.
 *
 * Alur:
 * 1. Frontend menampilkan tombol "Sign in with Google" dan menerima ID token.
 * 2. Backend memverifikasi ID token ke endpoint resmi Google (tokeninfo):
 *    penerima (aud) harus Client ID aplikasi ini, email harus terverifikasi.
 * 3. Email dicocokkan dengan sheet USERS (hanya email terdaftar & aktif yang boleh masuk).
 * 4. Backend membuat token sesi acak; yang disimpan di sheet SESSIONS hanya hash SHA-256-nya.
 * 5. Setiap request berikutnya membawa token sesi; identitas & peran diambil dari server.
 */

const SESSION_CACHE_PREFIX = 'sess_';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

function invalidGoogleToken_() {
  return new AppError('INVALID_GOOGLE_TOKEN', 'Login Google tidak valid. Silakan coba lagi.');
}

/** Memverifikasi ID token Google. Mengembalikan { email, name }. */
function verifyGoogleIdToken_(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 4096 ||
      !/^[A-Za-z0-9._-]+$/.test(idToken)) {
    throw invalidGoogleToken_();
  }
  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw invalidGoogleToken_();

  const info = JSON.parse(res.getContentText());
  const nowSec = Math.floor(Date.now() / 1000);
  if (info.aud !== APP.GOOGLE_CLIENT_ID ||
      GOOGLE_ISSUERS.indexOf(info.iss) < 0 ||
      String(info.email_verified) !== 'true' ||
      !(Number(info.exp) > nowSec) ||
      !info.email) {
    throw invalidGoogleToken_();
  }
  return { email: String(info.email).toLowerCase(), name: info.name || '' };
}

/**
 * Membuat sesi untuk email yang SUDAH terverifikasi oleh Google.
 * Jangan pernah memanggil fungsi ini dengan email kiriman frontend.
 */
function createSessionForEmail_(email) {
  const user = findOneBy_(SHEETS.USERS, 'email', email);
  if (!user) {
    logAudit_('', 'LOGIN_DITOLAK', { email: email, alasan: 'email tidak terdaftar' });
    throw new AppError('NOT_REGISTERED', 'Email ' + email + ' belum terdaftar. Hubungi admin sekolah.');
  }
  if (user.status_akun !== STATUS_AKUN.AKTIF) {
    logAudit_(user.user_id, 'LOGIN_DITOLAK', { email: email, alasan: 'akun nonaktif' });
    throw new AppError('ACCOUNT_DISABLED', 'Akun Anda dinonaktifkan. Hubungi admin sekolah.');
  }

  purgeExpiredSessions_();

  // Dua UUID v4 acak = 64 karakter hex (~244 bit acak).
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const ttlJam = getSettingNumber_('session_ttl_jam') || 168;
  const now = nowWib_();
  const expiresAt = now.date.getTime() + ttlJam * 3600 * 1000;

  insertRow_(SHEETS.SESSIONS, {
    token_hash: sha256Hex_(token),
    user_id: user.user_id,
    role: user.role,
    created_at: now.waktu,
    expires_at: String(expiresAt),
  });
  const updated = updateByKey_(SHEETS.USERS, user.user_id, { last_login: now.waktu });
  logAudit_(user.user_id, 'LOGIN', { email: email });

  return { token: token, expiresAt: expiresAt, user: publicUser_(updated) };
}

function getSessionByHash_(hash) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(SESSION_CACHE_PREFIX + hash);
  if (hit) return JSON.parse(hit);
  const row = findByKey_(SHEETS.SESSIONS, hash);
  if (!row) return null;
  const session = { user_id: row.user_id, expires_at: Number(row.expires_at) };
  const ttlSec = Math.floor((session.expires_at - Date.now()) / 1000);
  if (ttlSec > 0) cache.put(SESSION_CACHE_PREFIX + hash, JSON.stringify(session), Math.min(ttlSec, 21600));
  return session;
}

function removeSessionCache_(hash) {
  CacheService.getScriptCache().remove(SESSION_CACHE_PREFIX + hash);
}

/**
 * Memastikan token sesi valid dan pengguna berhak.
 * level: 'user' (semua pengguna login) atau 'admin'.
 * Data pengguna (peran & status) selalu dibaca ulang dari USERS, sehingga akun yang
 * dinonaktifkan atau dicabut hak adminnya langsung kehilangan akses.
 * Mengembalikan { tokenHash, user }.
 */
function requireSession_(token, level) {
  const invalid = new AppError('SESSION_INVALID', 'Sesi Anda telah berakhir. Silakan login kembali.');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw invalid;

  const hash = sha256Hex_(token);
  const session = getSessionByHash_(hash);
  if (!session || !(session.expires_at > Date.now())) throw invalid;

  const user = getUserCached_(session.user_id);
  if (!user || user.status_akun !== STATUS_AKUN.AKTIF) throw invalid;
  if (level === 'admin' && !hasRole_(user, ROLES.ADMIN)) {
    throw new AppError('FORBIDDEN', 'Anda tidak memiliki akses ke fitur ini.');
  }
  return { tokenHash: hash, user: user };
}

const USER_CACHE_PREFIX = 'usr_';
const USER_CACHE_SECONDS = 120;

/**
 * Data pengguna untuk pemeriksaan sesi, disimpan sementara di CacheService agar setiap
 * permintaan tidak perlu membaca sheet USERS. Cache dibuang otomatis setiap kali baris
 * USERS diubah/dihapus lewat Db.gs (lihat invalidateUserCache_), sehingga penonaktifan
 * atau pencabutan hak admin tetap langsung berlaku. Perubahan manual langsung di
 * spreadsheet berlaku paling lambat 2 menit.
 */
function getUserCached_(userId) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(USER_CACHE_PREFIX + userId);
  if (hit) return JSON.parse(hit);
  const user = findByKey_(SHEETS.USERS, userId);
  if (user) {
    const copy = Object.assign({}, user);
    delete copy._row;
    cache.put(USER_CACHE_PREFIX + userId, JSON.stringify(copy), USER_CACHE_SECONDS);
  }
  return user;
}

function invalidateUserCache_(userId) {
  if (userId) CacheService.getScriptCache().remove(USER_CACHE_PREFIX + userId);
}

/** Menghapus sesi yang sudah kedaluwarsa. */
function purgeExpiredSessions_() {
  const now = Date.now();
  deleteRowsWhere_(SHEETS.SESSIONS, r => !(Number(r.expires_at) > now))
    .forEach(r => removeSessionCache_(r.token_hash));
}

/** Mengakhiri semua sesi milik satu pengguna (saat dinonaktifkan/dihapus). */
function deleteSessionsForUser_(userId) {
  deleteRowsWhere_(SHEETS.SESSIONS, r => r.user_id === userId)
    .forEach(r => removeSessionCache_(r.token_hash));
}

/* ---------- Login dengan kode email (alternatif tanpa akun Google di perangkat) ---------- */

const OTP_PREFIX = 'otp_';
const OTP_TTL_SEC = 600;          // kode berlaku 10 menit
const OTP_RESEND_SEC = 60;        // jeda minimal kirim ulang
const OTP_MAX_PER_HOUR = 5;       // batas kirim kode per email per jam
const OTP_MAX_ATTEMPTS = 5;       // batas salah memasukkan kode

/** Kode 6 angka dari UUID acak (bukan Math.random). */
function generateOtp_() {
  const n = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 1000000;
  return String(n).padStart(6, '0');
}

function sendLoginCodeEmail_(email, nama, code) {
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;color:#10201a">' +
    '<h2 style="color:#08623f;margin:0 0 8px">Kode masuk Absensi Guru</h2>' +
    '<p>Halo ' + String(nama).replace(/[<>&"]/g, '') + ', gunakan kode berikut untuk masuk ke aplikasi:</p>' +
    '<p style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#eef9f3;padding:14px;text-align:center;border-radius:10px">' + code + '</p>' +
    '<p style="color:#6a7a72;font-size:13px">Kode berlaku 10 menit. Jangan berikan kode ini kepada siapa pun. ' +
    'Abaikan email ini bila Anda tidak sedang masuk ke aplikasi.</p></div>';
  MailApp.sendEmail({
    to: email,
    subject: 'Kode masuk Absensi Guru: ' + code,
    htmlBody: html,
    body: 'Kode masuk Absensi Guru: ' + code + ' (berlaku 10 menit). Jangan berikan kode ini kepada siapa pun.',
    name: 'Absensi Guru',
  });
}

/**
 * Membuat & mengirim kode login. `send` dapat diganti saat pengujian.
 * Pesan ke frontend sama untuk email terdaftar/tidak, agar daftar email guru tidak bisa ditebak.
 */
function issueLoginCode_(email, send) {
  const cache = CacheService.getScriptCache();
  const key = OTP_PREFIX + email;
  const nowSec = Math.floor(Date.now() / 1000);
  const existing = JSON.parse(cache.get(key) || 'null');
  if (existing && nowSec - existing.sentAt < OTP_RESEND_SEC) {
    throw new AppError('TOO_SOON', 'Tunggu ' + (OTP_RESEND_SEC - (nowSec - existing.sentAt)) + ' detik sebelum meminta kode lagi.');
  }
  const countKey = OTP_PREFIX + 'n_' + email;
  const count = Number(cache.get(countKey) || 0);
  if (count >= OTP_MAX_PER_HOUR) {
    throw new AppError('TOO_MANY', 'Terlalu banyak permintaan kode. Coba lagi dalam 1 jam.');
  }
  cache.put(countKey, String(count + 1), 3600);

  const user = findOneBy_(SHEETS.USERS, 'email', email);
  if (!user || user.status_akun !== STATUS_AKUN.AKTIF) {
    logAudit_(user ? user.user_id : '', 'KODE_LOGIN_DITOLAK', { email: email, alasan: user ? 'akun nonaktif' : 'email tidak terdaftar' });
    // Tetap catat waktu kirim agar jeda berlaku sama untuk semua email.
    cache.put(key, JSON.stringify({ sentAt: nowSec, hash: '', attempts: OTP_MAX_ATTEMPTS }), OTP_TTL_SEC);
    return { sent: true };
  }
  const code = generateOtp_();
  cache.put(key, JSON.stringify({ sentAt: nowSec, hash: sha256Hex_(email + ':' + code), attempts: 0 }), OTP_TTL_SEC);
  send(email, user.nama_guru, code);
  logAudit_(user.user_id, 'KODE_LOGIN_DIKIRIM', { email: email });
  return { sent: true };
}

/** Memeriksa kode. Berhasil → membuat sesi seperti login Google. */
function verifyLoginCode_(email, code) {
  const cache = CacheService.getScriptCache();
  const key = OTP_PREFIX + email;
  const data = JSON.parse(cache.get(key) || 'null');
  const invalid = new AppError('INVALID_CODE', 'Kode salah atau sudah kedaluwarsa. Minta kode baru bila perlu.');
  if (!data || !data.hash) throw invalid;
  if (data.attempts >= OTP_MAX_ATTEMPTS) {
    cache.remove(key);
    throw new AppError('TOO_MANY', 'Terlalu banyak percobaan salah. Minta kode baru.');
  }
  if (sha256Hex_(email + ':' + code) !== data.hash) {
    data.attempts++;
    const ttl = Math.max(1, OTP_TTL_SEC - (Math.floor(Date.now() / 1000) - data.sentAt));
    cache.put(key, JSON.stringify(data), ttl);
    throw invalid;
  }
  cache.remove(key); // kode sekali pakai
  return createSessionForEmail_(email);
}

/* ---------- Handler API ---------- */

function apiRequestLoginCode_(payload) {
  return issueLoginCode_(vEmail_(payload.email, 'Email'), sendLoginCodeEmail_);
}

function apiVerifyLoginCode_(payload) {
  const email = vEmail_(payload.email, 'Email');
  const code = vString_(payload.code, 'Kode', { required: true, pattern: /^\d{6}$/, patternMessage: 'Kode terdiri dari 6 angka.' });
  return verifyLoginCode_(email, code);
}

function apiLoginGoogle_(payload) {
  const google = verifyGoogleIdToken_(payload.credential);
  return createSessionForEmail_(google.email);
}

function apiLogout_(payload, ctx) {
  deleteRowsWhere_(SHEETS.SESSIONS, r => r.token_hash === ctx.session.tokenHash);
  removeSessionCache_(ctx.session.tokenHash);
  logAudit_(ctx.session.user.user_id, 'LOGOUT', {});
  return { loggedOut: true };
}

function apiMe_(payload, ctx) {
  return { user: publicUser_(ctx.session.user) };
}

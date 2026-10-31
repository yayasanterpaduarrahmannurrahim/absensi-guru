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

  const user = findByKey_(SHEETS.USERS, session.user_id);
  if (!user || user.status_akun !== STATUS_AKUN.AKTIF) throw invalid;
  if (level === 'admin' && user.role !== ROLES.ADMIN) {
    throw new AppError('FORBIDDEN', 'Anda tidak memiliki akses ke fitur ini.');
  }
  return { tokenHash: hash, user: user };
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

/* ---------- Handler API ---------- */

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

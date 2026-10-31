/**
 * api.js — Komunikasi dengan backend Apps Script dan penyimpanan sesi di perangkat.
 *
 * Request dikirim sebagai POST dengan Content-Type text/plain agar browser tidak
 * mengirim CORS preflight (Apps Script tidak mendukung OPTIONS).
 */
const Api = (() => {
  const SESSION_KEY = 'absensi_session';
  let memorySession = null; // cadangan bila localStorage diblokir (mode privat)

  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  function getSession() {
    let s = memorySession;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) s = JSON.parse(raw);
    } catch (e) { /* pakai memorySession */ }
    return s && s.token && s.expiresAt > Date.now() ? s : null;
  }

  function saveSession(session) {
    memorySession = session;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* abaikan */ }
  }

  function clearSession() {
    memorySession = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* abaikan */ }
  }

  /** Memanggil aksi backend. Melempar ApiError dengan pesan yang siap ditampilkan. */
  async function call(action, payload) {
    const session = getSession();
    let res;
    try {
      res = await fetch(APP_CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: session ? session.token : undefined, payload: payload || {} }),
      });
    } catch (e) {
      throw new ApiError('NETWORK', 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
    }

    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new ApiError('BAD_RESPONSE', 'Respons server tidak valid. Silakan coba lagi.');
    }

    if (!json.ok) {
      if (json.error.code === 'SESSION_INVALID') {
        clearSession();
        window.dispatchEvent(new CustomEvent('session-expired', { detail: json.error.message }));
      }
      throw new ApiError(json.error.code, json.error.message);
    }
    return json.data;
  }

  return { call, getSession, saveSession, clearSession, ApiError };
})();

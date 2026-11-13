/**
 * api.js — Komunikasi dengan backend Apps Script, penyimpanan sesi, dan cache data.
 *
 * Request dikirim sebagai POST dengan Content-Type text/plain agar browser tidak
 * mengirim CORS preflight (Apps Script tidak mendukung OPTIONS).
 *
 * Setiap permintaan ke Apps Script memakan ±2 detik. Agar pindah menu terasa instan:
 * - swr(): tampilkan data tersimpan dulu, lalu perbarui dari server di belakang layar;
 * - prefetch(): ambil data menu utama sekaligus dalam satu permintaan (aksi "batch");
 * - permintaan yang sama yang sedang berjalan digabung (tidak dikirim dua kali);
 * - setiap aksi yang MENGUBAH data mengosongkan cache agar tidak ada data basi.
 */
const Api = (() => {
  const SESSION_KEY = 'absensi_session';
  const CACHE_KEY = 'absensi_cache';
  let memorySession = null; // cadangan bila localStorage diblokir (mode privat)

  // Aksi baca yang boleh di-cache & digabung (harus sama dengan BATCHABLE_ di backend Api.gs).
  const READ_ACTIONS = new Set(['me', 'getPublicConfig', 'getLocationConfig', 'getToday', 'myHistory', 'myLeaves',
    'adminDashboard', 'adminListUsers', 'adminGetSchedule', 'adminListLeaves', 'adminAuditLog', 'adminReport', 'adminGuruMonth']);
  // Yang ikut disimpan di perangkat (agar cepat saat aplikasi dibuka lagi). Data besar cukup di memori.
  const PERSIST = new Set(['getPublicConfig', 'getLocationConfig', 'myHistory', 'myLeaves',
    'adminDashboard', 'adminListUsers', 'adminGetSchedule', 'adminListLeaves', 'adminGuruMonth']);
  // Aksi yang tidak mengubah data dan tidak perlu mengosongkan cache.
  const NO_INVALIDATE = new Set(['ping', 'batch', 'requestLoginCode']);

  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  /* ---------- Sesi ---------- */

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
    clearCache();
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* abaikan */ }
  }

  /* ---------- Cache ---------- */

  const mem = new Map();
  const inflight = new Map();
  let stored = null; // { owner: userId, items: { key: data } }

  const keyOf = (action, payload) => action + '|' + JSON.stringify(payload || {});
  const ownerId = () => { const s = getSession(); return s && s.user ? s.user.userId : ''; };

  function storage() {
    if (stored && stored.owner === ownerId()) return stored;
    stored = { owner: ownerId(), items: {} };
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (raw && raw.owner === stored.owner) stored = raw; // cache milik akun lain diabaikan
    } catch (e) { /* abaikan */ }
    return stored;
  }

  function peek(action, payload) {
    const k = keyOf(action, payload);
    if (mem.has(k)) return mem.get(k);
    const s = storage();
    return Object.prototype.hasOwnProperty.call(s.items, k) ? s.items[k] : undefined;
  }

  function put(action, payload, data) {
    const k = keyOf(action, payload);
    mem.set(k, data);
    if (!PERSIST.has(action)) return;
    const s = storage();
    s.items[k] = data;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch (e) { /* penyimpanan penuh: cukup di memori */ }
  }

  function clearCache() {
    mem.clear();
    stored = null;
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* abaikan */ }
  }

  /* ---------- Permintaan ---------- */

  async function send(action, payload) {
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

  /** Memanggil aksi backend. Melempar ApiError dengan pesan yang siap ditampilkan. */
  function call(action, payload) {
    if (!READ_ACTIONS.has(action)) {
      return send(action, payload).then(data => {
        if (!NO_INVALIDATE.has(action)) clearCache(); // data berubah → cache lama tidak berlaku
        return data;
      });
    }
    const k = keyOf(action, payload);
    if (inflight.has(k)) return inflight.get(k);
    const p = send(action, payload)
      .then(data => { put(action, payload, data); return data; })
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  }

  /**
   * Stale-while-revalidate: bila ada data tersimpan, onData(data, true) dipanggil SEGERA;
   * lalu data terbaru diambil dan onData(data, false) dipanggil lagi bila berbeda.
   * Bila server gagal tetapi data tersimpan ada, data tersimpan tetap dipakai.
   */
  function swr(action, payload, onData) {
    const cached = peek(action, payload);
    if (cached !== undefined) onData(cached, true);
    const fresh = call(action, payload).then(data => {
      if (cached === undefined || JSON.stringify(data) !== JSON.stringify(cached)) onData(data, false);
      return data;
    });
    return cached !== undefined ? fresh.catch(() => cached) : fresh;
  }

  /**
   * Mengambil beberapa data baca sekaligus dalam satu permintaan lalu menyimpannya di cache.
   * Halaman yang meminta data yang sama selama proses berjalan akan menunggu hasil ini.
   */
  function prefetch(calls) {
    const list = calls.filter(c => !inflight.has(keyOf(c.action, c.payload)));
    if (!list.length) return Promise.resolve();
    const batch = send('batch', { calls: list.map(c => ({ action: c.action, payload: c.payload || {} })) });
    list.forEach((c, i) => {
      const k = keyOf(c.action, c.payload);
      const p = batch.then(results => {
        const r = results[i];
        if (!r || !r.ok) throw new ApiError(r && r.error ? r.error.code : 'BAD_RESPONSE', r && r.error ? r.error.message : 'Gagal memuat data.');
        put(c.action, c.payload, r.data);
        return r.data;
      }).finally(() => inflight.delete(k));
      p.catch(() => { /* kegagalan prefetch tidak mengganggu; halaman akan meminta ulang */ });
      inflight.set(k, p);
    });
    return batch.then(() => undefined, () => undefined);
  }

  return { call, swr, prefetch, peek, clearCache, getSession, saveSession, clearSession, ApiError };
})();

/**
 * Api.gs — Titik masuk Web App (doGet/doPost) dan router aksi.
 *
 * Frontend (GitHub Pages) mengirim POST dengan body JSON:
 *   { "action": "namaAksi", "token": "<token sesi>", "payload": { ... } }
 * dengan header Content-Type: text/plain agar browser tidak mengirim CORS preflight.
 *
 * Semua respons berbentuk:
 *   { "ok": true,  "data": ... }
 *   { "ok": false, "error": { "code": "...", "message": "..." } }
 */

/**
 * Daftar aksi. auth: 'public' | 'user' (semua yang login) | 'admin'.
 * get: true = boleh lewat GET (hanya untuk aksi baca publik yang tidak mengubah data).
 */
function getRoutes_() {
  return {
    ping: { auth: 'public', get: true, handler: apiPing_ },
    getPublicConfig: { auth: 'public', get: true, handler: apiGetPublicConfig_ },

    loginGoogle: { auth: 'public', handler: apiLoginGoogle_ },
    logout: { auth: 'user', handler: apiLogout_ },
    me: { auth: 'user', handler: apiMe_ },

    getLocationConfig: { auth: 'user', handler: apiGetLocationConfig_ },
    checkLocation: { auth: 'user', handler: apiCheckLocation_ },
    adminUpdateLocation: { auth: 'admin', handler: apiAdminUpdateLocation_ },

    getToday: { auth: 'user', handler: apiGetToday_ },
    checkIn: { auth: 'user', handler: apiCheckIn_ },
    checkOut: { auth: 'user', handler: apiCheckOut_ },

    adminListUsers: { auth: 'admin', handler: apiAdminListUsers_ },
    adminCreateUser: { auth: 'admin', handler: apiAdminCreateUser_ },
    adminUpdateUser: { auth: 'admin', handler: apiAdminUpdateUser_ },
    adminDeleteUser: { auth: 'admin', handler: apiAdminDeleteUser_ },
  };
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'ping';
  return jsonOutput_(dispatch_({ action: action }, 'GET'));
}

function doPost(e) {
  let request;
  try {
    const body = e && e.postData ? e.postData.contents : '';
    if (!body || body.length > APP.MAX_REQUEST_BYTES) throw new Error('size');
    request = JSON.parse(body);
  } catch (err) {
    return jsonOutput_(errorResponse_(new AppError('BAD_REQUEST', 'Format permintaan tidak valid.')));
  }
  return jsonOutput_(dispatch_(request, 'POST'));
}

/** Memvalidasi permintaan, memeriksa hak akses, lalu menjalankan handler. */
function dispatch_(request, method) {
  try {
    if (!request || typeof request !== 'object' || typeof request.action !== 'string') {
      throw new AppError('BAD_REQUEST', 'Format permintaan tidak valid.');
    }
    const routes = getRoutes_();
    if (!Object.prototype.hasOwnProperty.call(routes, request.action)) {
      throw new AppError('UNKNOWN_ACTION', 'Aksi tidak dikenal.');
    }
    const route = routes[request.action];
    if (method === 'GET' && !route.get) {
      throw new AppError('METHOD_NOT_ALLOWED', 'Aksi ini harus dikirim dengan POST.');
    }
    const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
    const ctx = { session: null };
    if (route.auth !== 'public') {
      // Identitas pengguna selalu diambil dari sesi, tidak pernah dari user_id kiriman frontend.
      ctx.session = requireSession_(request.token, route.auth);
    }
    return { ok: true, data: route.handler(payload, ctx) };
  } catch (err) {
    return errorResponse_(err);
  }
}

function errorResponse_(err) {
  if (err instanceof AppError) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  console.error(err && err.stack ? err.stack : err);
  return { ok: false, error: { code: 'SERVER_ERROR', message: 'Terjadi kesalahan pada server. Silakan coba lagi.' } };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Handler publik ---------- */

/** Cek kesehatan server & waktu server (dipakai frontend untuk jam WIB). */
function apiPing_() {
  return {
    app: APP.NAME,
    version: APP.VERSION,
    serverTime: nowWib_().waktu,
    timezone: APP.TIMEZONE,
  };
}

/** Informasi yang boleh dilihat siapa pun sebelum login. Tanpa koordinat & data sensitif. */
function apiGetPublicConfig_() {
  const s = getSettings_();
  return {
    schoolName: s.school_name || '',
    schoolLogoUrl: s.school_logo_url || '',
  };
}

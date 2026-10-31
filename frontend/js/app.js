/**
 * app.js — Alur utama aplikasi: login Google, beranda (status lokasi GPS & profil),
 * Kelola Pengguna, dan Lokasi Sekolah (khusus admin).
 */
const App = (() => {
  const { esc, icons, toast, withLoading, openModal, confirm, initials } = UI;
  const root = () => document.getElementById('app');

  const state = {
    school: { schoolName: 'Yayasan Arrahman Nurrahim', schoolLogoUrl: '' },
    user: null,
    tab: 'beranda',
    users: [],
    userSearch: '',
    today: null,        // hasil getToday: { serverNow, tanggal, isWorkday, schedule, record }
    clockOffset: 0,     // selisih jam server - jam perangkat (ms)
    clockTimer: null,
    todayKey: '',
    submitting: false,
    loc: {
      config: null,     // { configured, lat, lng, radius, maxAccuracy }
      status: 'idle',   // lihat Geo.watch
      coords: null,
      samples: [],
      stop: null,       // fungsi penghenti pemantauan GPS
      gen: 0,           // penanda panggilan startLocation terakhir
      renderKey: '',
    },
  };

  const ROLE_LABEL = { admin: 'Admin', guru: 'Guru' };

  /* ---------- Inisialisasi ---------- */

  async function init() {
    window.addEventListener('session-expired', e => {
      stopLocation();
      stopClock();
      state.user = null;
      toast(e.detail || 'Sesi berakhir. Silakan login kembali.', 'error');
      renderLogin();
    });

    // Hemat baterai: hentikan GPS saat aplikasi tidak terlihat.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopLocation();
      else if (state.user && state.tab === 'beranda') startLocation();
    });

    loadPublicConfig();

    const session = Api.getSession();
    if (!session) return renderLogin();

    state.user = session.user;
    renderApp();
    try {
      // Validasi ulang sesi & ambil data profil terbaru dari server.
      const { user } = await Api.call('me');
      state.user = user;
      Api.saveSession(Object.assign({}, session, { user }));
      if (state.tab === 'beranda') renderProfileCards();
    } catch (err) {
      if (err.code !== 'SESSION_INVALID') toast(err.message, 'error');
    }
  }

  async function loadPublicConfig() {
    try {
      const cfg = await Api.call('getPublicConfig');
      if (cfg.schoolName) state.school.schoolName = cfg.schoolName;
      state.school.schoolLogoUrl = cfg.schoolLogoUrl || '';
      document.querySelectorAll('[data-school-name]').forEach(el => { el.textContent = state.school.schoolName; });
    } catch (e) { /* nama default tetap dipakai */ }
  }

  function logoHtml(cls) {
    return state.school.schoolLogoUrl
      ? `<img class="${cls}" src="${esc(state.school.schoolLogoUrl)}" alt="Logo sekolah">`
      : `<div class="${cls} logo-fallback"><i data-lucide="school"></i></div>`;
  }

  /* ---------- Login ---------- */

  function renderLogin() {
    root().innerHTML = `
      <main class="login">
        <div class="login-card">
          ${logoHtml('login-logo')}
          <h1>Absensi Guru</h1>
          <p class="muted" data-school-name>${esc(state.school.schoolName)}</p>
          <p class="login-hint">Masuk menggunakan akun Google yang telah didaftarkan oleh admin sekolah.</p>
          <div id="google-btn" class="google-btn"><span class="spinner spinner-dark"></span></div>
          <div id="login-error" class="alert alert-error" hidden></div>
          <a class="small-link" href="privacy.html">Kebijakan Privasi</a>
        </div>
      </main>`;
    icons();
    renderGoogleButton();
  }

  /** Menunggu library Google Identity Services siap, lalu menampilkan tombol login. */
  function renderGoogleButton(attempt) {
    const el = document.getElementById('google-btn');
    if (!el) return;
    if (!(window.google && google.accounts && google.accounts.id)) {
      if ((attempt || 0) > 100) {
        el.innerHTML = '';
        return showLoginError('Layanan login Google gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.');
      }
      return setTimeout(() => renderGoogleButton((attempt || 0) + 1), 100);
    }
    google.accounts.id.initialize({
      client_id: APP_CONFIG.GOOGLE_CLIENT_ID,
      callback: onGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    el.innerHTML = '';
    google.accounts.id.renderButton(el, {
      theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'id', width: 280,
    });
  }

  function showLoginError(message) {
    const box = document.getElementById('login-error');
    if (!box) return;
    box.textContent = message;
    box.hidden = !message;
  }

  async function onGoogleCredential(response) {
    const btn = document.getElementById('google-btn');
    showLoginError('');
    btn.classList.add('is-loading');
    try {
      const result = await Api.call('loginGoogle', { credential: response.credential });
      Api.saveSession({ token: result.token, expiresAt: result.expiresAt, user: result.user });
      state.user = result.user;
      state.tab = 'beranda';
      toast('Selamat datang, ' + result.user.nama + '.', 'success');
      renderApp();
    } catch (err) {
      showLoginError(err.message);
    } finally {
      btn.classList.remove('is-loading');
    }
  }

  async function logout() {
    const ok = await confirm('Keluar', 'Keluar dari aplikasi di perangkat ini?', 'Keluar');
    if (!ok) return;
    stopLocation();
    stopClock();
    try { await Api.call('logout'); } catch (e) { /* sesi tetap dihapus di perangkat */ }
    Api.clearSession();
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    state.user = null;
    state.loc.config = null;
    renderLogin();
  }

  /* ---------- Kerangka aplikasi ---------- */

  function renderApp() {
    stopLocation();
    stopClock();
    const isAdmin = state.user.role === 'admin';
    if (!isAdmin) state.tab = 'beranda';

    const tab = (id, icon, label) =>
      `<button class="tab ${state.tab === id ? 'active' : ''}" data-tab="${id}"><i data-lucide="${icon}"></i> ${label}</button>`;

    root().innerHTML = `
      <header class="topbar">
        <div class="topbar-inner">
          ${logoHtml('topbar-logo')}
          <div class="topbar-title">
            <strong>Absensi Guru</strong>
            <span data-school-name>${esc(state.school.schoolName)}</span>
          </div>
          <button class="icon-btn icon-btn-light" id="btn-logout" aria-label="Keluar" title="Keluar">
            <i data-lucide="log-out"></i>
          </button>
        </div>
      </header>
      ${isAdmin ? `
        <nav class="tabs" aria-label="Menu">
          ${tab('beranda', 'house', 'Beranda')}
          ${tab('pengguna', 'users', 'Pengguna')}
          ${tab('lokasi', 'map-pin', 'Lokasi Sekolah')}
          ${tab('jadwal', 'clock', 'Jam Kerja')}
        </nav>` : ''}
      <main class="content" id="view"></main>`;

    document.getElementById('btn-logout').onclick = logout;
    root().querySelectorAll('[data-tab]').forEach(b => {
      b.onclick = () => { state.tab = b.dataset.tab; renderApp(); };
    });

    if (state.tab === 'pengguna') renderUsersView();
    else if (state.tab === 'lokasi') renderSchoolLocationView();
    else if (state.tab === 'jadwal') renderScheduleView();
    else renderHomeView();
    icons();
  }

  /* ---------- Beranda: absensi hari ini, lokasi & profil ---------- */

  function renderHomeView() {
    document.getElementById('view').innerHTML = `
      <section class="card today-card" id="today-card"></section>
      <section class="card loc-card" id="loc-card" aria-live="polite"></section>
      <div id="profile-cards" class="stack"></div>`;
    state.todayKey = '';
    renderTodayCard();
    renderProfileCards();
    loadToday();
    startLocation();
  }

  /* ---------- Absensi hari ini ---------- */

  const STATUS_CLASS = {
    'Hadir': 'st-hadir', 'Terlambat': 'st-terlambat', 'Izin': 'st-izin',
    'Sakit': 'st-izin', 'Tanpa Keterangan': 'st-alpa',
  };

  /** Waktu server saat ini (jam perangkat dikoreksi selisih dengan server). */
  function serverNow() {
    return new Date(Date.now() + state.clockOffset);
  }

  function wibParts(date) {
    const p = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).forEach(x => { p[x.type] = x.value; });
    return { tanggal: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, jam: `${p.hour}:${p.minute}:${p.second}` };
  }

  function formatTanggalPanjang(date) {
    return date.toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  async function loadToday() {
    try {
      const sentAt = Date.now();
      const today = await Api.call('getToday');
      // Perkiraan selisih jam: titik tengah perjalanan request.
      state.clockOffset = today.serverNow - Math.round((sentAt + Date.now()) / 2);
      state.today = today;
      state.todayError = '';
    } catch (err) {
      state.todayError = err.message;
    }
    state.todayKey = '';
    renderTodayCard();
    startClock();
  }

  function startClock() {
    stopClock();
    state.clockTimer = setInterval(() => {
      if (!document.getElementById('today-card')) return stopClock();
      const parts = wibParts(serverNow());
      const clock = document.getElementById('clock');
      if (clock) clock.textContent = parts.jam;
      // Lewat tengah malam: ambil status hari yang baru.
      if (state.today && parts.tanggal !== state.today.tanggal) return loadToday();
      renderTodayCard(); // hanya menggambar ulang bila status tombol berubah
    }, 1000);
  }

  function stopClock() {
    if (state.clockTimer) clearInterval(state.clockTimer);
    state.clockTimer = null;
  }

  /** Tahap absensi saat ini berdasarkan data server & jam server. */
  function attendancePhase() {
    const t = state.today;
    if (!t) return { phase: 'loading' };
    const hm = wibParts(serverNow()).hm;
    const r = t.record;
    if (r && !r.jamMasuk) return { phase: 'status', note: `Anda tercatat ${r.status} hari ini.` };
    if (r && r.jamPulang) return { phase: 'done', note: 'Absensi hari ini sudah lengkap. Terima kasih.' };
    if (r) {
      return hm >= t.schedule.jamPulang
        ? { phase: 'checkout' }
        : { phase: 'wait', note: `Absen pulang dapat dilakukan mulai pukul ${t.schedule.jamPulang} WIB.` };
    }
    if (!t.isWorkday) return { phase: 'off', note: 'Hari ini bukan hari kerja.' };
    if (hm > t.schedule.batasAbsenMasuk) {
      return { phase: 'closed', note: `Absen masuk sudah ditutup pukul ${t.schedule.batasAbsenMasuk} WIB.` };
    }
    return { phase: 'checkin' };
  }

  function locationIsValid() {
    const loc = state.loc;
    return loc.status === 'ok' && loc.coords && loc.config && loc.config.configured && localVerdict().valid;
  }

  function renderTodayCard() {
    const card = document.getElementById('today-card');
    if (!card) return;
    const t = state.today;
    const ph = attendancePhase();
    const locOk = locationIsValid();
    const r = t && t.record;

    const key = [ph.phase, locOk, state.submitting, r && r.jamMasuk, r && r.jamPulang, r && r.status, state.todayError].join('|');
    if (key === state.todayKey) return;
    state.todayKey = key;

    if (!t) {
      card.innerHTML = state.todayError
        ? `<div class="alert alert-error">${esc(state.todayError)}</div>
           <button class="btn btn-ghost" id="btn-today-retry"><i data-lucide="refresh-cw"></i> Coba lagi</button>`
        : '<div class="empty"><span class="spinner spinner-dark"></span></div>';
      const retry = document.getElementById('btn-today-retry');
      if (retry) retry.onclick = loadToday;
      return icons();
    }

    const canIn = ph.phase === 'checkin' && locOk && !state.submitting;
    const canOut = ph.phase === 'checkout' && locOk && !state.submitting;
    let hint = ph.note || '';
    if (!hint && !locOk) hint = 'Tombol absen aktif setelah lokasi Anda valid (di dalam radius sekolah dengan akurasi GPS yang baik).';
    if (!hint && ph.phase === 'checkin') hint = `Jam masuk ${t.schedule.jamMasuk} WIB · terlambat setelah ${t.schedule.batasTerlambat} WIB.`;

    card.innerHTML = `
      <div class="today-head">
        <div>
          <span class="muted today-date">${esc(formatTanggalPanjang(serverNow()))}</span>
          <div class="clock"><span id="clock">${esc(wibParts(serverNow()).jam)}</span> <small>WIB</small></div>
        </div>
        ${r && r.status ? `<span class="status-pill ${STATUS_CLASS[r.status] || ''}">${esc(r.status)}</span>` : ''}
      </div>
      <div class="today-times">
        <div><span class="muted">Jam masuk</span><strong>${esc(r && r.jamMasuk ? r.jamMasuk : '--:--')}</strong></div>
        <div><span class="muted">Jam pulang</span><strong>${esc(r && r.jamPulang ? r.jamPulang : '--:--')}</strong></div>
      </div>
      <div class="attend-actions">
        <button class="btn btn-attend btn-in" id="btn-check-in" ${canIn ? '' : 'disabled'}>
          ${state.submitting && ph.phase === 'checkin' ? '<span class="spinner"></span>' : '<i data-lucide="log-in"></i>'} ABSEN MASUK
        </button>
        <button class="btn btn-attend btn-out" id="btn-check-out" ${canOut ? '' : 'disabled'}>
          ${state.submitting && ph.phase === 'checkout' ? '<span class="spinner"></span>' : '<i data-lucide="log-out"></i>'} ABSEN PULANG
        </button>
      </div>
      ${hint ? `<p class="muted attend-hint">${esc(hint)}</p>` : ''}`;

    document.getElementById('btn-check-in').onclick = () => submitAttendance('checkIn');
    document.getElementById('btn-check-out').onclick = () => submitAttendance('checkOut');
    icons();
  }

  /** Mengirim absen masuk/pulang beserta lokasi terkini. Server memvalidasi ulang semuanya. */
  async function submitAttendance(action) {
    if (state.submitting || !locationIsValid()) return;
    const { coords, samples } = state.loc;
    state.submitting = true;
    renderTodayCard();
    try {
      const record = await Api.call(action, {
        latitude: coords.lat, longitude: coords.lng, accuracy: coords.accuracy, samples,
      });
      state.today.record = record;
      toast(action === 'checkIn'
        ? `Absen masuk berhasil pukul ${record.jamMasuk} WIB (${record.status}).`
        : `Absen pulang berhasil pukul ${record.jamPulang} WIB.`, 'success');
      if (navigator.vibrate) navigator.vibrate(80);
    } catch (err) {
      toast(err.message, 'error');
      if (err.code !== 'NETWORK') loadToday(); // sinkronkan status (mis. sudah absen dari perangkat lain)
    } finally {
      state.submitting = false;
      state.todayKey = '';
      renderTodayCard();
    }
  }

  function renderProfileCards() {
    const box = document.getElementById('profile-cards');
    if (!box) return;
    const u = state.user;
    box.innerHTML = `
      <section class="card profile">
        <div class="avatar">${esc(initials(u.nama))}</div>
        <div>
          <h2>${esc(u.nama)}</h2>
          <span class="badge badge-${esc(u.role)}">${esc(ROLE_LABEL[u.role] || u.role)}</span>
          ${u.jenjang ? `<span class="badge">${esc(u.jenjang)}</span>` : ''}
        </div>
      </section>
      <section class="card">
        <dl class="info-list">
          <div><dt><i data-lucide="mail"></i> Email</dt><dd>${esc(u.email)}</dd></div>
          <div><dt><i data-lucide="hash"></i> NIP</dt><dd>${esc(u.nip || '—')}</dd></div>
          <div><dt><i data-lucide="graduation-cap"></i> Jenjang</dt><dd>${esc(u.jenjang || '—')}</dd></div>
          <div><dt><i data-lucide="clock"></i> Login terakhir</dt><dd>${esc(u.lastLogin || '—')} WIB</dd></div>
        </dl>
      </section>`;
    icons();
  }

  /** Mengambil ulang pengaturan lokasi dari server (bisa diubah admin kapan saja), lalu memantau GPS. */
  async function startLocation() {
    stopLocation();
    const loc = state.loc;
    const gen = ++loc.gen; // panggilan yang lebih baru membatalkan yang lama
    loc.renderKey = '';
    loc.status = 'loading-config';
    renderLocCard();
    let config;
    try {
      config = await Api.call('getLocationConfig');
    } catch (err) {
      if (gen !== loc.gen) return;
      loc.status = 'config-error';
      loc.configError = err.message;
      return renderLocCard();
    }
    if (gen !== loc.gen || !document.getElementById('loc-card') || document.hidden) return;
    loc.config = config;
    if (!loc.config.configured) {
      loc.status = 'not-configured';
      return renderLocCard();
    }
    loc.stop = Geo.watch(update => {
      loc.status = update.status;
      if (update.coords) {
        loc.coords = update.coords;
        loc.samples = update.samples;
      }
      renderLocCard();
    });
  }

  function stopLocation() {
    state.loc.gen++;
    if (state.loc.stop) state.loc.stop();
    state.loc.stop = null;
  }

  /** Penilaian lokasi di perangkat (untuk tampilan). Server menilai ulang saat absen. */
  function localVerdict() {
    const { config, coords } = state.loc;
    const distance = Geo.distance(config.lat, config.lng, coords.lat, coords.lng);
    const accuracyOk = coords.accuracy <= config.maxAccuracy;
    const withinRadius = distance <= config.radius;
    return { distance, accuracyOk, withinRadius, valid: accuracyOk && withinRadius };
  }

  const GPS_HELP = {
    denied: `
      <p><strong>Izin lokasi ditolak.</strong> Absensi tidak dapat dilakukan tanpa izin lokasi.</p>
      <details open><summary>Cara mengizinkan</summary>
        <ul>
          <li><strong>Android (Chrome):</strong> ketuk ikon <em>gembok/pengaturan</em> di samping alamat situs → <em>Izin</em> → <em>Lokasi</em> → <em>Izinkan</em>, lalu muat ulang halaman.</li>
          <li><strong>iPhone (Safari):</strong> buka <em>Pengaturan</em> → <em>Privasi &amp; Keamanan</em> → <em>Layanan Lokasi</em> → <em>Situs Web Safari</em> → <em>Saat Digunakan</em>. Lalu di Safari ketuk <em>aA</em> → <em>Pengaturan Situs Web</em> → <em>Lokasi</em> → <em>Izinkan</em>.</li>
        </ul>
      </details>`,
    unavailable: `
      <p><strong>GPS tidak aktif atau sinyal lokasi tidak ditemukan.</strong></p>
      <details open><summary>Cara mengaktifkan GPS</summary>
        <ul>
          <li><strong>Android:</strong> tarik panel notifikasi dari atas → aktifkan <em>Lokasi</em>. Pastikan mode akurasi tinggi (<em>Akurasi Lokasi Google</em>) aktif.</li>
          <li><strong>iPhone:</strong> <em>Pengaturan</em> → <em>Privasi &amp; Keamanan</em> → <em>Layanan Lokasi</em> → aktifkan.</li>
        </ul>
        <p>Setelah itu ketuk <em>Perbarui lokasi</em>.</p>
      </details>`,
    timeout: `<p><strong>Lokasi belum didapat.</strong> Pastikan GPS aktif, keluar ke area terbuka atau dekat jendela, lalu ketuk <em>Perbarui lokasi</em>.</p>`,
    unsupported: `<p><strong>Browser ini tidak mendukung GPS.</strong> Gunakan Chrome (Android) atau Safari (iPhone) versi terbaru.</p>`,
  };

  function renderLocCard() {
    const card = document.getElementById('loc-card');
    if (!card) return;
    const loc = state.loc;
    const v = loc.status === 'ok' && loc.coords && loc.config && loc.config.configured ? localVerdict() : null;

    // Bila status tidak berubah, cukup perbarui angka agar tombol tidak berkedip.
    const key = [loc.status, v && v.valid, v && v.accuracyOk, v && v.withinRadius].join('|');
    if (key === loc.renderKey && v) {
      document.getElementById('loc-distance').textContent = formatDistance(v.distance);
      document.getElementById('loc-accuracy').textContent = '±' + Math.round(loc.coords.accuracy) + ' m';
      return;
    }
    loc.renderKey = key;

    let tone = 'neutral', icon = 'loader', title = '', body = '';
    switch (loc.status) {
      case 'loading-config':
      case 'locating':
        title = 'Mengambil lokasi GPS…';
        body = '<p class="muted">Pastikan GPS aktif. Proses ini bisa memakan waktu beberapa detik.</p>';
        break;
      case 'config-error':
        tone = 'bad'; icon = 'triangle-alert'; title = 'Gagal memuat pengaturan lokasi';
        body = `<p>${esc(loc.configError)}</p>`;
        break;
      case 'not-configured':
        tone = 'warn'; icon = 'map-pin-off'; title = 'Lokasi sekolah belum diatur';
        body = '<p>Admin perlu mengatur titik lokasi sekolah sebelum absensi dapat dilakukan.</p>';
        break;
      case 'denied':
      case 'unavailable':
      case 'timeout':
      case 'unsupported':
        tone = 'bad'; icon = 'map-pin-off'; title = 'Lokasi tidak tersedia';
        body = GPS_HELP[loc.status];
        break;
      case 'ok':
        if (!v.accuracyOk) {
          tone = 'warn'; icon = 'satellite-dish'; title = 'Akurasi GPS rendah';
          body = `<p>Akurasi saat ini lebih buruk dari batas ±${esc(loc.config.maxAccuracy)} m. Pindah ke area terbuka atau dekat jendela, lalu tunggu beberapa detik.</p>`;
        } else if (!v.withinRadius) {
          tone = 'bad'; icon = 'map-pin-x'; title = 'Di luar area sekolah';
          body = `<p>Absensi hanya dapat dilakukan dalam radius ${esc(loc.config.radius)} m dari titik sekolah.</p>`;
        } else {
          tone = 'good'; icon = 'map-pin-check'; title = 'Lokasi valid — di dalam area sekolah';
          body = '';
        }
        break;
      default:
        title = 'Menyiapkan lokasi…';
    }

    const metrics = v ? `
      <div class="loc-metrics">
        <div><span class="muted">Jarak dari sekolah</span><strong id="loc-distance">${formatDistance(v.distance)}</strong></div>
        <div><span class="muted">Akurasi GPS</span><strong id="loc-accuracy">±${Math.round(loc.coords.accuracy)} m</strong></div>
        <div><span class="muted">Radius</span><strong>${esc(loc.config.radius)} m</strong></div>
      </div>` : '';

    const canRetry = ['ok', 'denied', 'unavailable', 'timeout', 'config-error'].includes(loc.status);
    card.className = 'card loc-card tone-' + tone;
    card.innerHTML = `
      <div class="loc-head">
        <div class="loc-icon">${tone === 'neutral' ? '<span class="spinner spinner-dark"></span>' : `<i data-lucide="${icon}"></i>`}</div>
        <div><span class="muted loc-label">Status lokasi</span><h2>${esc(title)}</h2></div>
      </div>
      ${metrics}
      ${body ? `<div class="loc-body">${body}</div>` : ''}
      ${canRetry ? `<div class="loc-actions">
        <button class="btn btn-ghost" id="btn-loc-refresh"><i data-lucide="refresh-cw"></i> Perbarui lokasi</button>
      </div>` : ''}`;

    const refresh = document.getElementById('btn-loc-refresh');
    if (refresh) refresh.onclick = startLocation;
    icons();
    renderTodayCard(); // validitas lokasi menentukan aktif/tidaknya tombol absen
  }

  function formatDistance(m) {
    return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2).replace('.', ',') + ' km';
  }

  /* ---------- Lokasi Sekolah (admin) ---------- */

  async function renderSchoolLocationView() {
    const view = document.getElementById('view');
    view.innerHTML = '<div class="card empty"><span class="spinner spinner-dark"></span></div>';
    let cfg;
    try {
      cfg = await Api.call('getLocationConfig');
      state.loc.config = cfg;
    } catch (err) {
      view.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      return;
    }
    if (state.tab !== 'lokasi') return;

    view.innerHTML = `
      <section class="card">
        <h2 class="card-title">Titik Lokasi Sekolah</h2>
        <p class="muted">Cara paling akurat: berdiri di <strong>titik tengah area sekolah</strong> (di luar ruangan),
          lalu ketuk <em>Gunakan lokasi saya sekarang</em>. Atau salin koordinat dari Google Maps.</p>
        <form id="loc-form" class="form" novalidate>
          <button type="button" class="btn btn-ghost" id="btn-use-gps"><i data-lucide="crosshair"></i> Gunakan lokasi saya sekarang</button>
          <p id="gps-note" class="muted small-note" hidden></p>
          <div class="form-row">
            <label>Latitude
              <input name="latitude" inputmode="decimal" autocomplete="off" placeholder="-6.2088123" value="${cfg.configured ? esc(cfg.lat) : ''}">
            </label>
            <label>Longitude
              <input name="longitude" inputmode="decimal" autocomplete="off" placeholder="106.8456789" value="${cfg.configured ? esc(cfg.lng) : ''}">
            </label>
          </div>
          <a id="maps-link" class="small-link" target="_blank" rel="noopener" hidden><i data-lucide="external-link"></i> Periksa titik di Google Maps</a>
          <div class="form-row">
            <label>Radius absensi (meter)
              <input name="radius" type="number" inputmode="numeric" min="10" max="1000" value="${esc(cfg.radius)}">
            </label>
            <label>Batas akurasi GPS (meter)
              <input name="maxAccuracy" type="number" inputmode="numeric" min="5" max="100" value="${esc(cfg.maxAccuracy)}">
            </label>
          </div>
          <small class="muted">Radius default 50 m. Batas akurasi: absensi ditolak bila GPS HP lebih buruk dari nilai ini (default 30 m).</small>
          <div id="loc-form-error" class="alert alert-error" hidden></div>
          <button type="submit" class="btn btn-primary"><i data-lucide="save"></i> Simpan Lokasi</button>
        </form>
      </section>`;
    icons();

    const form = document.getElementById('loc-form');
    const mapsLink = document.getElementById('maps-link');
    const updateMapsLink = () => {
      const lat = form.latitude.value.trim().replace(',', '.');
      const lng = form.longitude.value.trim().replace(',', '.');
      const ok = lat && lng && isFinite(lat) && isFinite(lng);
      mapsLink.hidden = !ok;
      if (ok) mapsLink.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lng);
    };
    form.latitude.oninput = form.longitude.oninput = updateMapsLink;
    updateMapsLink();

    document.getElementById('btn-use-gps').onclick = e => useCurrentPositionForSchool(e.currentTarget, form, updateMapsLink);

    form.onsubmit = async e => {
      e.preventDefault();
      const errBox = document.getElementById('loc-form-error');
      errBox.hidden = true;
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try {
          const saved = await Api.call('adminUpdateLocation', {
            latitude: form.latitude.value, longitude: form.longitude.value,
            radius: form.radius.value, maxAccuracy: form.maxAccuracy.value,
          });
          state.loc.config = saved;
          form.latitude.value = saved.lat;
          form.longitude.value = saved.lng;
          updateMapsLink();
          toast('Lokasi sekolah disimpan.', 'success');
        } catch (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
        }
      });
    };
  }

  async function useCurrentPositionForSchool(button, form, onChange) {
    const note = document.getElementById('gps-note');
    note.hidden = false;
    note.textContent = 'Mengambil lokasi terbaik selama maksimal 15 detik… tetap diam di tempat.';
    await withLoading(button, async () => {
      try {
        const p = await Geo.bestPosition(15000, 8);
        form.latitude.value = p.lat.toFixed(7);
        form.longitude.value = p.lng.toFixed(7);
        onChange();
        note.textContent = `Lokasi didapat dengan akurasi ±${Math.round(p.accuracy)} m.` +
          (p.accuracy > 15 ? ' Akurasi kurang baik — sebaiknya ulangi di area terbuka.' : ' Periksa di Google Maps, lalu Simpan.');
      } catch (err) {
        const messages = {
          denied: 'Izin lokasi ditolak. Izinkan akses lokasi untuk situs ini lalu coba lagi.',
          unavailable: 'GPS tidak aktif. Aktifkan Lokasi di HP lalu coba lagi.',
          timeout: 'Lokasi belum didapat. Coba lagi di area terbuka.',
          unsupported: 'Browser ini tidak mendukung GPS.',
        };
        note.textContent = messages[err.status] || 'Gagal mengambil lokasi.';
      }
    });
  }

  /* ---------- Jam Kerja (admin) ---------- */

  const NAMA_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

  async function renderScheduleView() {
    const view = document.getElementById('view');
    view.innerHTML = '<div class="card empty"><span class="spinner spinner-dark"></span></div>';
    let s;
    try {
      s = await Api.call('adminGetSchedule');
    } catch (err) {
      view.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      return;
    }
    if (state.tab !== 'jadwal') return;

    const timeField = (name, label, value, help) => `
      <label>${label}
        <input name="${name}" type="time" required value="${esc(value)}">
        <small>${help}</small>
      </label>`;

    view.innerHTML = `
      <section class="card">
        <h2 class="card-title">Jam Kerja</h2>
        <p class="muted">Berlaku untuk semua guru (TK &amp; SD). Perubahan langsung berlaku setelah disimpan.</p>
        <form id="schedule-form" class="form" novalidate>
          <div class="form-row">
            ${timeField('jamMasuk', 'Jam masuk', s.jamMasuk, 'Jam mulai kerja.')}
            ${timeField('batasTerlambat', 'Batas terlambat', s.batasTerlambat, 'Absen setelah jam ini = Terlambat.')}
          </div>
          <div class="form-row">
            ${timeField('batasAbsenMasuk', 'Absen masuk ditutup', s.batasAbsenMasuk, 'Setelah jam ini tidak bisa absen masuk.')}
            ${timeField('jamPulang', 'Jam pulang', s.jamPulang, 'Absen pulang mulai jam ini.')}
          </div>
          <fieldset class="days">
            <legend>Hari kerja</legend>
            ${NAMA_HARI.map((nama, i) => `
              <label class="day-chip">
                <input type="checkbox" name="hariKerja" value="${i + 1}" ${s.hariKerja.includes(i + 1) ? 'checked' : ''}>
                <span>${nama}</span>
              </label>`).join('')}
          </fieldset>
          <div id="schedule-error" class="alert alert-error" hidden></div>
          <button type="submit" class="btn btn-primary"><i data-lucide="save"></i> Simpan Jam Kerja</button>
        </form>
      </section>`;
    icons();

    const form = document.getElementById('schedule-form');
    form.onsubmit = async e => {
      e.preventDefault();
      const errBox = document.getElementById('schedule-error');
      errBox.hidden = true;
      const f = new FormData(form);
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try {
          await Api.call('adminUpdateSchedule', {
            jamMasuk: f.get('jamMasuk'),
            batasTerlambat: f.get('batasTerlambat'),
            batasAbsenMasuk: f.get('batasAbsenMasuk'),
            jamPulang: f.get('jamPulang'),
            hariKerja: f.getAll('hariKerja').map(Number),
          });
          toast('Jam kerja disimpan.', 'success');
        } catch (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
        }
      });
    };
  }

  /* ---------- Kelola Pengguna (admin) ---------- */

  async function renderUsersView() {
    const view = document.getElementById('view');
    view.innerHTML = `
      <div class="toolbar">
        <div class="search">
          <i data-lucide="search"></i>
          <input id="user-search" type="search" placeholder="Cari nama atau email" value="${esc(state.userSearch)}">
        </div>
        <button class="btn btn-primary" id="btn-add-user"><i data-lucide="user-plus"></i> Tambah</button>
      </div>
      <div id="user-list" class="list"><div class="empty"><span class="spinner spinner-dark"></span></div></div>`;
    icons();

    document.getElementById('btn-add-user').onclick = () => openUserForm(null);
    document.getElementById('user-search').oninput = e => {
      state.userSearch = e.target.value;
      renderUserList();
    };

    try {
      state.users = await Api.call('adminListUsers');
      renderUserList();
    } catch (err) {
      const list = document.getElementById('user-list');
      if (list) list.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  }

  function renderUserList() {
    const list = document.getElementById('user-list');
    if (!list) return;
    const q = state.userSearch.trim().toLowerCase();
    const rows = state.users.filter(u =>
      !q || String(u.nama).toLowerCase().includes(q) || String(u.email).toLowerCase().includes(q));

    if (!rows.length) {
      list.innerHTML = `<div class="empty">${q ? 'Tidak ada pengguna yang cocok.' : 'Belum ada pengguna.'}</div>`;
      return;
    }

    const total = state.users.length;
    const guru = state.users.filter(u => u.role === 'guru').length;
    list.innerHTML = `
      <p class="muted list-summary">${total} pengguna · ${guru} guru</p>
      ${rows.map(u => {
        const self = u.userId === state.user.userId;
        const active = u.statusAkun === 'aktif';
        return `
          <article class="card user-row ${active ? '' : 'inactive'}">
            <div class="avatar avatar-sm">${esc(initials(u.nama))}</div>
            <div class="user-main">
              <strong>${esc(u.nama)}${self ? ' <span class="muted">(Anda)</span>' : ''}</strong>
              <span class="muted user-email">${esc(u.email)}</span>
              <div class="badges">
                <span class="badge badge-${esc(u.role)}">${esc(ROLE_LABEL[u.role] || u.role)}</span>
                ${u.jenjang ? `<span class="badge">${esc(u.jenjang)}</span>` : ''}
                ${active ? '' : '<span class="badge badge-off">Nonaktif</span>'}
              </div>
            </div>
            <div class="row-actions">
              <button class="icon-btn" data-edit="${esc(u.userId)}" aria-label="Ubah" title="Ubah"><i data-lucide="pencil"></i></button>
              ${self ? '' : `
                <button class="icon-btn" data-toggle="${esc(u.userId)}" aria-label="${active ? 'Nonaktifkan' : 'Aktifkan'}" title="${active ? 'Nonaktifkan' : 'Aktifkan'}"><i data-lucide="${active ? 'user-x' : 'user-check'}"></i></button>
                <button class="icon-btn icon-btn-danger" data-delete="${esc(u.userId)}" aria-label="Hapus" title="Hapus"><i data-lucide="trash-2"></i></button>`}
            </div>
          </article>`;
      }).join('')}`;

    const byId = id => state.users.find(u => u.userId === id);
    list.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => openUserForm(byId(b.dataset.edit)); });
    list.querySelectorAll('[data-toggle]').forEach(b => { b.onclick = () => toggleUser(b, byId(b.dataset.toggle)); });
    list.querySelectorAll('[data-delete]').forEach(b => { b.onclick = () => deleteUser(b, byId(b.dataset.delete)); });
    icons();
  }

  function replaceUser(updated) {
    const i = state.users.findIndex(u => u.userId === updated.userId);
    if (i >= 0) state.users[i] = updated; else state.users.push(updated);
    state.users.sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
    if (updated.userId === state.user.userId) {
      state.user = updated;
      const s = Api.getSession();
      if (s) Api.saveSession(Object.assign({}, s, { user: updated }));
    }
  }

  function openUserForm(user) {
    const isEdit = !!user;
    const u = user || { nama: '', email: '', nip: '', role: 'guru', jenjang: '', statusAkun: 'aktif' };
    const self = isEdit && u.userId === state.user.userId;

    openModal(isEdit ? 'Ubah Pengguna' : 'Tambah Pengguna', (body, close) => {
      body.innerHTML = `
        <form id="user-form" class="form" novalidate>
          <label>Nama lengkap
            <input name="nama" required maxlength="100" value="${esc(u.nama)}" autocomplete="off">
          </label>
          <label>Email Google
            <input name="email" type="email" required maxlength="254" value="${esc(u.email)}" autocomplete="off" placeholder="nama@gmail.com">
            <small>Email ini yang dipakai guru untuk login.</small>
          </label>
          <label>NIP <span class="muted">(opsional)</span>
            <input name="nip" inputmode="numeric" maxlength="30" value="${esc(u.nip)}" autocomplete="off">
          </label>
          <div class="form-row">
            <label>Peran
              <select name="role" ${self ? 'disabled' : ''}>
                <option value="guru" ${u.role === 'guru' ? 'selected' : ''}>Guru</option>
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
              </select>
            </label>
            <label>Jenjang
              <select name="jenjang">
                <option value="" ${!u.jenjang ? 'selected' : ''}>—</option>
                <option value="TK" ${u.jenjang === 'TK' ? 'selected' : ''}>TK</option>
                <option value="SD" ${u.jenjang === 'SD' ? 'selected' : ''}>SD</option>
              </select>
            </label>
          </div>
          ${isEdit && !self ? `
            <label>Status akun
              <select name="statusAkun">
                <option value="aktif" ${u.statusAkun === 'aktif' ? 'selected' : ''}>Aktif</option>
                <option value="nonaktif" ${u.statusAkun === 'nonaktif' ? 'selected' : ''}>Nonaktif</option>
              </select>
            </label>` : ''}
          <div id="form-error" class="alert alert-error" hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-cancel>Batal</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Simpan' : 'Tambah'}</button>
          </div>
        </form>`;

      const form = body.querySelector('#user-form');
      body.querySelector('[data-cancel]').onclick = close;
      form.onsubmit = async e => {
        e.preventDefault();
        const f = new FormData(form);
        const payload = {
          nama: f.get('nama'),
          email: f.get('email'),
          nip: f.get('nip'),
          role: self ? u.role : f.get('role'),
          jenjang: f.get('jenjang'),
        };
        const errBox = body.querySelector('#form-error');
        errBox.hidden = true;
        if (payload.role === 'guru' && !payload.jenjang) {
          errBox.textContent = 'Pilih jenjang (TK atau SD) untuk guru.';
          errBox.hidden = false;
          return;
        }
        await withLoading(form.querySelector('[type=submit]'), async () => {
          try {
            const saved = isEdit
              ? await Api.call('adminUpdateUser', Object.assign(payload, {
                userId: u.userId, statusAkun: self ? u.statusAkun : f.get('statusAkun'),
              }))
              : await Api.call('adminCreateUser', payload);
            replaceUser(saved);
            close();
            toast(isEdit ? 'Data pengguna disimpan.' : 'Pengguna ditambahkan.', 'success');
            renderUserList();
          } catch (err) {
            errBox.textContent = err.message;
            errBox.hidden = false;
          }
        });
      };
    });
  }

  async function toggleUser(button, u) {
    const activate = u.statusAkun !== 'aktif';
    const ok = await confirm(
      activate ? 'Aktifkan Akun' : 'Nonaktifkan Akun',
      activate
        ? `${u.nama} akan dapat login kembali.`
        : `${u.nama} tidak akan dapat login dan sesi aktifnya akan diakhiri. Data absensinya tetap tersimpan.`,
      activate ? 'Aktifkan' : 'Nonaktifkan', !activate);
    if (!ok) return;
    await withLoading(button, async () => {
      try {
        const saved = await Api.call('adminUpdateUser', {
          userId: u.userId, nama: u.nama, email: u.email, nip: u.nip, role: u.role, jenjang: u.jenjang,
          statusAkun: activate ? 'aktif' : 'nonaktif',
        });
        replaceUser(saved);
        toast(activate ? 'Akun diaktifkan.' : 'Akun dinonaktifkan.', 'success');
        renderUserList();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  async function deleteUser(button, u) {
    const ok = await confirm('Hapus Pengguna',
      `Hapus akun ${u.nama} (${u.email})? Ia tidak akan bisa login lagi. Riwayat absensi yang sudah tercatat tetap tersimpan. Jika hanya ingin memblokir sementara, gunakan Nonaktifkan.`,
      'Hapus', true);
    if (!ok) return;
    await withLoading(button, async () => {
      try {
        await Api.call('adminDeleteUser', { userId: u.userId });
        state.users = state.users.filter(x => x.userId !== u.userId);
        toast('Pengguna dihapus.', 'success');
        renderUserList();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);

/**
 * app.js — Inti aplikasi: sesi, halaman login, kerangka (navigasi bawah di HP,
 * sidebar di desktop), dan perpindahan halaman. Isi halaman ada di guru.js,
 * admin.js, dan leave.js.
 */
const App = (() => {
  const { esc, icons, toast, confirm, openModal, initials } = UI;

  const state = {
    school: { schoolName: 'Yayasan Arrahman Nurrahim', schoolLogoUrl: '' },
    user: null,
    tab: null,
    badges: {},
    leaveHandlers: [],
  };

  const NAV = {
    guru: [
      { id: 'beranda', icon: 'house', label: 'Beranda', title: 'Beranda', render: v => Guru.home(v) },
      { id: 'riwayat', icon: 'calendar-days', label: 'Riwayat', title: 'Riwayat Absensi', render: v => Guru.history(v) },
      { id: 'izin', icon: 'file-plus', label: 'Izin/Sakit', title: 'Izin & Sakit', render: v => Leave.renderMine(v) },
      { id: 'profil', icon: 'circle-user-round', label: 'Profil', title: 'Profil Saya', render: v => Guru.profile(v) },
    ],
    admin: [
      { id: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard', title: 'Dashboard', render: v => Admin.dashboard(v) },
      { id: 'pengajuan', icon: 'file-check', label: 'Pengajuan', title: 'Pengajuan Izin & Sakit', render: v => Leave.renderAdmin(v) },
      { id: 'guru', icon: 'users', label: 'Guru', title: 'Data Guru', render: v => Admin.users(v) },
      { id: 'log', icon: 'scroll-text', label: 'Log', title: 'Log Aktivitas', render: v => Admin.audit(v) },
      { id: 'pengaturan', icon: 'settings', label: 'Pengaturan', title: 'Pengaturan', render: v => Admin.settings(v) },
    ],
  };

  const root = () => document.getElementById('app');
  const navFor = () => NAV[state.user && state.user.role === 'admin' ? 'admin' : 'guru'];

  /* ---------- Inisialisasi ---------- */

  async function init() {
    window.addEventListener('session-expired', e => {
      runLeaveHandlers();
      state.user = null;
      toast(e.detail || 'Sesi berakhir. Silakan login kembali.', 'error');
      renderLogin();
    });

    loadPublicConfig();

    const session = Api.getSession();
    if (!session) return renderLogin();

    state.user = session.user;
    renderShell();
    try {
      // Validasi ulang sesi & ambil profil terbaru.
      const { user } = await Api.call('me');
      const roleChanged = user.role !== state.user.role;
      state.user = user;
      Api.saveSession(Object.assign({}, session, { user }));
      if (roleChanged) { state.tab = null; renderShell(); } else updateUserBits();
    } catch (err) {
      if (err.code !== 'SESSION_INVALID') toast(err.message, 'error');
    }
  }

  async function loadPublicConfig() {
    try {
      const cfg = await Api.call('getPublicConfig');
      setSchoolName(cfg.schoolName);
    } catch (e) { /* nama default tetap dipakai */ }
  }

  function setSchoolName(name) {
    if (name) state.school.schoolName = name;
    document.querySelectorAll('[data-school-name]').forEach(el => { el.textContent = state.school.schoolName; });
  }

  /* ---------- Login ---------- */

  function renderLogin() {
    document.title = 'Masuk — Absensi Guru';
    root().innerHTML = `
      <main class="login">
        <section class="login-hero">
          <div class="login-brand">
            ${Brand.logo(40)}
            <div><strong>Absensi Guru</strong><span data-school-name>${esc(state.school.schoolName)}</span></div>
          </div>
          ${Brand.schoolScene()}
        </section>
        <section class="login-panel">
          <h1>Selamat datang</h1>
          <p class="lead">Masuk dengan akun Google yang sudah didaftarkan admin sekolah.</p>
          <div id="google-btn" class="google-btn"><span class="spinner spinner-dark"></span></div>
          <div id="login-error" class="alert alert-error" hidden></div>
          <ul class="login-points">
            <li><span class="pt-icon"><i data-lucide="map-pin-check"></i></span>
              <div><strong>Absen di area sekolah</strong>Lokasi GPS diperiksa ulang oleh server.</div></li>
            <li><span class="pt-icon"><i data-lucide="clock-3"></i></span>
              <div><strong>Jam server WIB</strong>Waktu absen tidak bergantung jam HP.</div></li>
            <li><span class="pt-icon"><i data-lucide="shield-check"></i></span>
              <div><strong>Aman dengan akun Google</strong>Tanpa password tambahan.</div></li>
          </ul>
          <p class="login-foot">TK &amp; SD <span data-school-name>${esc(state.school.schoolName)}</span> · <a href="privacy.html">Kebijakan Privasi</a></p>
        </section>
      </main>`;
    icons();
    renderGoogleButton();
  }

  /** Menunggu Google Identity Services siap, lalu menampilkan tombol login. */
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
      theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'id',
      width: Math.min(360, el.clientWidth || 320),
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
      state.tab = null;
      renderShell();
      toast('Selamat datang, ' + result.user.nama + '.', 'success');
    } catch (err) {
      showLoginError(err.message);
    } finally {
      btn.classList.remove('is-loading');
    }
  }

  async function logout() {
    const ok = await confirm('Keluar', 'Keluar dari aplikasi di perangkat ini?', 'Keluar');
    if (!ok) return;
    runLeaveHandlers();
    try { await Api.call('logout'); } catch (e) { /* sesi tetap dihapus di perangkat */ }
    Api.clearSession();
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    state.user = null;
    state.tab = null;
    renderLogin();
  }

  /* ---------- Kerangka ---------- */

  function renderShell() {
    const nav = navFor();
    if (!nav.some(n => n.id === state.tab)) state.tab = nav[0].id;
    const u = state.user;
    const roleLabel = u.role === 'admin' ? 'Admin' : 'Guru' + (u.jenjang ? ' ' + u.jenjang : '');

    root().innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <div class="side-brand">${Brand.logo(38)}<div><strong>Absensi Guru</strong><span data-school-name>${esc(state.school.schoolName)}</span></div></div>
          <nav class="side-nav" aria-label="Menu utama">
            ${nav.map(n => `<button class="side-item" data-nav="${n.id}"><i data-lucide="${n.icon}"></i>${n.label}<span class="nav-badge" data-badge="${n.id}" hidden></span></button>`).join('')}
          </nav>
          <div class="side-user">
            <div class="avatar avatar-sm" data-user-initials>${esc(initials(u.nama))}</div>
            <div><strong data-user-name>${esc(u.nama)}</strong><span>${esc(roleLabel)}</span></div>
            <button class="icon-btn" data-logout aria-label="Keluar" title="Keluar"><i data-lucide="log-out"></i></button>
          </div>
        </aside>
        <div class="main">
          <header class="appbar">
            <div class="appbar-inner">
              <span class="appbar-logo">${Brand.logo(34)}</span>
              <div class="appbar-title"><strong id="page-title"></strong><span data-school-name>${esc(state.school.schoolName)}</span></div>
              <button class="avatar-btn" id="btn-account" aria-label="Akun saya">
                <span class="avatar avatar-sm" data-user-initials>${esc(initials(u.nama))}</span>
              </button>
            </div>
          </header>
          <main class="content" id="view"></main>
        </div>
        <nav class="bottom-nav" aria-label="Menu utama">
          ${nav.map(n => `<button class="nav-item" data-nav="${n.id}"><i data-lucide="${n.icon}"></i><span>${n.label}</span><span class="nav-badge" data-badge="${n.id}" hidden></span></button>`).join('')}
        </nav>
      </div>`;

    root().querySelectorAll('[data-nav]').forEach(b => { b.onclick = () => go(b.dataset.nav); });
    root().querySelectorAll('[data-logout]').forEach(b => { b.onclick = logout; });
    document.getElementById('btn-account').onclick = openAccount;
    Object.keys(state.badges).forEach(k => setBadge(k, state.badges[k]));
    go(state.tab, true);
  }

  /** Pindah halaman. Menjalankan pembersihan halaman sebelumnya (GPS, jam, dll.). */
  function go(tab, force) {
    if (tab === state.tab && !force) return;
    runLeaveHandlers();
    const nav = navFor();
    const item = nav.find(n => n.id === tab) || nav[0];
    state.tab = item.id;
    root().querySelectorAll('[data-nav]').forEach(b => {
      const active = b.dataset.nav === item.id;
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.getElementById('page-title').textContent = item.title;
    document.title = item.title + ' — Absensi Guru';
    const view = document.getElementById('view');
    view.innerHTML = '';
    window.scrollTo(0, 0);
    item.render(view);
    icons();
  }

  /** Mendaftarkan fungsi yang dijalankan saat meninggalkan halaman. */
  function onLeave(fn) {
    state.leaveHandlers.push(fn);
  }

  function runLeaveHandlers() {
    const handlers = state.leaveHandlers;
    state.leaveHandlers = [];
    handlers.forEach(fn => { try { fn(); } catch (e) { /* abaikan */ } });
  }

  function setBadge(tab, count) {
    state.badges[tab] = count;
    document.querySelectorAll(`[data-badge="${tab}"]`).forEach(el => {
      el.textContent = count > 99 ? '99+' : String(count);
      el.hidden = !count;
    });
  }

  function setUser(user) {
    state.user = user;
    const s = Api.getSession();
    if (s) Api.saveSession(Object.assign({}, s, { user }));
    updateUserBits();
  }

  function updateUserBits() {
    document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = state.user.nama; });
    document.querySelectorAll('[data-user-initials]').forEach(el => { el.textContent = initials(state.user.nama); });
  }

  function openAccount() {
    const u = state.user;
    openModal('Akun', (body, close) => {
      body.innerHTML = `
        <div class="profile-head">
          <div class="avatar avatar-lg">${esc(initials(u.nama))}</div>
          <div><h2>${esc(u.nama)}</h2><span class="muted">${esc(u.email)}</span></div>
        </div>
        <div class="modal-actions">
          ${u.role !== 'admin' ? '<button class="btn btn-ghost" data-profile><i data-lucide="circle-user-round"></i> Profil</button>' : ''}
          <button class="btn btn-danger" data-out><i data-lucide="log-out"></i> Keluar</button>
        </div>`;
      const p = body.querySelector('[data-profile]');
      if (p) p.onclick = () => { close(); go('profil'); };
      body.querySelector('[data-out]').onclick = () => { close(); logout(); };
    });
  }

  return { init, state, go, onLeave, setBadge, setUser, setSchoolName, logout };
})();

document.addEventListener('DOMContentLoaded', App.init);

/**
 * app.js — Inti aplikasi: sesi, halaman login, kerangka (navigasi bawah di HP,
 * sidebar di desktop), dan perpindahan halaman. Isi halaman ada di guru.js,
 * admin.js, dan leave.js.
 */
const App = (() => {
  const { esc, icons, toast, confirm, initials } = UI;

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
      { id: 'laporan', icon: 'file-bar-chart', label: 'Laporan', title: 'Laporan', render: v => Admin.reports(v) },
      { id: 'pengajuan', icon: 'file-check', label: 'Pengajuan', title: 'Pengajuan Izin & Sakit', render: v => Leave.renderAdmin(v) },
      { id: 'guru', icon: 'users', label: 'Guru', title: 'Data Guru', render: v => Admin.users(v) },
      // Log tidak muncul di menu bawah HP (maks. 5 menu); dibuka dari Pengaturan.
      { id: 'log', icon: 'scroll-text', label: 'Log', title: 'Log Aktivitas', render: v => Admin.audit(v), mobile: false },
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

  /* Langkah login dengan kode email */
  const otp = { email: '', resendAt: 0, timer: null };

  function renderLogin() {
    document.title = 'Masuk — Absensi Guru';
    clearInterval(otp.timer);
    root().innerHTML = `
      <main class="auth">
        <div class="auth-wrap">
          <section class="auth-side" aria-hidden="true">
            <div class="auth-side-brand">${Brand.logo(44)}<div><strong>Absensi Guru</strong><span data-school-name>${esc(state.school.schoolName)}</span></div></div>
            <h2>Absensi guru yang tercatat rapi, dari halaman sekolah.</h2>
            ${Brand.schoolScene()}
            <ul class="auth-points">
              <li><i data-lucide="map-pin-check"></i> Lokasi GPS diverifikasi server</li>
              <li><i data-lucide="clock-3"></i> Jam server WIB, bukan jam HP</li>
              <li><i data-lucide="shield-check"></i> Data tersimpan aman di akun sekolah</li>
            </ul>
          </section>

          <section class="glass auth-card">
            <div class="auth-head">
              ${Brand.logo(48)}
              <div><strong>Absensi Guru</strong><span data-school-name>${esc(state.school.schoolName)}</span></div>
            </div>
            <div class="auth-scene">${Brand.schoolScene()}</div>
            <h1>Masuk ke akun Anda</h1>
            <p class="auth-lead">Gunakan akun yang sudah didaftarkan admin sekolah.</p>

            <div id="google-btn" class="google-btn"><span class="spinner spinner-dark"></span></div>
            <p class="auth-hint">Akun Google belum tersimpan di HP ini? Di jendela Google pilih <b>Gunakan akun lain</b>.</p>

            <div class="auth-divider"><span>atau masuk dengan kode email</span></div>

            <form id="otp-email-form" class="auth-form" novalidate>
              <label class="field">
                <span class="field-label">Email terdaftar</span>
                <span class="field-box"><i data-lucide="mail"></i>
                  <input name="email" type="email" inputmode="email" autocomplete="email" placeholder="nama@gmail.com" required value="${esc(otp.email)}">
                </span>
              </label>
              <button class="btn btn-primary btn-block btn-lg" type="submit"><i data-lucide="send"></i> Kirim kode masuk</button>
            </form>

            <form id="otp-code-form" class="auth-form" novalidate hidden>
              <div class="otp-sent">
                <i data-lucide="mail-check"></i>
                <div>Kode 6 angka dikirim ke <b id="otp-email-label"></b> bila email itu terdaftar. Periksa juga folder <b>Spam</b>.</div>
              </div>
              <label class="field">
                <span class="field-label">Kode masuk</span>
                <input class="otp-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="••••••" required>
              </label>
              <button class="btn btn-primary btn-block btn-lg" type="submit"><i data-lucide="log-in"></i> Masuk</button>
              <div class="otp-actions">
                <button type="button" class="link-btn" id="otp-change">Ganti email</button>
                <button type="button" class="link-btn" id="otp-resend" disabled>Kirim ulang</button>
              </div>
            </form>

            <div id="login-error" class="alert alert-error" role="alert" hidden></div>
            <p class="auth-foot">TK &amp; SD · <a href="privacy.html">Kebijakan Privasi</a></p>
          </section>
        </div>
      </main>`;
    icons();
    renderGoogleButton();
    bindOtpForms();
  }

  function bindOtpForms() {
    const emailForm = document.getElementById('otp-email-form');
    const codeForm = document.getElementById('otp-code-form');
    const resend = document.getElementById('otp-resend');

    const scene = document.querySelector('.auth-scene');
    const showCodeStep = () => {
      emailForm.hidden = true;
      codeForm.hidden = false;
      scene.hidden = true; // beri ruang agar formulir kode muat satu layar HP
      document.getElementById('otp-email-label').textContent = otp.email;
      codeForm.code.value = '';
      codeForm.code.focus();
      clearInterval(otp.timer);
      const tick = () => {
        const left = Math.ceil((otp.resendAt - Date.now()) / 1000);
        resend.disabled = left > 0;
        resend.textContent = left > 0 ? `Kirim ulang (${left} d)` : 'Kirim ulang';
        if (left <= 0) clearInterval(otp.timer);
      };
      tick();
      otp.timer = setInterval(tick, 1000);
    };

    const requestCode = async button => {
      showLoginError('');
      const ok = await UI.withLoading(button, async () => {
        try {
          await Api.call('requestLoginCode', { email: otp.email });
          otp.resendAt = Date.now() + 60000;
          return true;
        } catch (err) {
          showLoginError(err.message);
          return false;
        }
      });
      if (ok) showCodeStep();
    };

    emailForm.onsubmit = e => {
      e.preventDefault();
      const email = emailForm.email.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showLoginError('Masukkan alamat email yang valid.');
      otp.email = email;
      requestCode(emailForm.querySelector('[type=submit]'));
    };

    codeForm.code.oninput = () => {
      codeForm.code.value = codeForm.code.value.replace(/\D/g, '').slice(0, 6);
      if (codeForm.code.value.length === 6) codeForm.requestSubmit();
    };

    codeForm.onsubmit = async e => {
      e.preventDefault();
      const code = codeForm.code.value;
      if (!/^\d{6}$/.test(code)) return showLoginError('Kode terdiri dari 6 angka.');
      showLoginError('');
      await UI.withLoading(codeForm.querySelector('[type=submit]'), async () => {
        try {
          const result = await Api.call('verifyLoginCode', { email: otp.email, code });
          clearInterval(otp.timer);
          finishLogin(result);
        } catch (err) {
          showLoginError(err.message);
          codeForm.code.select();
        }
      });
    };

    resend.onclick = () => requestCode(resend);
    document.getElementById('otp-change').onclick = () => {
      clearInterval(otp.timer);
      codeForm.hidden = true;
      emailForm.hidden = false;
      scene.hidden = false;
      showLoginError('');
      emailForm.email.focus();
    };
  }

  function finishLogin(result) {
    Api.saveSession({ token: result.token, expiresAt: result.expiresAt, user: result.user });
    state.user = result.user;
    state.tab = null;
    renderShell();
    toast('Selamat datang, ' + result.user.nama + '.', 'success');
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
      finishLogin(await Api.call('loginGoogle', { credential: response.credential }));
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
          ${nav.filter(n => n.mobile !== false).map(n => `<button class="nav-item" data-nav="${n.id}"><i data-lucide="${n.icon}"></i><span>${n.label}</span><span class="nav-badge" data-badge="${n.id}" hidden></span></button>`).join('')}
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

  /** Menu akun kecil yang menempel di bawah ikon profil (bukan panel selebar layar). */
  function openAccount() {
    const existing = document.getElementById('account-menu');
    if (existing) return existing.remove();
    const u = state.user;
    const btn = document.getElementById('btn-account');
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'account-menu';
    menu.className = 'account-menu';
    menu.setAttribute('role', 'menu');
    menu.style.top = Math.round(rect.bottom + 8) + 'px';
    menu.style.right = Math.max(12, Math.round(window.innerWidth - rect.right)) + 'px';
    menu.innerHTML = `
      <div class="am-user">
        <div class="avatar avatar-sm">${esc(initials(u.nama))}</div>
        <div><strong>${esc(u.nama)}</strong><span>${esc(u.email)}</span></div>
      </div>
      ${u.role !== 'admin' ? '<button class="am-item" role="menuitem" data-profile><i data-lucide="circle-user-round"></i> Profil saya</button>' : ''}
      <button class="am-item am-danger" role="menuitem" data-out><i data-lucide="log-out"></i> Keluar</button>`;
    document.body.appendChild(menu);
    icons();

    const close = () => {
      menu.remove();
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey);
    };
    const onOutside = e => { if (!menu.contains(e.target) && !btn.contains(e.target)) close(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
    const p = menu.querySelector('[data-profile]');
    if (p) p.onclick = () => { close(); go('profil'); };
    menu.querySelector('[data-out]').onclick = () => { close(); logout(); };
    onLeave(close);
  }

  return { init, state, go, onLeave, setBadge, setUser, setSchoolName, logout };
})();

document.addEventListener('DOMContentLoaded', App.init);

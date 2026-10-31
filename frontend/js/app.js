/**
 * app.js — Alur utama aplikasi: login Google, tampilan profil, dan
 * Kelola Pengguna (khusus admin).
 */
const App = (() => {
  const { esc, icons, toast, withLoading, openModal, confirm, initials } = UI;
  const root = () => document.getElementById('app');

  const state = {
    school: { schoolName: 'Yayasan Arrahman Nurrahim', schoolLogoUrl: '' },
    user: null,
    tab: 'profil',
    users: [],
    userSearch: '',
  };

  const ROLE_LABEL = { admin: 'Admin', guru: 'Guru' };

  /* ---------- Inisialisasi ---------- */

  async function init() {
    window.addEventListener('session-expired', e => {
      state.user = null;
      toast(e.detail || 'Sesi berakhir. Silakan login kembali.', 'error');
      renderLogin();
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
      renderApp();
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
      state.tab = 'profil';
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
    try { await Api.call('logout'); } catch (e) { /* sesi tetap dihapus di perangkat */ }
    Api.clearSession();
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    state.user = null;
    renderLogin();
  }

  /* ---------- Kerangka aplikasi ---------- */

  function renderApp() {
    const u = state.user;
    const isAdmin = u.role === 'admin';
    if (!isAdmin) state.tab = 'profil';

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
          <button class="tab ${state.tab === 'profil' ? 'active' : ''}" data-tab="profil"><i data-lucide="user"></i> Profil</button>
          <button class="tab ${state.tab === 'pengguna' ? 'active' : ''}" data-tab="pengguna"><i data-lucide="users"></i> Kelola Pengguna</button>
        </nav>` : ''}
      <main class="content" id="view"></main>`;

    document.getElementById('btn-logout').onclick = logout;
    root().querySelectorAll('[data-tab]').forEach(b => {
      b.onclick = () => { state.tab = b.dataset.tab; renderApp(); };
    });

    if (state.tab === 'pengguna') renderUsersView();
    else renderProfileView();
    icons();
  }

  /* ---------- Profil ---------- */

  function renderProfileView() {
    const u = state.user;
    document.getElementById('view').innerHTML = `
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
      document.getElementById('user-list').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
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

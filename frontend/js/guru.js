/**
 * guru.js — Halaman guru: Beranda (absen masuk/pulang + status lokasi GPS),
 * Riwayat bulanan, dan Profil.
 */
const Guru = (() => {
  const { esc, icons, toast, initials } = UI;

  const STATUS_CLASS = {
    'Hadir': 'st-hadir', 'Terlambat': 'st-terlambat', 'Izin': 'st-izin',
    'Sakit': 'st-sakit', 'Tanpa Keterangan': 'st-alpa', 'Belum absen': 'st-belum',
  };
  const DOT = { 'Hadir': '#166534', 'Terlambat': '#e8a317', 'Izin': '#2563eb', 'Sakit': '#a21caf', 'Tanpa Keterangan': '#dc2626' };

  const s = {
    today: null, todayError: '', clockOffset: 0, clockTimer: null, todayKey: '', submitting: false,
    loc: { config: null, status: 'idle', coords: null, samples: [], stop: null, gen: 0, renderKey: '', configError: '' },
    historyMonth: null,
  };

  /* ---------- Waktu ---------- */

  function serverNow() {
    return new Date(Date.now() + s.clockOffset);
  }

  function wibParts(date) {
    const p = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).forEach(x => { p[x.type] = x.value; });
    return { tanggal: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, jam: `${p.hour}:${p.minute}:${p.second}`, hour: Number(p.hour) };
  }

  function longDate(date) {
    return date.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function greeting(hour) {
    if (hour < 11) return 'Selamat pagi';
    if (hour < 15) return 'Selamat siang';
    if (hour < 18) return 'Selamat sore';
    return 'Selamat malam';
  }

  function shortTime(t) {
    return t ? String(t).slice(0, 5) : '--:--';
  }

  function statusPill(status) {
    return `<span class="status-pill ${STATUS_CLASS[status] || ''}">${esc(status)}</span>`;
  }

  function firstName(nama) {
    return String(nama || '').split(',')[0].trim();
  }

  /* ---------- Beranda ---------- */

  function home(view) {
    const u = App.state.user;
    const parts = wibParts(serverNow());
    view.innerHTML = `
      <div class="guru-grid">
        <div class="stack">
          <section class="hero">
            <div class="hero-greet" id="hero-greet">${esc(greeting(parts.hour))},</div>
            <div class="hero-name">${esc(firstName(u.nama))}</div>
            <div class="hero-meta">
              <span class="hero-chip">${esc(u.jenjang ? 'Guru ' + u.jenjang : 'Guru')}</span>
              <span class="hero-chip" data-school-name>${esc(App.state.school.schoolName)}</span>
            </div>
          </section>
          <section class="card today-card" id="today-card"></section>
          <section class="card loc-card" id="loc-card" aria-live="polite"></section>
          <div id="install-slot"></div>
        </div>
        <div class="stack">
          <h2 class="section-title">Bulan ini</h2>
          <div class="mini-stats" id="month-stats">${miniStats(null)}</div>
          <section class="card">
            <div class="card-head"><h2>Riwayat terakhir</h2><button class="link-btn" id="btn-all-history">Lihat semua</button></div>
            <div id="recent-list" class="hist-list"><div class="empty"><span class="spinner spinner-dark"></span></div></div>
          </section>
        </div>
      </div>`;
    document.getElementById('btn-all-history').onclick = () => App.go('riwayat');
    App.onLeave(Pwa.mountInstallCard(document.getElementById('install-slot')));

    s.todayKey = '';
    renderTodayCard();
    loadToday();
    startLocation();
    loadRecent();

    const onVisibility = () => {
      if (document.hidden) stopLocation();
      else if (document.getElementById('loc-card')) { startLocation(); loadToday(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    App.onLeave(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopLocation();
      stopClock();
    });
  }

  function miniStats(r) {
    const v = k => (r ? r[k] : '–');
    const item = (label, value, color) =>
      `<div class="mini-stat"><strong>${value}</strong><span><i class="dot" style="background:${color}"></i>${label}</span></div>`;
    return item('Hadir', v('Hadir'), DOT['Hadir']) + item('Terlambat', v('Terlambat'), DOT['Terlambat']) +
      item('Izin/Sakit', r ? r['Izin'] + r['Sakit'] : '–', DOT['Izin']) + item('Alpa', v('Tanpa Keterangan'), DOT['Tanpa Keterangan']);
  }

  function histItem(r) {
    const d = new Date(r.tanggal + 'T12:00:00+07:00');
    const day = d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short' });
    const label = d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long' });
    const times = r.jamMasuk
      ? `Masuk ${shortTime(r.jamMasuk)} · Pulang ${shortTime(r.jamPulang)}`
      : esc(String(r.keterangan || '').replace(/\s*\(SUB-[A-Z0-9]+\)$/, '') || '—');
    return `
      <div class="hist-item">
        <div class="hist-date"><strong>${d.getDate()}</strong><span>${esc(day)}</span></div>
        <div class="hist-main"><strong>${esc(label)}</strong><span>${times}</span></div>
        ${statusPill(r.status)}
      </div>`;
  }

  async function loadRecent() {
    const list = document.getElementById('recent-list');
    try {
      const res = await Api.call('myHistory');
      if (!list.isConnected) return;
      document.getElementById('month-stats').innerHTML = miniStats(res.ringkasan);
      const recent = res.records.slice(0, 5);
      list.innerHTML = recent.length
        ? recent.map(histItem).join('')
        : `<div class="empty">${Brand.emptyCalendar()}Belum ada absensi bulan ini.</div>`;
    } catch (err) {
      if (list.isConnected) list.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  }

  /* ---------- Absensi hari ini ---------- */

  async function loadToday() {
    try {
      const sentAt = Date.now();
      const today = await Api.call('getToday');
      s.clockOffset = today.serverNow - Math.round((sentAt + Date.now()) / 2);
      s.today = today;
      s.todayError = '';
    } catch (err) {
      s.todayError = err.message;
    }
    s.todayKey = '';
    renderTodayCard();
    startClock();
  }

  function startClock() {
    stopClock();
    s.clockTimer = setInterval(() => {
      if (!document.getElementById('today-card')) return stopClock();
      const parts = wibParts(serverNow());
      const clock = document.getElementById('clock');
      if (clock) clock.textContent = parts.jam;
      if (s.today && parts.tanggal !== s.today.tanggal) return loadToday(); // lewat tengah malam
      renderTodayCard();
    }, 1000);
  }

  function stopClock() {
    if (s.clockTimer) clearInterval(s.clockTimer);
    s.clockTimer = null;
  }

  function attendancePhase() {
    const t = s.today;
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
    if (hm > t.schedule.batasAbsenMasuk) return { phase: 'closed', note: `Absen masuk sudah ditutup pukul ${t.schedule.batasAbsenMasuk} WIB.` };
    return { phase: 'checkin' };
  }

  function locationIsValid() {
    const loc = s.loc;
    return loc.status === 'ok' && loc.coords && loc.config && loc.config.configured && localVerdict().valid;
  }

  function renderTodayCard() {
    const card = document.getElementById('today-card');
    if (!card) return;
    const t = s.today;
    const ph = attendancePhase();
    const locOk = locationIsValid();
    const r = t && t.record;

    const key = [ph.phase, locOk, s.submitting, r && r.jamMasuk, r && r.jamPulang, r && r.status, s.todayError].join('|');
    if (key === s.todayKey) return;
    s.todayKey = key;

    if (!t) {
      card.innerHTML = s.todayError
        ? `<div class="alert alert-error">${esc(s.todayError)}</div>
           <button class="btn btn-ghost" id="btn-today-retry"><i data-lucide="refresh-cw"></i> Coba lagi</button>`
        : '<div class="empty"><span class="spinner spinner-dark"></span></div>';
      const retry = document.getElementById('btn-today-retry');
      if (retry) retry.onclick = loadToday;
      return icons();
    }

    const canIn = ph.phase === 'checkin' && locOk && !s.submitting;
    const canOut = ph.phase === 'checkout' && locOk && !s.submitting;
    let hint = ph.note || '';
    let hintIcon = 'info';
    if (!hint && !locOk) { hint = 'Tombol absen aktif setelah lokasi Anda valid (di dalam radius sekolah, akurasi GPS baik).'; hintIcon = 'map-pin'; }
    if (!hint && ph.phase === 'checkin') { hint = `Jam masuk ${t.schedule.jamMasuk} · terlambat setelah ${t.schedule.batasTerlambat} WIB.`; hintIcon = 'clock-3'; }
    if (ph.phase === 'done') hintIcon = 'circle-check';
    const spin = phase => (s.submitting && ph.phase === phase ? '<span class="spinner"></span>' : '');

    card.innerHTML = `
      <div class="today-head">
        <div>
          <div class="today-date">${esc(longDate(serverNow()))}</div>
          <div class="clock"><span id="clock">${esc(wibParts(serverNow()).jam)}</span> <small>WIB</small></div>
        </div>
        ${r && r.status ? statusPill(r.status) : ''}
      </div>
      <div class="today-times">
        <div class="time-tile"><span class="ic"><i data-lucide="log-in"></i></span><div><span>Jam masuk</span><strong>${esc(shortTime(r && r.jamMasuk))}</strong></div></div>
        <div class="time-tile"><span class="ic"><i data-lucide="log-out"></i></span><div><span>Jam pulang</span><strong>${esc(shortTime(r && r.jamPulang))}</strong></div></div>
      </div>
      <div class="attend-actions">
        <button class="btn btn-attend btn-in" id="btn-check-in" ${canIn ? '' : 'disabled'}>${spin('checkin') || '<i data-lucide="fingerprint"></i>'} ABSEN MASUK</button>
        <button class="btn btn-attend btn-out" id="btn-check-out" ${canOut ? '' : 'disabled'}>${spin('checkout') || '<i data-lucide="door-open"></i>'} ABSEN PULANG</button>
      </div>
      ${hint ? `<p class="attend-hint"><i data-lucide="${hintIcon}"></i><span>${esc(hint)}</span></p>` : ''}`;

    document.getElementById('btn-check-in').onclick = () => submitAttendance('checkIn');
    document.getElementById('btn-check-out').onclick = () => submitAttendance('checkOut');
    icons();
  }

  /** Mengirim absen beserta lokasi terkini. Server memvalidasi ulang semuanya. */
  async function submitAttendance(action) {
    if (s.submitting || !locationIsValid()) return;
    const { coords, samples } = s.loc;
    s.submitting = true;
    renderTodayCard();
    try {
      const record = await Api.call(action, { latitude: coords.lat, longitude: coords.lng, accuracy: coords.accuracy, samples });
      s.today.record = record;
      toast(action === 'checkIn'
        ? `Absen masuk berhasil pukul ${shortTime(record.jamMasuk)} WIB (${record.status}).`
        : `Absen pulang berhasil pukul ${shortTime(record.jamPulang)} WIB.`, 'success');
      if (navigator.vibrate) navigator.vibrate(60);
      loadRecent();
    } catch (err) {
      toast(err.message, 'error');
      if (err.code !== 'NETWORK') loadToday();
    } finally {
      s.submitting = false;
      s.todayKey = '';
      renderTodayCard();
    }
  }

  /* ---------- Lokasi GPS ---------- */

  async function startLocation() {
    stopLocation();
    const loc = s.loc;
    const gen = ++loc.gen;
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
    if (!config.configured) {
      loc.status = 'not-configured';
      return renderLocCard();
    }
    loc.stop = Geo.watch(update => {
      loc.status = update.status;
      if (update.coords) { loc.coords = update.coords; loc.samples = update.samples; }
      renderLocCard();
    });
  }

  function stopLocation() {
    s.loc.gen++;
    if (s.loc.stop) s.loc.stop();
    s.loc.stop = null;
  }

  function localVerdict() {
    const { config, coords } = s.loc;
    const distance = Geo.distance(config.lat, config.lng, coords.lat, coords.lng);
    const accuracyOk = coords.accuracy <= config.maxAccuracy;
    const withinRadius = distance <= config.radius;
    return { distance, accuracyOk, withinRadius, valid: accuracyOk && withinRadius };
  }

  const GPS_HELP = {
    denied: `
      <p>Absensi tidak dapat dilakukan tanpa izin lokasi.</p>
      <details open><summary>Cara mengizinkan lokasi</summary><ul>
        <li><strong>Android (Chrome):</strong> ketuk ikon di samping alamat situs → <em>Izin</em> → <em>Lokasi</em> → <em>Izinkan</em>, lalu muat ulang.</li>
        <li><strong>iPhone (Safari):</strong> <em>Pengaturan</em> → <em>Privasi &amp; Keamanan</em> → <em>Layanan Lokasi</em> → <em>Situs Web Safari</em> → <em>Saat Digunakan</em>.</li>
      </ul></details>`,
    unavailable: `
      <p>GPS tidak aktif atau sinyal lokasi tidak ditemukan.</p>
      <details open><summary>Cara mengaktifkan GPS</summary><ul>
        <li><strong>Android:</strong> tarik panel notifikasi → aktifkan <em>Lokasi</em> (akurasi tinggi).</li>
        <li><strong>iPhone:</strong> <em>Pengaturan</em> → <em>Privasi &amp; Keamanan</em> → <em>Layanan Lokasi</em> → aktifkan.</li>
      </ul></details>`,
    timeout: '<p>Lokasi belum didapat. Pastikan GPS aktif dan pindah ke area terbuka.</p>',
    unsupported: '<p>Browser ini tidak mendukung GPS. Gunakan Chrome (Android) atau Safari (iPhone) terbaru.</p>',
  };

  function formatDistance(m) {
    return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2).replace('.', ',') + ' km';
  }

  function renderLocCard() {
    const card = document.getElementById('loc-card');
    if (!card) return;
    const loc = s.loc;
    const v = loc.status === 'ok' && loc.coords && loc.config && loc.config.configured ? localVerdict() : null;

    const key = [loc.status, v && v.valid, v && v.accuracyOk, v && v.withinRadius].join('|');
    if (key === loc.renderKey && v) {
      document.getElementById('loc-distance').textContent = formatDistance(v.distance);
      document.getElementById('loc-accuracy').textContent = '±' + Math.round(loc.coords.accuracy) + ' m';
      return;
    }
    loc.renderKey = key;

    let tone = 'neutral', icon = 'loader', title = 'Mengambil lokasi GPS…', body = '';
    switch (loc.status) {
      case 'config-error': tone = 'bad'; icon = 'triangle-alert'; title = 'Gagal memuat pengaturan lokasi'; body = `<p>${esc(loc.configError)}</p>`; break;
      case 'not-configured': tone = 'warn'; icon = 'map-pin-off'; title = 'Lokasi sekolah belum diatur admin'; break;
      case 'denied': tone = 'bad'; icon = 'map-pin-off'; title = 'Izin lokasi ditolak'; body = GPS_HELP.denied; break;
      case 'unavailable': tone = 'bad'; icon = 'map-pin-off'; title = 'GPS tidak aktif'; body = GPS_HELP.unavailable; break;
      case 'timeout': tone = 'bad'; icon = 'map-pin-off'; title = 'Lokasi belum didapat'; body = GPS_HELP.timeout; break;
      case 'unsupported': tone = 'bad'; icon = 'map-pin-off'; title = 'GPS tidak didukung'; body = GPS_HELP.unsupported; break;
      case 'ok':
        if (!v.accuracyOk) { tone = 'warn'; icon = 'satellite-dish'; title = 'Akurasi GPS rendah'; body = `<p>Batas akurasi ±${esc(loc.config.maxAccuracy)} m. Pindah ke area terbuka atau dekat jendela, lalu tunggu sebentar.</p>`; }
        else if (!v.withinRadius) { tone = 'bad'; icon = 'map-pin-x'; title = 'Di luar area sekolah'; body = `<p>Absensi hanya dalam radius ${esc(loc.config.radius)} m dari titik sekolah.</p>`; }
        else { tone = 'good'; icon = 'map-pin-check'; title = 'Lokasi valid · di area sekolah'; }
        break;
      default: break;
    }

    const canRetry = ['ok', 'denied', 'unavailable', 'timeout', 'config-error'].includes(loc.status);
    card.className = 'card loc-card tone-' + tone;
    card.innerHTML = `
      <div class="loc-row">
        <div class="loc-icon">${tone === 'neutral' ? '<span class="spinner spinner-dark"></span>' : `<i data-lucide="${icon}"></i>`}</div>
        <div class="loc-text"><span>Status lokasi</span><strong>${esc(title)}</strong></div>
        ${canRetry ? '<button class="icon-btn" id="btn-loc-refresh" aria-label="Perbarui lokasi" title="Perbarui lokasi"><i data-lucide="refresh-cw"></i></button>' : ''}
      </div>
      ${v ? `<div class="loc-metrics">
        <div class="metric"><span>Jarak</span><strong id="loc-distance">${formatDistance(v.distance)}</strong></div>
        <div class="metric"><span>Akurasi</span><strong id="loc-accuracy">±${Math.round(loc.coords.accuracy)} m</strong></div>
        <div class="metric"><span>Radius</span><strong>${esc(loc.config.radius)} m</strong></div>
      </div>` : ''}
      ${body ? `<div class="loc-body">${body}</div>` : ''}`;

    const refresh = document.getElementById('btn-loc-refresh');
    if (refresh) refresh.onclick = startLocation;
    icons();
    renderTodayCard();
  }

  /* ---------- Riwayat ---------- */

  function monthLabel(bulan) {
    return new Date(bulan + '-15T12:00:00+07:00').toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', month: 'long', year: 'numeric' });
  }

  function shiftMonth(bulan, delta) {
    const [y, m] = bulan.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 15));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  function history(view) {
    const current = wibParts(new Date()).tanggal.slice(0, 7);
    if (!s.historyMonth) s.historyMonth = current;
    view.innerHTML = `
      <section class="card">
        <div class="month-switch">
          <button class="icon-btn" id="m-prev" aria-label="Bulan sebelumnya"><i data-lucide="chevron-left"></i></button>
          <strong id="m-label">${esc(monthLabel(s.historyMonth))}</strong>
          <button class="icon-btn" id="m-next" aria-label="Bulan berikutnya" ${s.historyMonth >= current ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button>
        </div>
      </section>
      <div class="mini-stats" id="h-stats">${miniStats(null)}</div>
      <section class="card"><div id="h-list" class="hist-list"><div class="empty"><span class="spinner spinner-dark"></span></div></div></section>`;
    icons();
    document.getElementById('m-prev').onclick = () => { s.historyMonth = shiftMonth(s.historyMonth, -1); history(view); };
    document.getElementById('m-next').onclick = () => { if (s.historyMonth < current) { s.historyMonth = shiftMonth(s.historyMonth, 1); history(view); } };
    loadHistory(s.historyMonth);
  }

  async function loadHistory(bulan) {
    const list = document.getElementById('h-list');
    try {
      const res = await Api.call('myHistory', { bulan });
      if (!list.isConnected || bulan !== s.historyMonth) return;
      document.getElementById('h-stats').innerHTML = miniStats(res.ringkasan);
      list.innerHTML = res.records.length
        ? res.records.map(histItem).join('')
        : `<div class="empty">${Brand.emptyCalendar()}Tidak ada data absensi pada bulan ini.</div>`;
    } catch (err) {
      if (list.isConnected) list.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  }

  /* ---------- Profil ---------- */

  function profile(view) {
    const u = App.state.user;
    view.innerHTML = `
      <section class="card">
        <div class="profile-head">
          <div class="avatar avatar-lg">${esc(initials(u.nama))}</div>
          <div>
            <h2>${esc(u.nama)}</h2>
            <span class="badge badge-guru">Guru</span> ${u.jenjang ? `<span class="badge">${esc(u.jenjang)}</span>` : ''}
          </div>
        </div>
      </section>
      <section class="card">
        <dl class="info-list">
          <div><dt><i data-lucide="mail"></i> Email</dt><dd>${esc(u.email)}</dd></div>
          <div><dt><i data-lucide="hash"></i> NIP</dt><dd>${esc(u.nip || '—')}</dd></div>
          <div><dt><i data-lucide="graduation-cap"></i> Jenjang</dt><dd>${esc(u.jenjang || '—')}</dd></div>
          <div><dt><i data-lucide="school"></i> Sekolah</dt><dd data-school-name>${esc(App.state.school.schoolName)}</dd></div>
          <div><dt><i data-lucide="clock-3"></i> Login terakhir</dt><dd>${esc(u.lastLogin ? u.lastLogin + ' WIB' : '—')}</dd></div>
        </dl>
      </section>
      <p class="muted small-note">Data profil dikelola oleh admin sekolah. Hubungi admin bila ada yang perlu diperbaiki.</p>
      ${Pwa.canInstall() ? '<button class="btn btn-primary btn-block" id="btn-profile-install"><i data-lucide="download"></i> Pasang aplikasi di HP</button>' : ''}
      <button class="btn btn-ghost btn-block" id="btn-profile-logout"><i data-lucide="log-out"></i> Keluar dari aplikasi</button>
      <p class="muted small-note" style="text-align:center"><a href="privacy.html">Kebijakan Privasi</a></p>`;
    document.getElementById('btn-profile-logout').onclick = App.logout;
    const inst = document.getElementById('btn-profile-install');
    if (inst) inst.onclick = Pwa.install;
  }

  return { home, history, profile, STATUS_CLASS, statusPill, shortTime };
})();

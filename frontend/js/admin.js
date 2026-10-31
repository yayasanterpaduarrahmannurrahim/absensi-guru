/**
 * admin.js — Halaman admin: Dashboard (ringkasan, grafik 14 hari, rekap harian
 * & koreksi), Data Guru, Log Aktivitas, dan Pengaturan (identitas, lokasi, jam kerja).
 */
const Admin = (() => {
  const { esc, icons, toast, withLoading, openModal, confirm, initials } = UI;

  // Urutan & warna seri grafik (divalidasi untuk buta warna; kontras amber dibantu legenda + tabel).
  const SERIES = [
    { key: 'Hadir', label: 'Hadir', color: '#166534' },
    { key: 'Terlambat', label: 'Terlambat', color: '#e8a317' },
    { key: 'Izin', label: 'Izin', color: '#2563eb' },
    { key: 'Sakit', label: 'Sakit', color: '#a21caf' },
    { key: 'Tanpa Keterangan', label: 'Tanpa Keterangan', color: '#dc2626' },
  ];
  const STATUS_FILTERS = [
    { key: '', label: 'Semua' }, { key: 'Hadir', label: 'Hadir' }, { key: 'Terlambat', label: 'Terlambat' },
    { key: 'Izin', label: 'Izin' }, { key: 'Sakit', label: 'Sakit' }, { key: 'Tanpa Keterangan', label: 'Alpa' },
    { key: 'Belum absen', label: 'Belum absen' },
  ];
  const ROLE_LABEL = { admin: 'Admin', guru: 'Guru' };

  const s = { date: null, data: null, search: '', jenjang: '', status: '', users: [], userSearch: '' };

  const todayWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const fmtLong = t => new Date(t + 'T12:00:00+07:00').toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShort = t => new Date(t + 'T12:00:00+07:00').toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short', day: 'numeric', month: 'short' });
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  /* ======================= DASHBOARD ======================= */

  function dashboard(view) {
    const today = todayWib();
    if (!s.date) s.date = today;
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Ringkasan Kehadiran</h1><p id="dash-date">${esc(fmtLong(s.date))}</p></div>
        <div class="date-ctl">
          <input type="date" id="dash-date-input" value="${s.date}" max="${today}" aria-label="Pilih tanggal">
          ${s.date !== today ? '<button class="btn btn-ghost btn-sm" id="dash-today">Hari ini</button>' : ''}
        </div>
      </div>
      <div id="dash-banner"></div>
      <div class="kpis" id="kpis">${kpiSkeleton()}</div>
      <div class="stack">
        <section class="card">
          <div class="card-head"><div><h2>Kehadiran 14 hari terakhir</h2><p>Jumlah guru per status</p></div></div>
          <div class="chart-wrap" id="chart"><div class="empty"><span class="spinner spinner-dark"></span></div></div>
        </section>
        <section class="card" id="rekap-card">
          <div class="card-head"><div><h2>Rekap Absensi</h2><p id="rekap-sub">Memuat…</p></div></div>
          <div class="toolbar">
            <div class="search"><i data-lucide="search"></i><input id="rk-search" type="search" placeholder="Cari nama guru" value="${esc(s.search)}"></div>
            <div class="chips" id="rk-jenjang">
              ${['', 'TK', 'SD'].map(j => `<button class="chip ${s.jenjang === j ? 'active' : ''}" data-j="${j}">${j || 'Semua jenjang'}</button>`).join('')}
            </div>
          </div>
          <div class="chips" id="rk-status" style="margin-top:8px"></div>
          <div id="rekap" style="margin-top:6px"><div class="empty"><span class="spinner spinner-dark"></span></div></div>
        </section>
      </div>`;
    icons();

    document.getElementById('dash-date-input').onchange = e => {
      if (!e.target.value) return;
      s.date = e.target.value > today ? today : e.target.value;
      dashboard(view);
    };
    const btnToday = document.getElementById('dash-today');
    if (btnToday) btnToday.onclick = () => { s.date = today; dashboard(view); };
    document.getElementById('rk-search').oninput = e => { s.search = e.target.value; renderRekap(); };
    view.querySelectorAll('[data-j]').forEach(b => {
      b.onclick = () => {
        s.jenjang = b.dataset.j;
        view.querySelectorAll('[data-j]').forEach(x => x.classList.toggle('active', x === b));
        renderRekap();
      };
    });
    loadDashboard();
  }

  async function loadDashboard() {
    const date = s.date;
    try {
      const data = await Api.call('adminDashboard', { tanggal: date });
      if (date !== s.date || !document.getElementById('kpis')) return;
      s.data = data;
      App.setBadge('pengajuan', data.pendingLeaves);
      renderBanner();
      renderKpis();
      renderChart();
      renderRekap();
    } catch (err) {
      const k = document.getElementById('kpis');
      if (k) k.innerHTML = `<div class="alert alert-error" style="grid-column:1/-1">${esc(err.message)}</div>`;
    }
  }

  function renderBanner() {
    const box = document.getElementById('dash-banner');
    const d = s.data;
    const parts = [];
    if (d.pendingLeaves) {
      parts.push(`<button class="banner" id="go-leaves"><i data-lucide="inbox"></i>${d.pendingLeaves} pengajuan izin/sakit menunggu persetujuan<i data-lucide="chevron-right"></i></button>`);
    }
    if (!d.isWorkday) parts.push('<div class="alert alert-info">Tanggal ini bukan hari kerja.</div>');
    box.innerHTML = parts.join('');
    box.style.display = parts.length ? 'grid' : 'none';
    box.style.gap = '8px';
    const go = document.getElementById('go-leaves');
    if (go) go.onclick = () => App.go('pengajuan');
    icons();
  }

  function kpiSkeleton() {
    return '<div class="kpi kpi-hero"><div class="kpi-label">Hadir</div><div class="kpi-value">–</div></div>' +
      ['Terlambat', 'Izin', 'Sakit', 'Tanpa Keterangan', 'Belum absen', 'Total guru']
        .map(l => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">–</div></div>`).join('');
  }

  function renderKpis() {
    const m = s.data.summary;
    const total = m.totalGuru;
    const tile = (label, value, color, sub) => `
      <div class="kpi">
        <div class="kpi-label">${color ? `<i class="dot" style="background:${color}"></i>` : ''}${label}</div>
        <div class="kpi-value">${value}</div>
        ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
      </div>`;
    document.getElementById('kpis').innerHTML = `
      <div class="kpi kpi-hero">
        <div class="kpi-label"><i data-lucide="user-check"></i> Hadir</div>
        <div class="kpi-value">${m.hadir}<span style="font-size:1rem;font-weight:600;opacity:.75"> / ${total}</span></div>
        <div class="kpi-sub">${pct(m.hadir, total)}% guru aktif · ${m.tepatWaktu} tepat waktu</div>
        <div class="progress" role="img" aria-label="${m.tepatWaktu} tepat waktu, ${m.terlambat} terlambat dari ${total} guru">
          <span style="width:${pct(m.tepatWaktu, total)}%;background:#7ee2b0"></span>
          <span style="width:${pct(m.terlambat, total)}%;background:#f5c451"></span>
        </div>
      </div>
      ${tile('Terlambat', m.terlambat, SERIES[1].color, s.data.schedule ? 'setelah ' + s.data.schedule.batasTerlambat : '')}
      ${tile('Izin', m.izin, SERIES[2].color)}
      ${tile('Sakit', m.sakit, SERIES[3].color)}
      ${tile('Tanpa Keterangan', m.tanpaKeterangan, SERIES[4].color)}
      ${tile('Belum absen', m.belumAbsen, '#9aa6a0', s.data.tanggal === s.data.hariIni ? 'tutup ' + s.data.schedule.batasAbsenMasuk : '')}
      ${tile('Total guru aktif', total, null)}`;
    icons();
  }

  /* ---------- Grafik batang bertumpuk ---------- */

  function topRoundedRect(x, y, w, h, r) {
    const rr = Math.min(r, h, w / 2);
    return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
  }

  function niceMax(v) {
    if (v <= 4) return 4;
    const step = Math.pow(10, Math.floor(Math.log10(v)));
    const n = Math.ceil(v / step);
    return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * step;
  }

  function renderChart() {
    const box = document.getElementById('chart');
    const trend = s.data.trend;
    // Lebar gambar mengikuti lebar kartu agar teks sumbu tetap terbaca di HP (tidak diperkecil).
    const W = Math.round(Math.max(300, Math.min(900, box.clientWidth || 640)));
    const H = W < 500 ? 200 : 230, L = 26, R = 6, T = 10, B = 34;
    const plotW = W - L - R, plotH = H - T - B;
    const totals = trend.map(d => SERIES.reduce((a, x) => a + d[x.key], 0));
    const max = niceMax(Math.max(1, ...totals));
    const band = plotW / trend.length;
    const bw = Math.min(30, band * 0.6);
    const y = v => T + plotH - (v / max) * plotH;
    const ticks = [0, max / 4, max / 2, (3 * max) / 4, max].filter(v => Number.isInteger(v));

    const cols = trend.map((d, i) => {
      const x = L + i * band + (band - bw) / 2;
      let acc = 0;
      const present = SERIES.filter(se => d[se.key] > 0);
      const segs = present.map((se, k) => {
        const v = d[se.key];
        const y0 = y(acc), y1 = y(acc + v);
        acc += v;
        const gap = k < present.length - 1 ? 2 : 0; // celah 2px antarsegmen
        const h = Math.max(0, y0 - y1 - gap);
        return k === present.length - 1
          ? `<path d="${topRoundedRect(x, y1, bw, y0 - y1, 4)}" fill="${se.color}"/>`
          : `<rect x="${x}" y="${y1 + gap}" width="${bw}" height="${h}" fill="${se.color}"/>`;
      }).join('');
      const dayNum = Number(d.tanggal.slice(8));
      const isSel = d.tanggal === s.data.tanggal;
      return `
        <g class="col" data-col="${i}">${segs}
          ${!d.hariKerja ? `<text x="${x + bw / 2}" y="${y(0) - 4}" text-anchor="middle" font-size="9" fill="#9aa6a0">libur</text>` : ''}
        </g>
        <text x="${x + bw / 2}" y="${H - 16}" text-anchor="middle" font-size="10.5" fill="${isSel ? '#10201a' : '#6a7a72'}" font-weight="${isSel ? 700 : 400}">${dayNum}</text>`;
    }).join('');
    // Area sentuh (transparan) di lapisan teratas, lebih lebar dari batangnya.
    const hits = trend.map((d, i) => `<rect class="bar-hit" data-i="${i}" x="${L + i * band}" y="${T}" width="${band}" height="${plotH + B - 6}"/>`).join('');

    box.innerHTML = `
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik batang bertumpuk kehadiran 14 hari terakhir">
        <g class="grid">${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>
        <g class="axis">${ticks.map(t => `<text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${t}</text>`).join('')}</g>
        ${cols}
        <text x="${L}" y="${H - 2}" font-size="10" fill="#6a7a72">${esc(fmtShort(trend[0].tanggal))}</text>
        <text x="${W - R}" y="${H - 2}" font-size="10" fill="#6a7a72" text-anchor="end">${esc(fmtShort(trend[trend.length - 1].tanggal))}</text>
        ${hits}
      </svg>
      <div class="tooltip" id="chart-tip" hidden></div>
      <div class="legend">${SERIES.map(se => `<span><i style="background:${se.color}"></i>${se.label}</span>`).join('')}</div>`;

    const tip = document.getElementById('chart-tip');
    const svg = box.querySelector('svg');
    const show = el => {
      const i = Number(el.dataset.i);
      const d = trend[i];
      svg.querySelectorAll('.col').forEach(c => c.classList.toggle('active', c.dataset.col === String(i)));
      tip.innerHTML = `<strong>${esc(fmtShort(d.tanggal))}${d.hariKerja ? '' : ' · libur'}</strong>` +
        SERIES.map(se => `<div><span><i style="background:${se.color}"></i>${se.label}</span><b>${d[se.key]}</b></div>`).join('');
      tip.hidden = false;
      const boxRect = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const left = Math.min(Math.max(0, r.left - boxRect.left + r.width / 2 - 80), boxRect.width - 165);
      tip.style.left = left + 'px';
      tip.style.top = '0px';
    };
    const hide = () => { tip.hidden = true; svg.querySelectorAll('.col').forEach(c => c.classList.remove('active')); };
    svg.querySelectorAll('.bar-hit').forEach(el => {
      el.addEventListener('mouseenter', () => show(el));
      el.addEventListener('click', () => show(el));
    });
    svg.addEventListener('mouseleave', hide);

    // Gambar ulang bila lebar kartu berubah (putar layar / ubah ukuran jendela).
    if (!box.dataset.observed && window.ResizeObserver) {
      box.dataset.observed = '1';
      let lastW = box.clientWidth;
      const ro = new ResizeObserver(() => {
        if (Math.abs(box.clientWidth - lastW) > 24 && s.data) { lastW = box.clientWidth; renderChart(); }
      });
      ro.observe(box);
      App.onLeave(() => ro.disconnect());
    }
  }

  /* ---------- Rekap harian ---------- */

  function filteredRows() {
    const q = s.search.trim().toLowerCase();
    return s.data.rows.filter(r =>
      (!s.jenjang || r.jenjang === s.jenjang) &&
      (!q || String(r.nama).toLowerCase().includes(q)));
  }

  function renderRekap() {
    const box = document.getElementById('rekap');
    if (!box || !s.data) return;
    const base = filteredRows();
    document.getElementById('rekap-sub').textContent = fmtLong(s.data.tanggal);

    const counts = {};
    base.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const statusBox = document.getElementById('rk-status');
    statusBox.innerHTML = STATUS_FILTERS.map(f => {
      const n = f.key ? counts[f.key] || 0 : base.length;
      return `<button class="chip ${s.status === f.key ? 'active' : ''}" data-st="${esc(f.key)}">${f.label}<span class="count">${n}</span></button>`;
    }).join('');
    statusBox.querySelectorAll('[data-st]').forEach(b => { b.onclick = () => { s.status = b.dataset.st; renderRekap(); }; });

    const rows = base.filter(r => !s.status || r.status === s.status);
    if (!rows.length) {
      box.innerHTML = `<div class="empty">${s.data.rows.length ? 'Tidak ada guru yang cocok dengan filter.' : 'Belum ada guru terdaftar.'}</div>`;
      return;
    }
    const anomaly = r => (r.anomali ? '<span class="anomaly-ic" title="Ada catatan anomali lokasi"><i data-lucide="triangle-alert"></i></span>' : '');
    const t = v => (v ? String(v).slice(0, 5) : '—');
    box.innerHTML = `
      <div class="rekap-list">
        ${rows.map((r, i) => `
          <button class="rekap-row" data-row="${i}">
            <span class="rekap-name"><span>${esc(r.nama)}</span>${r.jenjang ? `<span class="badge">${esc(r.jenjang)}</span>` : ''}${anomaly(r)}</span>
            ${Guru.statusPill(r.status)}
            <span class="rekap-times"><span>Masuk <b>${t(r.jamMasuk)}</b></span><span>Pulang <b>${t(r.jamPulang)}</b></span></span>
          </button>`).join('')}
      </div>
      <table class="rekap-table">
        <thead><tr><th>Nama guru</th><th>Jenjang</th><th>Jam masuk</th><th>Jam pulang</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr data-row="${i}">
              <td><span class="rekap-name"><span>${esc(r.nama)}</span>${anomaly(r)}</span></td>
              <td>${esc(r.jenjang || '—')}</td><td>${t(r.jamMasuk)}</td><td>${t(r.jamPulang)}</td>
              <td>${Guru.statusPill(r.status)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="rekap-foot">Ketuk nama untuk melihat detail atau mengoreksi absensi. <i data-lucide="triangle-alert" style="width:13px;height:13px;color:#b45309;vertical-align:-2px"></i> = ada catatan anomali lokasi.</p>`;
    box.querySelectorAll('[data-row]').forEach(el => { el.onclick = () => openRowDetail(rows[Number(el.dataset.row)]); });
    icons();
  }

  function openRowDetail(r) {
    const t = v => (v ? String(v).slice(0, 5) : '—');
    const m = v => (v === '' || v === null || v === undefined ? '—' : Math.round(Number(v)) + ' m');
    openModal(r.nama, (body, close) => {
      body.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${Guru.statusPill(r.status)} ${r.jenjang ? `<span class="badge">${esc(r.jenjang)}</span>` : ''}
          <span class="muted small-note">${esc(fmtLong(s.data.tanggal))}</span>
        </div>
        <div class="detail-grid">
          <div class="metric"><span>Jam masuk</span><strong>${t(r.jamMasuk)}</strong></div>
          <div class="metric"><span>Jam pulang</span><strong>${t(r.jamPulang)}</strong></div>
          <div class="metric"><span>Jarak saat masuk</span><strong>${m(r.jarakMasuk)}</strong></div>
          <div class="metric"><span>Jarak saat pulang</span><strong>${m(r.jarakPulang)}</strong></div>
        </div>
        ${r.keterangan ? `<div class="note-box"><strong>Keterangan:</strong> ${esc(r.keterangan)}</div>` : ''}
        ${r.anomali ? `<div class="note-box warn"><strong>Anomali lokasi:</strong> ${esc(r.anomali)}<br><span class="small-note">Belum tentu kecurangan — periksa bila berulang.</span></div>` : ''}
        <div id="correct-slot"></div>
        <div class="modal-actions" id="detail-actions">
          <button class="btn btn-ghost" data-close-detail>Tutup</button>
          <button class="btn btn-primary" data-correct><i data-lucide="pencil"></i> Koreksi</button>
        </div>`;
      body.querySelector('[data-close-detail]').onclick = close;
      body.querySelector('[data-correct]').onclick = () => {
        body.querySelector('#detail-actions').remove();
        renderCorrectionForm(body.querySelector('#correct-slot'), r, close);
      };
    });
  }

  function renderCorrectionForm(slot, r, close) {
    const present = ['Hadir', 'Terlambat'];
    const initial = r.status === 'Belum absen' ? 'Hadir' : r.status;
    slot.innerHTML = `
      <form class="form" id="correct-form" novalidate>
        <label>Status
          <select name="status">${SERIES.map(se => `<option value="${se.key}" ${se.key === initial ? 'selected' : ''}>${se.label}</option>`).join('')}</select>
        </label>
        <div class="form-row" id="cf-times">
          <label>Jam masuk<input type="time" name="jamMasuk" value="${esc(String(r.jamMasuk || '').slice(0, 5))}"></label>
          <label>Jam pulang<input type="time" name="jamPulang" value="${esc(String(r.jamPulang || '').slice(0, 5))}"></label>
        </div>
        <label>Alasan koreksi
          <textarea name="alasan" rows="2" maxlength="300" placeholder="Contoh: HP guru rusak, hadir sesuai daftar piket"></textarea>
          <small>Wajib diisi. Tercatat di log aktivitas beserta data sebelum koreksi.</small>
        </label>
        <div class="alert alert-error" id="cf-error" hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Batal</button>
          <button type="submit" class="btn btn-primary">Simpan Koreksi</button>
        </div>
      </form>`;
    const form = slot.querySelector('form');
    const syncTimes = () => { slot.querySelector('#cf-times').hidden = !present.includes(form.status.value); };
    form.status.onchange = syncTimes;
    syncTimes();
    slot.querySelector('[data-cancel]').onclick = close;
    form.onsubmit = async e => {
      e.preventDefault();
      const err = slot.querySelector('#cf-error');
      err.hidden = true;
      const alasan = form.alasan.value.trim();
      if (alasan.length < 5) { err.textContent = 'Alasan koreksi minimal 5 karakter.'; err.hidden = false; return; }
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try {
          await Api.call('adminCorrectAttendance', {
            userId: r.userId, tanggal: s.data.tanggal, status: form.status.value,
            jamMasuk: form.jamMasuk.value, jamPulang: form.jamPulang.value, alasan,
          });
          close();
          toast('Absensi ' + r.nama + ' dikoreksi.', 'success');
          loadDashboard();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      });
    };
    icons();
  }

  /* ======================= DATA GURU ======================= */

  async function users(view) {
    view.innerHTML = `
      <div class="toolbar">
        <div class="search"><i data-lucide="search"></i><input id="user-search" type="search" placeholder="Cari nama atau email" value="${esc(s.userSearch)}"></div>
        <button class="btn btn-primary" id="btn-add-user"><i data-lucide="user-plus"></i> Tambah</button>
      </div>
      <div id="user-list" class="list"><div class="empty"><span class="spinner spinner-dark"></span></div></div>`;
    icons();
    document.getElementById('btn-add-user').onclick = () => openUserForm(null);
    document.getElementById('user-search').oninput = e => { s.userSearch = e.target.value; renderUserList(); };
    try {
      s.users = await Api.call('adminListUsers');
      renderUserList();
    } catch (err) {
      const list = document.getElementById('user-list');
      if (list) list.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  }

  function renderUserList() {
    const list = document.getElementById('user-list');
    if (!list) return;
    const q = s.userSearch.trim().toLowerCase();
    const rows = s.users.filter(u => !q || String(u.nama).toLowerCase().includes(q) || String(u.email).toLowerCase().includes(q));
    if (!rows.length) {
      list.innerHTML = `<div class="empty">${q ? 'Tidak ada pengguna yang cocok.' : 'Belum ada pengguna.'}</div>`;
      return;
    }
    const gurus = s.users.filter(u => u.role === 'guru');
    const count = j => gurus.filter(u => u.jenjang === j && u.statusAkun === 'aktif').length;
    list.innerHTML = `
      <p class="muted list-summary">${gurus.length} guru · ${count('TK')} TK aktif · ${count('SD')} SD aktif</p>
      ${rows.map(u => {
        const self = u.userId === App.state.user.userId;
        const active = u.statusAkun === 'aktif';
        return `
          <article class="card user-row ${active ? '' : 'inactive'}">
            <div class="avatar">${esc(initials(u.nama))}</div>
            <div class="user-main">
              <strong>${esc(u.nama)}${self ? ' <span class="muted">(Anda)</span>' : ''}</strong>
              <span class="user-email">${esc(u.email)}</span>
              <div class="badges">
                <span class="badge badge-${esc(u.role)}">${esc(ROLE_LABEL[u.role] || u.role)}</span>
                ${u.jenjang ? `<span class="badge">${esc(u.jenjang)}</span>` : ''}
                ${active ? '' : '<span class="badge badge-off">Nonaktif</span>'}
                ${u.lastLogin ? '' : '<span class="badge badge-warn">Belum pernah login</span>'}
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
    const byId = id => s.users.find(u => u.userId === id);
    list.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => openUserForm(byId(b.dataset.edit)); });
    list.querySelectorAll('[data-toggle]').forEach(b => { b.onclick = () => toggleUser(b, byId(b.dataset.toggle)); });
    list.querySelectorAll('[data-delete]').forEach(b => { b.onclick = () => deleteUser(b, byId(b.dataset.delete)); });
    icons();
  }

  function replaceUser(updated) {
    const i = s.users.findIndex(u => u.userId === updated.userId);
    if (i >= 0) s.users[i] = updated; else s.users.push(updated);
    s.users.sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
    if (updated.userId === App.state.user.userId) App.setUser(updated);
  }

  function openUserForm(user) {
    const isEdit = !!user;
    const u = user || { nama: '', email: '', nip: '', role: 'guru', jenjang: '', statusAkun: 'aktif' };
    const self = isEdit && u.userId === App.state.user.userId;
    openModal(isEdit ? 'Ubah Data Guru' : 'Tambah Guru', (body, close) => {
      body.innerHTML = `
        <form id="user-form" class="form" novalidate>
          <label>Nama lengkap &amp; gelar<input name="nama" required maxlength="100" value="${esc(u.nama)}" autocomplete="off" placeholder="Contoh: Fouziah, S.Pd"></label>
          <label>Email Google<input name="email" type="email" required maxlength="254" value="${esc(u.email)}" autocomplete="off" placeholder="nama@gmail.com">
            <small>Harus akun Google — dipakai guru untuk login.</small></label>
          <label>NIP <span class="muted">(opsional)</span><input name="nip" inputmode="numeric" maxlength="30" value="${esc(u.nip)}" autocomplete="off"></label>
          <div class="form-row">
            <label>Peran<select name="role" ${self ? 'disabled' : ''}>
              <option value="guru" ${u.role === 'guru' ? 'selected' : ''}>Guru</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></label>
            <label>Jenjang<select name="jenjang">
              <option value="" ${!u.jenjang ? 'selected' : ''}>—</option>
              <option value="TK" ${u.jenjang === 'TK' ? 'selected' : ''}>TK</option>
              <option value="SD" ${u.jenjang === 'SD' ? 'selected' : ''}>SD</option></select></label>
          </div>
          ${isEdit && !self ? `<label>Status akun<select name="statusAkun">
            <option value="aktif" ${u.statusAkun === 'aktif' ? 'selected' : ''}>Aktif</option>
            <option value="nonaktif" ${u.statusAkun === 'nonaktif' ? 'selected' : ''}>Nonaktif</option></select></label>` : ''}
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
        const payload = { nama: f.get('nama'), email: f.get('email'), nip: f.get('nip'), role: self ? u.role : f.get('role'), jenjang: f.get('jenjang') };
        const errBox = body.querySelector('#form-error');
        errBox.hidden = true;
        if (payload.role === 'guru' && !payload.jenjang) { errBox.textContent = 'Pilih jenjang (TK atau SD) untuk guru.'; errBox.hidden = false; return; }
        await withLoading(form.querySelector('[type=submit]'), async () => {
          try {
            const saved = isEdit
              ? await Api.call('adminUpdateUser', Object.assign(payload, { userId: u.userId, statusAkun: self ? u.statusAkun : f.get('statusAkun') }))
              : await Api.call('adminCreateUser', payload);
            replaceUser(saved);
            close();
            toast(isEdit ? 'Data guru disimpan.' : 'Guru ditambahkan.', 'success');
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
    const ok = await confirm(activate ? 'Aktifkan Akun' : 'Nonaktifkan Akun',
      activate ? `${u.nama} akan dapat login kembali.` : `${u.nama} tidak akan dapat login dan sesi aktifnya diakhiri. Data absensinya tetap tersimpan.`,
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
    const ok = await confirm('Hapus Guru',
      `Hapus akun ${u.nama} (${u.email})? Ia tidak bisa login lagi. Riwayat absensinya tetap tersimpan. Untuk memblokir sementara, gunakan Nonaktifkan.`,
      'Hapus', true);
    if (!ok) return;
    await withLoading(button, async () => {
      try {
        await Api.call('adminDeleteUser', { userId: u.userId });
        s.users = s.users.filter(x => x.userId !== u.userId);
        toast('Akun dihapus.', 'success');
        renderUserList();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  /* ======================= LOG AKTIVITAS ======================= */

  const ACTIVITY = {
    LOGIN: 'Login', LOGOUT: 'Logout', LOGIN_DITOLAK: 'Login ditolak', SETUP: 'Setup sistem',
    TAMBAH_PENGGUNA: 'Tambah pengguna', UBAH_PENGGUNA: 'Ubah pengguna', HAPUS_PENGGUNA: 'Hapus pengguna',
    UBAH_LOKASI_SEKOLAH: 'Ubah lokasi sekolah', UBAH_JAM_KERJA: 'Ubah jam kerja', UBAH_IDENTITAS_SEKOLAH: 'Ubah identitas sekolah',
    ABSEN_DITOLAK: 'Absen ditolak', AJUKAN_PENGAJUAN: 'Pengajuan izin/sakit', BATAL_PENGAJUAN: 'Pengajuan dibatalkan',
    PROSES_PENGAJUAN: 'Pengajuan diproses', KOREKSI_ABSENSI: 'Koreksi absensi', OTOMATIS_TANPA_KETERANGAN: 'Tanpa Keterangan otomatis',
  };

  function summarizeDetail(raw) {
    let d;
    try { d = JSON.parse(raw); } catch (e) { return String(raw || ''); }
    if (!d || typeof d !== 'object') return String(raw || '');
    const flat = v => (v && typeof v === 'object' ? JSON.stringify(v) : String(v));
    const text = Object.keys(d).filter(k => d[k] !== '' && d[k] !== null).map(k => `${k.replace(/_/g, ' ')}: ${flat(d[k])}`).join(' · ');
    return text.length > 260 ? text.slice(0, 257) + '…' : text;
  }

  function audit(view) {
    view.innerHTML = `
      <div class="search"><i data-lucide="search"></i><input id="audit-q" type="search" placeholder="Cari aktivitas, nama, atau tanggal (mis. 2026-11)"></div>
      <section class="card"><div id="audit-list"><div class="empty"><span class="spinner spinner-dark"></span></div></div></section>`;
    icons();
    let timer = null;
    document.getElementById('audit-q').oninput = e => {
      clearTimeout(timer);
      timer = setTimeout(() => loadAudit(e.target.value), 350);
    };
    App.onLeave(() => clearTimeout(timer));
    loadAudit('');
  }

  async function loadAudit(q) {
    const box = document.getElementById('audit-list');
    if (!box) return;
    try {
      const logs = await Api.call('adminAuditLog', { q });
      if (!box.isConnected) return;
      box.innerHTML = logs.length
        ? logs.map(l => `
            <div class="audit-item">
              <div class="audit-top"><strong>${esc(ACTIVITY[l.aktivitas] || l.aktivitas)}</strong><span>${esc(l.waktu)}</span></div>
              <div class="audit-who">${esc(l.pelaku)}</div>
              ${l.detail && l.detail !== '{}' ? `<div class="audit-detail">${esc(summarizeDetail(l.detail))}</div>` : ''}
            </div>`).join('') + '<p class="rekap-foot">Menampilkan maksimal 200 aktivitas terbaru.</p>'
        : '<div class="empty">Tidak ada aktivitas yang cocok.</div>';
    } catch (err) {
      if (box.isConnected) box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  }

  /* ======================= PENGATURAN ======================= */

  const NAMA_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

  async function settings(view) {
    view.innerHTML = '<div class="card empty"><span class="spinner spinner-dark"></span></div>';
    let loc, sch;
    try {
      [loc, sch] = await Promise.all([Api.call('getLocationConfig'), Api.call('adminGetSchedule')]);
    } catch (err) {
      view.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      return;
    }
    if (!view.isConnected) return;
    const time = (name, label, value, help) => `<label>${label}<input name="${name}" type="time" required value="${esc(value)}"><small>${help}</small></label>`;

    view.innerHTML = `
      <div class="grid-2">
        <div class="stack">
          <section class="card">
            <div class="card-head"><div><h2>Identitas Sekolah</h2><p>Nama yang tampil di aplikasi.</p></div></div>
            <form id="identity-form" class="form" novalidate>
              <label>Nama sekolah / yayasan<input name="schoolName" maxlength="100" required value="${esc(App.state.school.schoolName)}"></label>
              <div class="alert alert-error" id="id-error" hidden></div>
              <button class="btn btn-primary" type="submit"><i data-lucide="save"></i> Simpan</button>
            </form>
          </section>
          <section class="card">
            <div class="card-head"><div><h2>Jam Kerja</h2><p>Berlaku untuk semua guru TK &amp; SD.</p></div></div>
            <form id="schedule-form" class="form" novalidate>
              <div class="form-row">${time('jamMasuk', 'Jam masuk', sch.jamMasuk, 'Mulai kerja.')}${time('batasTerlambat', 'Batas terlambat', sch.batasTerlambat, 'Setelahnya = Terlambat.')}</div>
              <div class="form-row">${time('batasAbsenMasuk', 'Absen masuk ditutup', sch.batasAbsenMasuk, 'Lalu otomatis Alpa.')}${time('jamPulang', 'Jam pulang', sch.jamPulang, 'Absen pulang mulai.')}</div>
              <fieldset class="days"><legend>Hari kerja</legend>
                ${NAMA_HARI.map((n, i) => `<label class="day-chip"><input type="checkbox" name="hariKerja" value="${i + 1}" ${sch.hariKerja.includes(i + 1) ? 'checked' : ''}><span>${n}</span></label>`).join('')}
              </fieldset>
              <div class="alert alert-error" id="sch-error" hidden></div>
              <button class="btn btn-primary" type="submit"><i data-lucide="save"></i> Simpan Jam Kerja</button>
            </form>
          </section>
        </div>
        <section class="card">
          <div class="card-head"><div><h2>Lokasi Sekolah</h2><p>Titik pusat & radius absensi.</p></div></div>
          <form id="loc-form" class="form" novalidate>
            <p class="muted small-note">Paling akurat: berdiri di titik tengah area sekolah (di luar ruangan), lalu ketuk tombol di bawah.</p>
            <button type="button" class="btn btn-ghost" id="btn-use-gps"><i data-lucide="crosshair"></i> Gunakan lokasi saya sekarang</button>
            <p id="gps-note" class="muted small-note" hidden></p>
            <div class="form-row">
              <label>Latitude<input name="latitude" inputmode="decimal" autocomplete="off" placeholder="-6.2088123" value="${loc.configured ? esc(loc.lat) : ''}"></label>
              <label>Longitude<input name="longitude" inputmode="decimal" autocomplete="off" placeholder="106.8456789" value="${loc.configured ? esc(loc.lng) : ''}"></label>
            </div>
            <a id="maps-link" class="small-link" target="_blank" rel="noopener" hidden><i data-lucide="external-link"></i> Periksa titik di Google Maps</a>
            <div class="form-row">
              <label>Radius (meter)<input name="radius" type="number" inputmode="numeric" min="10" max="1000" value="${esc(loc.radius)}"></label>
              <label>Batas akurasi GPS (m)<input name="maxAccuracy" type="number" inputmode="numeric" min="5" max="100" value="${esc(loc.maxAccuracy)}"></label>
            </div>
            <small class="muted">Default radius 50 m dan akurasi 30 m.</small>
            <div class="alert alert-error" id="loc-error" hidden></div>
            <button type="submit" class="btn btn-primary"><i data-lucide="save"></i> Simpan Lokasi</button>
          </form>
        </section>
      </div>`;
    icons();
    bindIdentityForm();
    bindScheduleForm();
    bindLocationForm();
  }

  function formError(id, message) {
    const el = document.getElementById(id);
    el.textContent = message || '';
    el.hidden = !message;
  }

  function bindIdentityForm() {
    const form = document.getElementById('identity-form');
    form.onsubmit = async e => {
      e.preventDefault();
      formError('id-error', '');
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try {
          const cfg = await Api.call('adminUpdateIdentity', { schoolName: form.schoolName.value });
          App.setSchoolName(cfg.schoolName);
          toast('Identitas sekolah disimpan.', 'success');
        } catch (err) { formError('id-error', err.message); }
      });
    };
  }

  function bindScheduleForm() {
    const form = document.getElementById('schedule-form');
    form.onsubmit = async e => {
      e.preventDefault();
      formError('sch-error', '');
      const f = new FormData(form);
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try {
          await Api.call('adminUpdateSchedule', {
            jamMasuk: f.get('jamMasuk'), batasTerlambat: f.get('batasTerlambat'),
            batasAbsenMasuk: f.get('batasAbsenMasuk'), jamPulang: f.get('jamPulang'),
            hariKerja: f.getAll('hariKerja').map(Number),
          });
          toast('Jam kerja disimpan.', 'success');
        } catch (err) { formError('sch-error', err.message); }
      });
    };
  }

  function bindLocationForm() {
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

    document.getElementById('btn-use-gps').onclick = async e => {
      const button = e.currentTarget;
      const note = document.getElementById('gps-note');
      note.hidden = false;
      note.textContent = 'Mengambil lokasi terbaik selama maksimal 15 detik… tetap diam di tempat.';
      await withLoading(button, async () => {
        try {
          const p = await Geo.bestPosition(15000, 8);
          form.latitude.value = p.lat.toFixed(7);
          form.longitude.value = p.lng.toFixed(7);
          updateMapsLink();
          note.textContent = `Lokasi didapat dengan akurasi ±${Math.round(p.accuracy)} m.` +
            (p.accuracy > 15 ? ' Akurasi kurang baik — ulangi di area terbuka.' : ' Periksa di Google Maps, lalu Simpan.');
        } catch (err) {
          const messages = {
            denied: 'Izin lokasi ditolak. Izinkan akses lokasi untuk situs ini.',
            unavailable: 'GPS tidak aktif. Aktifkan Lokasi di HP lalu coba lagi.',
            timeout: 'Lokasi belum didapat. Coba lagi di area terbuka.',
            unsupported: 'Browser ini tidak mendukung GPS.',
          };
          note.textContent = messages[err.status] || 'Gagal mengambil lokasi.';
        }
      });
    };

    form.onsubmit = async e => {
      e.preventDefault();
      formError('loc-error', '');
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try {
          const saved = await Api.call('adminUpdateLocation', {
            latitude: form.latitude.value, longitude: form.longitude.value,
            radius: form.radius.value, maxAccuracy: form.maxAccuracy.value,
          });
          form.latitude.value = saved.lat;
          form.longitude.value = saved.lng;
          updateMapsLink();
          toast('Lokasi sekolah disimpan.', 'success');
        } catch (err) { formError('loc-error', err.message); }
      });
    };
  }

  return { dashboard, users, audit, settings };
})();

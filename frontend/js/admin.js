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
    { key: 'Belum absen', label: 'Belum absen' }, { key: 'Libur sif', label: 'Libur sif' },
  ];
  const ROLE_LABEL = { admin: 'Admin', guru: 'Guru' };
  /** Daftar peran pengguna; mendukung data lama yang hanya punya `role`. */
  const rolesOf = u => (Array.isArray(u.roles) && u.roles.length ? u.roles : [u.role === 'admin' ? 'admin' : 'guru']);
  const isGuru = u => rolesOf(u).includes('guru');

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
      <div id="install-slot"></div>
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
    App.onLeave(Pwa.mountInstallCard(document.getElementById('install-slot')));
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
    if (App.isDual(App.state.user)) {
      parts.push('<button class="banner banner-neutral" id="go-guru-mode"><i data-lucide="fingerprint"></i>Anda juga terdaftar sebagai guru — absen hari ini di Mode Guru<i data-lucide="chevron-right"></i></button>');
    }
    box.innerHTML = parts.join('');
    box.style.display = parts.length ? 'grid' : 'none';
    box.style.gap = '8px';
    const toGuru = document.getElementById('go-guru-mode');
    if (toGuru) toGuru.onclick = () => App.switchMode('guru');
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
      ${tile('Total guru aktif', total, null, m.liburSif ? m.liburSif + ' libur sif hari ini' : '')}`;
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
          <button class="btn btn-ghost" data-history><i data-lucide="calendar-days"></i> Riwayat &amp; revisi</button>
          <button class="btn btn-primary" data-correct><i data-lucide="pencil"></i> Koreksi</button>
        </div>`;
      body.querySelector('[data-history]').onclick = () => { close(); openRevision(r.userId, s.data.tanggal.slice(0, 7)); };
      body.querySelector('[data-correct]').onclick = () => {
        body.querySelector('#detail-actions').remove();
        renderCorrectionForm(body.querySelector('#correct-slot'),
          { userId: r.userId, nama: r.nama, dates: [s.data.tanggal], current: r }, close, loadDashboard);
      };
    });
  }

  /**
   * Formulir revisi bersama (Dashboard & halaman Revisi). `target`:
   * { userId, nama, dates: ['yyyy-MM-dd', ...], current?: { status, jamMasuk, jamPulang } }.
   * Pilihan "Hapus catatan" mengosongkan hari tersebut.
   */
  function renderCorrectionForm(slot, target, close, onDone) {
    const present = ['Hadir', 'Terlambat'];
    const cur = target.current || {};
    const known = SERIES.some(se => se.key === cur.status);
    const initial = known ? cur.status : 'Hadir';
    const multi = target.dates.length > 1;
    slot.innerHTML = `
      <form class="form" id="correct-form" novalidate>
        ${multi ? `<p class="confirm-text">Revisi <b>${target.dates.length} hari</b> untuk <b>${esc(target.nama)}</b>.</p>` : ''}
        <label>Status
          <select name="status">
            ${SERIES.map(se => `<option value="${se.key}" ${se.key === initial ? 'selected' : ''}>${se.label}</option>`).join('')}
            <option value="HAPUS">Hapus catatan (kosongkan)</option>
          </select>
        </label>
        <div class="form-row" id="cf-times">
          <label>Jam masuk<input type="time" name="jamMasuk" value="${esc(String(cur.jamMasuk || '').slice(0, 5))}"></label>
          <label>Jam pulang<input type="time" name="jamPulang" value="${esc(String(cur.jamPulang || '').slice(0, 5))}"></label>
        </div>
        <p class="muted small-note" id="cf-hapus-note" hidden>Catatan hari tersebut dihapus, misalnya karena hari libur yang terlanjur ditandai. Riwayatnya tetap tercatat di log.</p>
        <label>Alasan revisi
          <textarea name="alasan" rows="2" maxlength="300" placeholder="Contoh: HP guru rusak, hadir sesuai daftar piket"></textarea>
          <small>Wajib diisi. Tercatat di log aktivitas beserta data sebelum revisi.</small>
        </label>
        <div class="alert alert-error" id="cf-error" hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Batal</button>
          <button type="submit" class="btn btn-primary">Simpan Revisi</button>
        </div>
      </form>`;
    const form = slot.querySelector('form');
    const sync = () => {
      slot.querySelector('#cf-times').hidden = !present.includes(form.status.value);
      slot.querySelector('#cf-hapus-note').hidden = form.status.value !== 'HAPUS';
    };
    form.status.onchange = sync;
    sync();
    slot.querySelector('[data-cancel]').onclick = close;
    form.onsubmit = async e => {
      e.preventDefault();
      const err = slot.querySelector('#cf-error');
      err.hidden = true;
      const alasan = form.alasan.value.trim();
      if (alasan.length < 5) { err.textContent = 'Alasan revisi minimal 5 karakter.'; err.hidden = false; return; }
      if (present.includes(form.status.value) && !form.jamMasuk.value) { err.textContent = 'Isi jam masuk untuk status ' + form.status.value + '.'; err.hidden = false; return; }
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try {
          const res = await Api.call('adminBulkCorrect', {
            userId: target.userId, tanggal: target.dates, status: form.status.value,
            jamMasuk: form.jamMasuk.value, jamPulang: form.jamPulang.value, alasan,
          });
          close();
          toast(form.status.value === 'HAPUS' ? `${res.dihapus} catatan dihapus.` : `${res.diubah} hari direvisi untuk ${target.nama}.`, 'success');
          onDone();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      });
    };
    icons();
  }

  /* ======================= REVISI PER GURU ======================= */

  const rv = { userId: null, bulan: null, data: null, selected: [] };

  /** Membuka halaman revisi untuk satu guru (dari menu Guru, Dashboard, atau Laporan). */
  function openRevision(userId, bulan) {
    rv.userId = userId;
    rv.bulan = bulan || todayWib().slice(0, 7);
    rv.selected = [];
    App.go('revisi', true);
  }

  function monthLabel(bulan) {
    return new Date(bulan + '-15T12:00:00+07:00').toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', month: 'long', year: 'numeric' });
  }

  function shiftMonth(bulan, delta) {
    const [y, m] = bulan.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 15));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  async function revision(view) {
    if (!rv.userId) {
      view.innerHTML = `<div class="card empty">${Brand.emptyCalendar()}Pilih guru dari menu <b>Guru</b>, lalu ketuk <b>Riwayat &amp; Revisi</b>.
        <p><button class="btn btn-primary btn-sm" id="rv-go-guru">Buka menu Guru</button></p></div>`;
      document.getElementById('rv-go-guru').onclick = () => App.go('guru');
      return;
    }
    if (!s.users.length) {
      try { s.users = await Api.call('adminListUsers'); } catch (e) { /* daftar pilihan guru opsional */ }
    }
    const current = todayWib().slice(0, 7);
    const options = s.users.filter(u => isGuru(u) || u.userId === rv.userId);
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Revisi Absensi</h1><p>Ketuk tanggal untuk merevisi, atau centang beberapa tanggal sekaligus.</p></div>
      </div>
      <section class="card">
        <div class="form">
          <label>Guru<select id="rv-user">
            ${options.map(u => `<option value="${esc(u.userId)}" ${u.userId === rv.userId ? 'selected' : ''}>${esc(u.nama)}${u.jenjang ? ' · ' + esc(u.jenjang) : ''}</option>`).join('')}
          </select></label>
        </div>
        <div class="month-switch" style="margin-top:10px">
          <button class="icon-btn" id="rv-prev" aria-label="Bulan sebelumnya"><i data-lucide="chevron-left"></i></button>
          <strong>${esc(monthLabel(rv.bulan))}</strong>
          <button class="icon-btn" id="rv-next" aria-label="Bulan berikutnya" ${rv.bulan >= current ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button>
        </div>
      </section>
      <div class="mini-stats" id="rv-stats"></div>
      <div class="chips" id="rv-quick"></div>
      <section class="card"><div id="rv-list" class="hist-list"><div class="empty"><span class="spinner spinner-dark"></span></div></div></section>
      <div class="bulk-bar" id="rv-bulk" hidden>
        <span id="rv-bulk-n"></span>
        <div><button class="btn btn-ghost btn-sm" id="rv-clear">Batal</button>
          <button class="btn btn-primary btn-sm" id="rv-apply"><i data-lucide="pencil"></i> Revisi</button></div>
      </div>`;
    icons();
    document.getElementById('rv-user').onchange = e => { rv.userId = e.target.value; rv.selected = []; revision(view); };
    document.getElementById('rv-prev').onclick = () => { rv.bulan = shiftMonth(rv.bulan, -1); rv.selected = []; revision(view); };
    document.getElementById('rv-next').onclick = () => { if (rv.bulan < current) { rv.bulan = shiftMonth(rv.bulan, 1); rv.selected = []; revision(view); } };
    document.getElementById('rv-clear').onclick = () => { rv.selected = []; renderRevisionList(); };
    document.getElementById('rv-apply').onclick = openBulkRevision;

    const want = rv.userId + '|' + rv.bulan;
    try {
      const data = await Api.call('adminGuruMonth', { userId: rv.userId, bulan: rv.bulan });
      if (!document.getElementById('rv-list') || want !== rv.userId + '|' + rv.bulan) return;
      rv.data = data;
      renderRevisionList();
    } catch (err) {
      const box = document.getElementById('rv-list');
      if (box) box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  }

  const NEEDS_REVIEW = ['Tanpa Keterangan', 'Tanpa data'];

  function renderRevisionList() {
    const box = document.getElementById('rv-list');
    if (!box || !rv.data) return;
    const d = rv.data;
    const r = d.ringkasan;
    const stat = (label, v, color) => `<div class="mini-stat"><strong>${v}</strong><span><i class="dot" style="background:${color}"></i>${label}</span></div>`;
    document.getElementById('rv-stats').innerHTML =
      stat('Hadir', r['Hadir'], SERIES[0].color) + stat('Terlambat', r['Terlambat'], SERIES[1].color) +
      stat('Izin/Sakit', r['Izin'] + r['Sakit'], SERIES[2].color) + stat('Alpa', r['Tanpa Keterangan'], SERIES[4].color);

    const review = d.days.filter(x => NEEDS_REVIEW.includes(x.status) && x.tanggal < d.hariIni);
    const quick = document.getElementById('rv-quick');
    quick.innerHTML = review.length
      ? `<button class="chip" id="rv-pick-review">Pilih semua Alpa / Tanpa data (${review.length})</button>`
      : '';
    const pick = document.getElementById('rv-pick-review');
    if (pick) pick.onclick = () => { rv.selected = review.map(x => x.tanggal); renderRevisionList(); };

    const t = v => (v ? String(v).slice(0, 5) : '—');
    box.innerHTML = d.days.map(x => {
      const dt = new Date(x.tanggal + 'T12:00:00+07:00');
      const day = dt.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short' });
      const label = dt.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long' });
      const info = x.jamMasuk
        ? `Masuk ${t(x.jamMasuk)} · Pulang ${t(x.jamPulang)}`
        : esc(String(x.keterangan || '').replace(/\s*\(SUB-[A-Z0-9]+\)$/, '') ||
          (x.status === 'Libur' ? 'Bukan hari kerja' : x.status === 'Libur sif' ? 'Bukan giliran sif' : 'Belum ada catatan'));
      const checked = rv.selected.includes(x.tanggal);
      return `
        <div class="hist-item rv-item ${x.hariKerja ? '' : 'rv-off'} ${checked ? 'rv-checked' : ''}">
          <label class="rv-check"><input type="checkbox" data-pick="${x.tanggal}" ${checked ? 'checked' : ''} aria-label="Pilih ${esc(label)}"></label>
          <button class="rv-main" data-day="${x.tanggal}">
            <span class="hist-date"><strong>${dt.getDate()}</strong><span>${esc(day)}</span></span>
            <span class="hist-main"><strong>${esc(label)}${x.anomali ? ' <span class="anomaly-ic" title="Ada catatan anomali lokasi"><i data-lucide="triangle-alert"></i></span>' : ''}</strong>
              <span class="rv-meta">${Guru.statusPill(x.status)}<span>${info}</span></span></span>
          </button>
        </div>`;
    }).join('');

    box.querySelectorAll('[data-pick]').forEach(cb => {
      cb.onchange = () => {
        const tg = cb.dataset.pick;
        rv.selected = cb.checked ? rv.selected.concat(tg) : rv.selected.filter(x => x !== tg);
        renderRevisionList();
      };
    });
    box.querySelectorAll('[data-day]').forEach(b => {
      b.onclick = () => {
        const x = d.days.find(y => y.tanggal === b.dataset.day);
        openModal(d.guru.nama + ' — ' + fmtShort(x.tanggal), (body, close) => {
          renderCorrectionForm(body, { userId: rv.userId, nama: d.guru.nama, dates: [x.tanggal], current: x }, close, revisionReload);
        });
      };
    });

    const bar = document.getElementById('rv-bulk');
    bar.hidden = !rv.selected.length;
    document.getElementById('rv-bulk-n').textContent = rv.selected.length + ' tanggal dipilih';
    icons();
  }

  function revisionReload() {
    rv.selected = [];
    const view = document.getElementById('view');
    if (view && App.state.tab === 'revisi') revision(view);
  }

  function openBulkRevision() {
    if (!rv.selected.length || !rv.data) return;
    openModal('Revisi ' + rv.selected.length + ' tanggal', (body, close) => {
      renderCorrectionForm(body, { userId: rv.userId, nama: rv.data.guru.nama, dates: rv.selected.slice() }, close, revisionReload);
    });
  }

  /* ======================= LAPORAN ======================= */

  const rep = { mulai: null, selesai: null, jenjang: '', preset: 'bulan-ini', data: null };

  function isoShift(t, days) {
    const d = new Date(t + 'T12:00:00+07:00');
    d.setTime(d.getTime() + days * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
  }

  function presetRange(id) {
    const today = todayWib();
    const dow = Number(new Date(today + 'T12:00:00+07:00').getDay()) || 7; // 1 = Senin
    const firstOfMonth = today.slice(0, 8) + '01';
    if (id === 'hari-ini') return [today, today];
    if (id === 'minggu-ini') return [isoShift(today, 1 - dow), today];
    if (id === 'bulan-lalu') {
      const lastPrev = isoShift(firstOfMonth, -1);
      return [lastPrev.slice(0, 8) + '01', lastPrev];
    }
    return [firstOfMonth, today];
  }

  function reports(view) {
    if (!rep.mulai) [rep.mulai, rep.selesai] = presetRange(rep.preset);
    const today = todayWib();
    const presets = [['hari-ini', 'Hari ini'], ['minggu-ini', 'Minggu ini'], ['bulan-ini', 'Bulan ini'], ['bulan-lalu', 'Bulan lalu']];
    view.innerHTML = `
      <div class="page-head"><div><h1>Laporan Absensi</h1><p>Rekap per guru dan ekspor ke Excel / CSV.</p></div></div>
      <section class="card">
        <div class="chips">${presets.map(([id, label]) => `<button class="chip ${rep.preset === id ? 'active' : ''}" data-preset="${id}">${label}</button>`).join('')}</div>
        <form class="form report-form" id="report-form" novalidate>
          <div class="form-row">
            <label>Dari<input type="date" name="mulai" value="${rep.mulai}" max="${today}"></label>
            <label>Sampai<input type="date" name="selesai" value="${rep.selesai}" max="${today}"></label>
          </div>
          <div class="form-row">
            <label>Jenjang<select name="jenjang">
              <option value="">Semua jenjang</option>
              <option value="TK" ${rep.jenjang === 'TK' ? 'selected' : ''}>TK</option>
              <option value="SD" ${rep.jenjang === 'SD' ? 'selected' : ''}>SD</option></select></label>
            <label class="report-submit"><span>&nbsp;</span><button class="btn btn-primary" type="submit"><i data-lucide="refresh-cw"></i> Tampilkan</button></label>
          </div>
          <div class="alert alert-error" id="rep-error" hidden></div>
        </form>
      </section>
      <div id="report-out"><div class="card empty"><span class="spinner spinner-dark"></span></div></div>`;
    icons();

    const form = document.getElementById('report-form');
    view.querySelectorAll('[data-preset]').forEach(b => {
      b.onclick = () => {
        rep.preset = b.dataset.preset;
        [rep.mulai, rep.selesai] = presetRange(rep.preset);
        reports(view);
      };
    });
    form.onsubmit = e => {
      e.preventDefault();
      rep.mulai = form.mulai.value;
      rep.selesai = form.selesai.value;
      rep.jenjang = form.jenjang.value;
      rep.preset = '';
      view.querySelectorAll('[data-preset]').forEach(x => x.classList.remove('active'));
      loadReport(form.querySelector('[type=submit]'));
    };
    loadReport(null);
  }

  async function loadReport(button) {
    const out = document.getElementById('report-out');
    formError('rep-error', '');
    const run = async () => {
      try {
        const data = await Api.call('adminReport', { mulai: rep.mulai, selesai: rep.selesai, jenjang: rep.jenjang });
        if (!out.isConnected) return;
        rep.data = data;
        renderReport(out);
      } catch (err) {
        if (!out.isConnected) return;
        formError('rep-error', err.message);
        out.innerHTML = '';
      }
    };
    if (button) await withLoading(button, run); else await run();
  }

  function periodLabel(d) {
    return d.mulai === d.selesai ? fmtLong(d.mulai) : `${fmtShort(d.mulai)} – ${fmtShort(d.selesai)} ${d.selesai.slice(0, 4)}`;
  }

  function renderReport(out) {
    const d = rep.data;
    const t = d.totals;
    const tile = (label, value, color) => `<div class="kpi"><div class="kpi-label">${color ? `<i class="dot" style="background:${color}"></i>` : ''}${label}</div><div class="kpi-value">${value}</div></div>`;
    const pctClass = p => (p >= 90 ? 'st-hadir' : p >= 75 ? 'st-terlambat' : 'st-alpa');
    out.innerHTML = `
      <div class="stack">
        <div class="report-bar">
          <div><strong>${esc(periodLabel(d))}</strong><span class="muted"> · ${d.hariKerja} hari kerja${d.jenjang ? ' · ' + esc(d.jenjang) : ''}</span></div>
          <div class="report-actions">
            <button class="btn btn-primary btn-sm" id="exp-xlsx"><i data-lucide="file-spreadsheet"></i> Excel</button>
            <button class="btn btn-ghost btn-sm" id="exp-csv"><i data-lucide="file-down"></i> CSV</button>
          </div>
        </div>
        <div class="kpis">
          ${tile('Hadir tepat waktu', t.hadir, SERIES[0].color)}${tile('Terlambat', t.terlambat, SERIES[1].color)}
          ${tile('Izin', t.izin, SERIES[2].color)}${tile('Sakit', t.sakit, SERIES[3].color)}
          ${tile('Tanpa Keterangan', t.alpa, SERIES[4].color)}${tile('Guru', t.guru, null)}
        </div>
        <section class="card">
          <div class="card-head"><div><h2>Rekap per guru</h2><p>Kehadiran = (hadir + terlambat) ÷ hari kerja. Ketuk nama untuk merevisi.</p></div></div>
          ${d.perGuru.length ? `
          <div class="table-scroll">
            <table class="report-table">
              <thead><tr><th>Nama guru</th><th class="n">Kehadiran</th><th class="n">Hadir</th><th class="n">Terlambat</th><th class="n">Izin</th><th class="n">Sakit</th><th class="n">Alpa</th><th class="n">Hari kerja</th><th>Jenjang</th></tr></thead>
              <tbody>${d.perGuru.map(g => `
                <tr data-rev="${esc(g.userId)}"><td class="name">${esc(g.nama)}</td>
                  <td class="n"><span class="status-pill ${pctClass(g.persenHadir)}">${String(g.persenHadir).replace('.', ',')}%</span></td>
                  <td class="n">${g.hadir}</td><td class="n">${g.terlambat}</td><td class="n">${g.izin}</td><td class="n">${g.sakit}</td>
                  <td class="n">${g.alpa}${g.tanpaData ? `<span class="muted" title="Hari kerja tanpa catatan"> +${g.tanpaData}?</span>` : ''}</td>
                  <td class="n">${g.hariKerja}</td><td>${esc(g.jenjang || '—')}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
          ${t.tanpaData ? '<p class="rekap-foot">Angka “+n?” = hari kerja tanpa catatan apa pun (misalnya sebelum penandaan otomatis aktif). Periksa dan koreksi bila perlu.</p>' : ''}`
          : '<div class="empty">Tidak ada data guru untuk periode ini.</div>'}
        </section>
        <p class="muted small-note">Detail harian (jam masuk, jam pulang, jarak, keterangan) tersedia di berkas Excel/CSV.</p>
      </div>`;
    icons();
    out.querySelectorAll('[data-rev]').forEach(tr => { tr.onclick = () => openRevision(tr.dataset.rev, d.mulai.slice(0, 7)); });
    document.getElementById('exp-xlsx').onclick = e => exportXlsx(e.currentTarget);
    document.getElementById('exp-csv').onclick = exportCsv;
  }

  function reportFileBase() {
    const d = rep.data;
    return `Laporan-Absensi_${d.mulai}_sd_${d.selesai}${d.jenjang ? '_' + d.jenjang : ''}`;
  }

  function sheetsData() {
    const d = rep.data;
    const rekap = [['Nama Guru', 'Jenjang', 'Hari Kerja', 'Hadir', 'Terlambat', 'Izin', 'Sakit', 'Tanpa Keterangan', 'Tanpa Data', 'Kehadiran (%)']]
      .concat(d.perGuru.map(g => [g.nama, g.jenjang, g.hariKerja, g.hadir, g.terlambat, g.izin, g.sakit, g.alpa, g.tanpaData, g.persenHadir]));
    const detail = [['Tanggal', 'Nama Guru', 'Jenjang', 'Jam Masuk', 'Jam Pulang', 'Status', 'Jarak Masuk (m)', 'Jarak Pulang (m)', 'Keterangan']]
      .concat(d.details.map(r => [r.tanggal, r.nama, r.jenjang, r.jamMasuk, r.jamPulang, r.status,
        r.jarakMasuk === '' ? '' : Math.round(Number(r.jarakMasuk)), r.jarakPulang === '' ? '' : Math.round(Number(r.jarakPulang)), r.keterangan]));
    return { rekap, detail };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** CSV berpemisah titik koma (sesuai Excel berbahasa Indonesia), UTF-8 dengan BOM. */
  function exportCsv() {
    const cell = v => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // cegah rumus berbahaya saat dibuka di Excel
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const { detail } = sheetsData();
    const csv = '﻿' + detail.map(row => row.map(cell).join(';')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), reportFileBase() + '.csv');
    toast('CSV detail harian diunduh.', 'success');
  }

  let xlsxLoading = null;
  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve();
    if (!xlsxLoading) {
      xlsxLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = resolve;
        s.onerror = () => { xlsxLoading = null; reject(new Error('Gagal memuat modul Excel. Periksa koneksi internet.')); };
        document.head.appendChild(s);
      });
    }
    return xlsxLoading;
  }

  async function exportXlsx(button) {
    await withLoading(button, async () => {
      try {
        await loadSheetJs();
        const d = rep.data;
        const { rekap, detail } = sheetsData();
        const title = [['Laporan Absensi Guru — ' + App.state.school.schoolName], ['Periode: ' + periodLabel(d) + (d.jenjang ? ' · Jenjang ' + d.jenjang : '') + ' · ' + d.hariKerja + ' hari kerja'], []];
        const wsRekap = XLSX.utils.aoa_to_sheet(title.concat(rekap));
        wsRekap['!cols'] = [{ wch: 30 }, { wch: 9 }, { wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 7 }, { wch: 7 }, { wch: 17 }, { wch: 11 }, { wch: 14 }];
        const wsDetail = XLSX.utils.aoa_to_sheet(detail);
        wsDetail['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 9 }, { wch: 11 }, { wch: 11 }, { wch: 17 }, { wch: 15 }, { wch: 16 }, { wch: 48 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, wsRekap, 'Rekap per Guru');
        XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail Harian');
        XLSX.writeFile(wb, reportFileBase() + '.xlsx');
        toast('Berkas Excel diunduh.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
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
    const gurus = s.users.filter(isGuru);
    const count = j => gurus.filter(u => u.jenjang === j && u.statusAkun === 'aktif').length;
    list.innerHTML = `
      <p class="muted list-summary">${gurus.length} guru · ${count('TK')} TK aktif · ${count('SD')} SD aktif · ketuk nama untuk mengelola</p>
      ${rows.map(u => {
        const self = u.userId === App.state.user.userId;
        const active = u.statusAkun === 'aktif';
        return `
          <button class="card user-row ${active ? '' : 'inactive'}" data-user="${esc(u.userId)}">
            <span class="avatar">${esc(initials(u.nama))}</span>
            <span class="user-main">
              <strong>${esc(u.nama)}${self ? ' <span class="muted">(Anda)</span>' : ''}</strong>
              <span class="user-email">${esc(u.email)}</span>
              <span class="badges">
                ${rolesOf(u).map(r => `<span class="badge badge-${r}">${ROLE_LABEL[r]}</span>`).join('')}
                ${u.jenjang ? `<span class="badge">${esc(u.jenjang)}</span>` : ''}
                ${u.sifSabtu ? `<span class="badge badge-sif">${esc(SIF_LABEL[u.sifSabtu])}</span>` : ''}
                ${active ? '' : '<span class="badge badge-off">Nonaktif</span>'}
                ${u.lastLogin ? '' : '<span class="badge badge-warn">Belum pernah login</span>'}
              </span>
            </span>
            <i data-lucide="chevron-right" class="row-chevron"></i>
          </button>`;
      }).join('')}`;
    const byId = id => s.users.find(u => u.userId === id);
    list.querySelectorAll('[data-user]').forEach(b => { b.onclick = () => openUserForm(byId(b.dataset.user)); });
    icons();
  }

  const SIF_LABEL = { '': 'Setiap Sabtu', A: 'Sabtu Sif A', B: 'Sabtu Sif B', libur: 'Tidak masuk Sabtu' };

  function replaceUser(updated) {
    const i = s.users.findIndex(u => u.userId === updated.userId);
    if (i >= 0) s.users[i] = updated; else s.users.push(updated);
    s.users.sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
    if (updated.userId === App.state.user.userId) App.setUser(updated);
  }

  function openUserForm(user) {
    const isEdit = !!user;
    const u = user || { nama: '', email: '', nip: '', role: 'guru', roles: ['guru'], jenjang: '', statusAkun: 'aktif' };
    const self = isEdit && u.userId === App.state.user.userId;
    openModal(isEdit ? 'Ubah Data Guru' : 'Tambah Guru', (body, close) => {
      body.innerHTML = `
        <form id="user-form" class="form" novalidate>
          ${isEdit && isGuru(u) ? '<button type="button" class="btn btn-primary btn-sm btn-block" data-history><i data-lucide="calendar-days"></i> Riwayat &amp; Revisi Absensi</button>' : ''}
          ${isEdit && !self ? `
          <div class="quick-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-toggle-user><i data-lucide="${u.statusAkun === 'aktif' ? 'user-x' : 'user-check'}"></i> ${u.statusAkun === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}</button>
            <button type="button" class="btn btn-ghost btn-sm btn-reject" data-delete-user><i data-lucide="trash-2"></i> Hapus akun</button>
          </div>` : ''}
          <label>Nama lengkap &amp; gelar<input name="nama" required maxlength="100" value="${esc(u.nama)}" autocomplete="off" placeholder="Contoh: Fouziah, S.Pd"></label>
          <label>Email<input name="email" type="email" required maxlength="254" value="${esc(u.email)}" autocomplete="off" placeholder="nama@gmail.com">
            <small>Dipakai guru untuk login (akun Google atau kode email).</small></label>
          <label><span>NIP <span class="muted">(opsional)</span></span><input name="nip" inputmode="numeric" maxlength="30" value="${esc(u.nip)}" autocomplete="off"></label>
          <fieldset class="days">
            <legend>Peran <span class="muted">(boleh lebih dari satu)</span></legend>
            <label class="day-chip"><input type="checkbox" name="roles" value="guru" ${rolesOf(u).includes('guru') ? 'checked' : ''}><span>Guru — wajib absen</span></label>
            <label class="day-chip"><input type="checkbox" name="roles" value="admin" ${rolesOf(u).includes('admin') ? 'checked' : ''} ${self ? 'disabled' : ''}><span>Admin — kelola aplikasi</span></label>
          </fieldset>
          ${self ? '<small class="muted">Hak admin akun Anda sendiri tidak dapat dicabut. Centang Guru bila Anda juga mengajar dan wajib absen.</small>' : ''}
          <div class="form-row">
            <label>Jenjang<select name="jenjang">
              <option value="" ${!u.jenjang ? 'selected' : ''}>—</option>
              <option value="TK" ${u.jenjang === 'TK' ? 'selected' : ''}>TK</option>
              <option value="SD" ${u.jenjang === 'SD' ? 'selected' : ''}>SD</option></select></label>
          </div>
          <label>Sif Sabtu
            <select name="sifSabtu">
              ${Object.keys(SIF_LABEL).map(k => `<option value="${k}" ${(u.sifSabtu || '') === k ? 'selected' : ''}>${SIF_LABEL[k]}</option>`).join('')}
            </select>
            <small>Untuk guru yang masuk Sabtu bergantian. Di luar gilirannya tidak ditandai Alpa, tetapi tetap bisa absen bila masuk.</small>
          </label>
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
      const hist = body.querySelector('[data-history]');
      if (hist) hist.onclick = () => { close(); openRevision(u.userId); };
      const tg = body.querySelector('[data-toggle-user]');
      if (tg) tg.onclick = () => { close(); toggleUser(null, u); };
      const del = body.querySelector('[data-delete-user]');
      if (del) del.onclick = () => { close(); deleteUser(null, u); };
      form.onsubmit = async e => {
        e.preventDefault();
        const f = new FormData(form);
        // Admin tidak bisa mencabut hak admin sendiri (kotak dinonaktifkan, tidak ikut terkirim).
        const roles = f.getAll('roles').concat(self ? ['admin'] : []).filter((r, i, a) => a.indexOf(r) === i);
        const payload = { nama: f.get('nama'), email: f.get('email'), nip: f.get('nip'), roles, jenjang: f.get('jenjang'), sifSabtu: f.get('sifSabtu') };
        const errBox = body.querySelector('#form-error');
        errBox.hidden = true;
        if (!roles.length) { errBox.textContent = 'Pilih minimal satu peran.'; errBox.hidden = false; return; }
        if (roles.includes('guru') && !payload.jenjang) { errBox.textContent = 'Pilih jenjang (TK atau SD) untuk peran Guru.'; errBox.hidden = false; return; }
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

  /** Spinner di tombol bila ada; bila dipanggil dari panel yang sudah ditutup, cukup notifikasi. */
  function runWithOptionalLoading(button, fn) {
    return button ? withLoading(button, fn) : fn();
  }

  async function toggleUser(button, u) {
    const activate = u.statusAkun !== 'aktif';
    const ok = await confirm(activate ? 'Aktifkan Akun' : 'Nonaktifkan Akun',
      activate ? `${u.nama} akan dapat login kembali.` : `${u.nama} tidak akan dapat login dan sesi aktifnya diakhiri. Data absensinya tetap tersimpan.`,
      activate ? 'Aktifkan' : 'Nonaktifkan', !activate);
    if (!ok) return;
    await runWithOptionalLoading(button, async () => {
      try {
        const saved = await Api.call('adminUpdateUser', {
          userId: u.userId, nama: u.nama, email: u.email, nip: u.nip, roles: rolesOf(u), jenjang: u.jenjang,
          sifSabtu: u.sifSabtu || '', statusAkun: activate ? 'aktif' : 'nonaktif',
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
    await runWithOptionalLoading(button, async () => {
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
    let loc, sch, people;
    try {
      [loc, sch, people] = await Promise.all([Api.call('getLocationConfig'), Api.call('adminGetSchedule'), Api.call('adminListUsers')]);
    } catch (err) {
      view.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      return;
    }
    if (!view.isConnected) return;
    const time = (name, label, value, help) => `<label>${label}<input name="${name}" type="time" required value="${esc(value)}"><small>${help}</small></label>`;

    view.innerHTML = `
      <button class="banner banner-neutral" id="go-log"><i data-lucide="scroll-text"></i>Log aktivitas — riwayat login, perubahan data, dan koreksi<i data-lucide="chevron-right"></i></button>
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
              <label>Sabtu acuan giliran Sif A
                <input name="sifAcuan" type="date" value="${esc(sch.sifAcuan)}">
                <small>Sabtu ini = Sif A, Sabtu berikutnya = Sif B, dan seterusnya bergantian. Sif tiap guru diatur di menu Guru.
                  <b>Sabtu terdekat (${esc(fmtShort(sch.sabtuBerikut))}): giliran Sif ${esc(sch.giliranSabtuBerikut)}.</b></small>
              </label>
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
              <label>Radius (meter)<input name="radius" type="number" inputmode="numeric" min="10" max="200" value="${esc(loc.radius)}"></label>
              <label>Batas akurasi GPS (m)<input name="maxAccuracy" type="number" inputmode="numeric" min="5" max="200" value="${esc(loc.maxAccuracy)}"></label>
            </div>
            <small class="muted">Default radius 50 m dan akurasi 30 m (keduanya maksimal 200 m). Batas akurasi yang longgar membuat absen lebih mudah, tetapi lokasi kurang pasti.</small>
            <div class="alert alert-error" id="loc-error" hidden></div>
            <button type="submit" class="btn btn-primary"><i data-lucide="save"></i> Simpan Lokasi</button>
          </form>
        </section>
      </div>
      <section class="card card-danger">
        <div class="card-head"><div><h2>Hapus Data</h2><p>Misalnya data uji coba sebelum aplikasi dipakai. Tidak dapat dibatalkan.</p></div></div>
        <form id="purge-form" class="form" novalidate>
          <div class="form-row">
            <label>Jenis data<select name="jenis">
              <option value="semua">Absensi &amp; pengajuan</option>
              <option value="absensi">Absensi saja</option>
              <option value="pengajuan">Pengajuan izin/sakit saja</option></select></label>
            <label>Guru<select name="userId">
              <option value="">Semua guru</option>
              ${people.map(p => `<option value="${esc(p.userId)}">${esc(p.nama)}</option>`).join('')}</select></label>
          </div>
          <div class="form-row">
            <label>Dari tanggal<input type="date" name="mulai" required></label>
            <label>Sampai tanggal<input type="date" name="selesai" required></label>
          </div>
          <small class="muted">Log aktivitas tidak ikut terhapus, sehingga jejak penghapusan tetap tercatat.</small>
          <div class="alert alert-error" id="purge-error" hidden></div>
          <button type="submit" class="btn btn-ghost btn-reject"><i data-lucide="search"></i> Periksa jumlah data</button>
        </form>
      </section>`;
    icons();
    bindPurgeForm();
    document.getElementById('go-log').onclick = () => App.go('log');
    bindIdentityForm();
    bindScheduleForm();
    bindLocationForm();
  }

  function formError(id, message) {
    const el = document.getElementById(id);
    el.textContent = message || '';
    el.hidden = !message;
  }

  /** Dua langkah: hitung dulu (pratinjau), lalu hapus setelah admin mengetik HAPUS. */
  function bindPurgeForm() {
    const form = document.getElementById('purge-form');
    form.onsubmit = async e => {
      e.preventDefault();
      formError('purge-error', '');
      const filter = { jenis: form.jenis.value, userId: form.userId.value, mulai: form.mulai.value, selesai: form.selesai.value };
      if (!filter.mulai || !filter.selesai) return formError('purge-error', 'Isi tanggal mulai dan selesai.');
      const who = filter.userId ? form.userId.selectedOptions[0].textContent : 'semua guru';
      let preview;
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try { preview = await Api.call('adminDeleteData', filter); } catch (err) { formError('purge-error', err.message); }
      });
      if (!preview) return;
      if (!preview.absensi && !preview.pengajuan) return toast('Tidak ada data yang cocok untuk dihapus.', 'info');

      openModal('Konfirmasi Hapus Data', (body, close) => {
        body.innerHTML = `
          <p class="confirm-text">Akan dihapus permanen untuk <b>${esc(who)}</b>, ${esc(fmtShort(filter.mulai))} – ${esc(fmtShort(filter.selesai))}:</p>
          <div class="detail-grid">
            <div class="metric"><span>Data absensi</span><strong>${preview.absensi}</strong></div>
            <div class="metric"><span>Pengajuan izin/sakit</span><strong>${preview.pengajuan}</strong></div>
          </div>
          <form class="form" id="purge-confirm" novalidate>
            <label><span>Ketik <b>HAPUS</b> untuk melanjutkan</span><input name="k" autocomplete="off" autocapitalize="characters"></label>
            <div class="alert alert-error" id="purge-confirm-error" hidden></div>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" data-cancel>Batal</button>
              <button type="submit" class="btn btn-danger" disabled>Hapus permanen</button>
            </div>
          </form>`;
        const cf = body.querySelector('#purge-confirm');
        const go = cf.querySelector('[type=submit]');
        cf.k.oninput = () => { go.disabled = cf.k.value.trim().toUpperCase() !== 'HAPUS'; };
        body.querySelector('[data-cancel]').onclick = close;
        cf.onsubmit = async ev => {
          ev.preventDefault();
          await withLoading(go, async () => {
            try {
              const res = await Api.call('adminDeleteData', Object.assign({ konfirmasi: 'HAPUS' }, filter));
              close();
              toast(`Terhapus: ${res.absensi} data absensi, ${res.pengajuan} pengajuan.`, 'success');
            } catch (err) {
              const box = body.querySelector('#purge-confirm-error');
              box.textContent = err.message;
              box.hidden = false;
            }
          });
        };
      });
    };
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
            sifAcuan: f.get('sifAcuan'),
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

  return { dashboard, reports, revision, openRevision, users, audit, settings };
})();

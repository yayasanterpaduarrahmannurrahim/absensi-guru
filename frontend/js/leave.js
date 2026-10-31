/**
 * leave.js — Pengajuan izin/sakit: formulir & riwayat milik guru, serta daftar
 * persetujuan untuk admin. Foto bukti diperkecil di perangkat sebelum dikirim.
 */
const Leave = (() => {
  const { esc, icons, toast, withLoading, openModal, confirm } = UI;
  const MAX_PROOF_BYTES = 2.5 * 1024 * 1024;
  const STATUS_CLASS = { Menunggu: 'lv-wait', Disetujui: 'lv-ok', Ditolak: 'lv-no', Dibatalkan: 'lv-cancel' };
  let adminFilter = 'Menunggu';

  /* ---------- Tanggal ---------- */

  function todayWib() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  }

  function shiftDate(tanggal, days) {
    const d = new Date(tanggal + 'T12:00:00+07:00');
    d.setTime(d.getTime() + days * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
  }

  function fmtDate(tanggal) {
    return new Date(tanggal + 'T12:00:00+07:00').toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  }

  function fmtRange(a, b) {
    return a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`;
  }

  /* ---------- Bukti ---------- */

  function readAsBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('Gagal membaca file.'));
      reader.readAsDataURL(blob);
    });
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Foto tidak dapat dibaca. Coba foto lain.')); };
      img.src = url;
    });
  }

  /** Menyiapkan bukti: foto diperkecil (maks. 1600 px, JPEG), PDF dikirim apa adanya (maks. 2,5 MB). */
  async function prepareProof(file) {
    if (file.type === 'application/pdf') {
      if (file.size > MAX_PROOF_BYTES) throw new Error('Ukuran PDF maksimal 2,5 MB.');
      return { mimeType: 'application/pdf', data: await readAsBase64(file) };
    }
    if (!/^image\//.test(file.type)) throw new Error('Pilih file foto (JPG/PNG) atau PDF.');
    const img = await loadImage(file);
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (!blob) throw new Error('Foto tidak dapat diproses. Coba foto lain.');
    if (blob.size > MAX_PROOF_BYTES) throw new Error('Foto terlalu besar. Coba foto dengan resolusi lebih kecil.');
    return { mimeType: 'image/jpeg', data: await readAsBase64(blob) };
  }

  function base64ToBlob(data, mimeType) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  /* ---------- Kartu pengajuan ---------- */

  function leaveCard(l, actions, showName) {
    return `
      <article class="card leave-card">
        <div class="leave-head">
          <div>
            ${showName ? `<strong>${esc(l.nama)}</strong>` : ''}
            <div class="leave-type"><span class="badge ${l.jenis === 'Sakit' ? 'badge-sakit' : 'badge-izin'}">${esc(l.jenis)}</span>
              <span>${esc(fmtRange(l.tanggalMulai, l.tanggalSelesai))}</span></div>
          </div>
          <span class="status-pill ${STATUS_CLASS[l.status] || ''}">${esc(l.status)}</span>
        </div>
        <p class="leave-reason">${esc(l.alasan)}</p>
        ${l.catatanAdmin ? `<p class="leave-note"><strong>Catatan admin:</strong> ${esc(l.catatanAdmin)}</p>` : ''}
        <p class="muted leave-meta">Diajukan ${esc(l.createdAt)} WIB${l.hasBukti ? ' · <i data-lucide="paperclip"></i> ada bukti' : ''}</p>
        ${actions ? `<div class="leave-actions">${actions}</div>` : ''}
      </article>`;
  }

  /* ---------- Guru: pengajuan saya ---------- */

  async function renderMine(view) {
    view.innerHTML = `
      <section class="card">
        <h2 class="card-title">Izin &amp; Sakit</h2>
        <p class="muted">Ajukan izin atau sakit. Pengajuan akan diperiksa admin sekolah.</p>
        <button class="btn btn-primary btn-block" id="btn-new-leave"><i data-lucide="file-plus"></i> Ajukan Izin / Sakit</button>
      </section>
      <div id="my-leaves" class="list"><div class="empty"><span class="spinner spinner-dark"></span></div></div>`;
    icons();
    document.getElementById('btn-new-leave').onclick = () => openForm(() => loadMine());
    loadMine();
  }

  async function loadMine() {
    const box = document.getElementById('my-leaves');
    if (!box) return;
    let leaves;
    try {
      leaves = await Api.call('myLeaves');
    } catch (err) {
      if (box.isConnected) box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      return;
    }
    if (!box.isConnected) return;
    if (!leaves.length) {
      box.innerHTML = '<div class="empty">Belum ada pengajuan.</div>';
      return;
    }
    box.innerHTML = `<p class="muted list-summary">Riwayat pengajuan</p>` + leaves.map(l => leaveCard(l,
      l.status === 'Menunggu' ? `<button class="btn btn-ghost btn-sm" data-cancel="${esc(l.submissionId)}"><i data-lucide="x"></i> Batalkan</button>` : '',
      false)).join('');
    box.querySelectorAll('[data-cancel]').forEach(b => {
      b.onclick = async () => {
        const ok = await confirm('Batalkan Pengajuan', 'Batalkan pengajuan ini?', 'Batalkan Pengajuan', true);
        if (!ok) return;
        await withLoading(b, async () => {
          try {
            await Api.call('cancelLeave', { submissionId: b.dataset.cancel });
            toast('Pengajuan dibatalkan.', 'success');
            loadMine();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      };
    });
    icons();
  }

  function openForm(onSaved) {
    const today = todayWib();
    const min = shiftDate(today, -7);
    const max = shiftDate(today, 60);
    openModal('Ajukan Izin / Sakit', (body, close) => {
      body.innerHTML = `
        <form id="leave-form" class="form" novalidate>
          <fieldset class="days">
            <legend>Jenis</legend>
            <label class="day-chip"><input type="radio" name="jenis" value="Izin" checked><span>Izin</span></label>
            <label class="day-chip"><input type="radio" name="jenis" value="Sakit"><span>Sakit</span></label>
          </fieldset>
          <div class="form-row">
            <label>Dari tanggal
              <input name="tanggalMulai" type="date" required value="${today}" min="${min}" max="${max}">
            </label>
            <label>Sampai tanggal
              <input name="tanggalSelesai" type="date" required value="${today}" min="${min}" max="${max}">
            </label>
          </div>
          <label>Alasan
            <textarea name="alasan" rows="3" maxlength="500" required placeholder="Contoh: demam tinggi, istirahat sesuai saran dokter"></textarea>
          </label>
          <label><span>Bukti pendukung <span class="muted">(opsional)</span></span>
            <input name="bukti" type="file" accept="image/*,application/pdf">
            <small>Foto surat dokter/surat izin, atau PDF. Foto otomatis diperkecil.</small>
          </label>
          <div id="leave-error" class="alert alert-error" hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-cancel>Batal</button>
            <button type="submit" class="btn btn-primary">Kirim Pengajuan</button>
          </div>
        </form>`;

      const form = body.querySelector('#leave-form');
      body.querySelector('[data-cancel]').onclick = close;
      form.tanggalMulai.onchange = () => {
        if (form.tanggalSelesai.value < form.tanggalMulai.value) form.tanggalSelesai.value = form.tanggalMulai.value;
      };
      form.onsubmit = async e => {
        e.preventDefault();
        const errBox = body.querySelector('#leave-error');
        errBox.hidden = true;
        const alasan = form.alasan.value.trim();
        if (alasan.length < 5) {
          errBox.textContent = 'Alasan minimal 5 karakter.';
          errBox.hidden = false;
          return;
        }
        await withLoading(form.querySelector('[type=submit]'), async () => {
          try {
            const file = form.bukti.files[0];
            const bukti = file ? await prepareProof(file) : null;
            await Api.call('submitLeave', {
              jenis: form.jenis.value,
              tanggalMulai: form.tanggalMulai.value,
              tanggalSelesai: form.tanggalSelesai.value,
              alasan: alasan,
              bukti: bukti,
            });
            close();
            toast('Pengajuan terkirim. Menunggu persetujuan admin.', 'success');
            onSaved();
          } catch (err) {
            errBox.textContent = err.message;
            errBox.hidden = false;
          }
        });
      };
    });
  }

  /* ---------- Admin: persetujuan ---------- */

  async function renderAdmin(view) {
    const chip = (value, label) =>
      `<button class="tab ${adminFilter === value ? 'active' : ''}" data-filter="${value}">${label}</button>`;
    view.innerHTML = `
      <div class="filters">
        ${chip('Menunggu', 'Menunggu')}${chip('Disetujui', 'Disetujui')}${chip('Ditolak', 'Ditolak')}${chip('', 'Semua')}
      </div>
      <div id="admin-leaves" class="list"><div class="empty"><span class="spinner spinner-dark"></span></div></div>`;
    view.querySelectorAll('[data-filter]').forEach(b => {
      b.onclick = () => { adminFilter = b.dataset.filter; renderAdmin(view); };
    });

    const box = document.getElementById('admin-leaves');
    let leaves;
    try {
      leaves = await Api.call('adminListLeaves', { status: adminFilter });
    } catch (err) {
      if (box.isConnected) box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      return;
    }
    if (!box.isConnected) return;
    if (!leaves.length) {
      box.innerHTML = `<div class="empty">${adminFilter ? 'Tidak ada pengajuan ' + esc(adminFilter.toLowerCase()) + '.' : 'Belum ada pengajuan.'}</div>`;
      return;
    }
    box.innerHTML = `<p class="muted list-summary">${leaves.length} pengajuan</p>` + leaves.map(l => {
      const proofBtn = l.hasBukti ? `<button class="btn btn-ghost btn-sm" data-proof="${esc(l.submissionId)}"><i data-lucide="paperclip"></i> Lihat bukti</button>` : '';
      const decide = l.status === 'Menunggu' ? `
        <button class="btn btn-ghost btn-sm btn-reject" data-reject="${esc(l.submissionId)}"><i data-lucide="x"></i> Tolak</button>
        <button class="btn btn-primary btn-sm" data-approve="${esc(l.submissionId)}"><i data-lucide="check"></i> Setujui</button>` : '';
      return leaveCard(l, proofBtn + decide, true);
    }).join('');

    const byId = id => leaves.find(l => l.submissionId === id);
    box.querySelectorAll('[data-proof]').forEach(b => { b.onclick = () => viewProof(b, byId(b.dataset.proof)); });
    box.querySelectorAll('[data-approve]').forEach(b => { b.onclick = () => openDecision(byId(b.dataset.approve), 'Disetujui', () => renderAdmin(view)); });
    box.querySelectorAll('[data-reject]').forEach(b => { b.onclick = () => openDecision(byId(b.dataset.reject), 'Ditolak', () => renderAdmin(view)); });
    icons();
  }

  function openDecision(l, keputusan, onDone) {
    const approve = keputusan === 'Disetujui';
    openModal(approve ? 'Setujui Pengajuan' : 'Tolak Pengajuan', (body, close) => {
      body.innerHTML = `
        <form id="decision-form" class="form" novalidate>
          <p class="confirm-text"><strong>${esc(l.nama)}</strong> — ${esc(l.jenis)}, ${esc(fmtRange(l.tanggalMulai, l.tanggalSelesai))}</p>
          ${approve ? '<p class="muted small-note">Hari kerja dalam rentang ini akan tercatat sebagai ' + esc(l.jenis) + '. Hari yang sudah diisi absen masuk tidak diubah.</p>' : ''}
          <label><span>Catatan ${approve ? '<span class="muted">(opsional)</span>' : '(wajib)'}</span>
            <textarea name="catatan" rows="3" maxlength="500" ${approve ? '' : 'required'}></textarea>
          </label>
          <div id="decision-error" class="alert alert-error" hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-cancel>Batal</button>
            <button type="submit" class="btn ${approve ? 'btn-primary' : 'btn-danger'}">${approve ? 'Setujui' : 'Tolak'}</button>
          </div>
        </form>`;
      const form = body.querySelector('#decision-form');
      body.querySelector('[data-cancel]').onclick = close;
      form.onsubmit = async e => {
        e.preventDefault();
        const errBox = body.querySelector('#decision-error');
        errBox.hidden = true;
        const catatan = form.catatan.value.trim();
        if (!approve && !catatan) {
          errBox.textContent = 'Tuliskan alasan penolakan.';
          errBox.hidden = false;
          return;
        }
        await withLoading(form.querySelector('[type=submit]'), async () => {
          try {
            const res = await Api.call('adminProcessLeave', { submissionId: l.submissionId, keputusan, catatan });
            close();
            let msg = approve ? `Disetujui. Tercatat ${l.jenis} pada ${res.applied.diterapkan.length} hari kerja.` : 'Pengajuan ditolak.';
            if (res.applied.dilewati.length) msg += ` ${res.applied.dilewati.length} hari dilewati (sudah ada absensi).`;
            toast(msg, 'success');
            onDone();
          } catch (err) {
            errBox.textContent = err.message;
            errBox.hidden = false;
          }
        });
      };
    });
  }

  async function viewProof(button, l) {
    await withLoading(button, async () => {
      try {
        const proof = await Api.call('adminGetLeaveProof', { submissionId: l.submissionId });
        const url = URL.createObjectURL(base64ToBlob(proof.data, proof.mimeType));
        const isPdf = proof.mimeType === 'application/pdf';
        openModal('Bukti — ' + l.nama, body => {
          body.innerHTML = isPdf
            ? `<p class="muted">Bukti berupa file PDF.</p>
               <a class="btn btn-primary btn-block" href="${url}" target="_blank" rel="noopener" download="bukti-${esc(l.submissionId)}.pdf"><i data-lucide="file-text"></i> Buka PDF</a>`
            : `<img class="proof-img" src="${url}" alt="Bukti pengajuan ${esc(l.nama)}">`;
        }, () => URL.revokeObjectURL(url));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  return { renderMine, renderAdmin };
})();

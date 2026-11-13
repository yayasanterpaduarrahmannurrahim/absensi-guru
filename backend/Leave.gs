/**
 * Leave.gs — Pengajuan izin/sakit, persetujuan admin, bukti pendukung (Google Drive),
 * dan penetapan otomatis status Tanpa Keterangan.
 *
 * Bukti disimpan di folder Drive privat milik akun pemilik. File tidak dibagikan;
 * admin melihatnya melalui aplikasi (adminGetLeaveProof), bukan lewat link Drive.
 */

const PROP_BUKTI_FOLDER_ID = 'BUKTI_FOLDER_ID';
const PROP_LAST_ALPA_DATE = 'LAST_ALPA_DATE';
const MAX_PROOF_BYTES = 2.5 * 1024 * 1024;
const PROOF_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/* ---------- Tanggal ---------- */

/** Objek Date pada pukul 12:00 WIB untuk tanggal 'yyyy-MM-dd' (aman dari pergeseran zona). */
function wibNoon_(tanggal) {
  return new Date(tanggal + 'T12:00:00+07:00');
}

function parseIsoDate_(value, label) {
  const s = vString_(value, label, { required: true, pattern: /^\d{4}-\d{2}-\d{2}$/, patternMessage: label + ' tidak valid.' });
  const d = wibNoon_(s);
  if (isNaN(d.getTime()) || fmtWib_(d, 'yyyy-MM-dd') !== s) throw new AppError('VALIDATION', label + ' tidak valid.');
  return s;
}

function addDays_(tanggal, n) {
  return fmtWib_(new Date(wibNoon_(tanggal).getTime() + n * 86400000), 'yyyy-MM-dd');
}

/** 1 = Senin ... 7 = Minggu. */
function dayOfWeek_(tanggal) {
  return Number(fmtWib_(wibNoon_(tanggal), 'u'));
}

function daysBetween_(from, to) {
  return Math.round((wibNoon_(to).getTime() - wibNoon_(from).getTime()) / 86400000);
}

/* ---------- Validasi & bukti ---------- */

/** Validasi pengajuan dari guru. `today` = tanggal server 'yyyy-MM-dd'. */
function validateLeaveInput_(p, today) {
  const jenis = vEnum_(p.jenis, 'Jenis pengajuan', [STATUS_HADIR.IZIN, STATUS_HADIR.SAKIT], { required: true });
  const mulai = parseIsoDate_(p.tanggalMulai, 'Tanggal mulai');
  const selesai = parseIsoDate_(p.tanggalSelesai || p.tanggalMulai, 'Tanggal selesai');
  if (selesai < mulai) throw new AppError('VALIDATION', 'Tanggal selesai tidak boleh sebelum tanggal mulai.');
  if (daysBetween_(mulai, selesai) > 30) throw new AppError('VALIDATION', 'Satu pengajuan maksimal 31 hari.');
  if (daysBetween_(mulai, today) > 7) throw new AppError('VALIDATION', 'Pengajuan untuk tanggal yang sudah lewat maksimal 7 hari ke belakang.');
  if (daysBetween_(today, mulai) > 60) throw new AppError('VALIDATION', 'Pengajuan maksimal 60 hari ke depan.');
  return {
    jenis: jenis,
    mulai: mulai,
    selesai: selesai,
    alasan: vString_(p.alasan, 'Alasan', { required: true, min: 5, max: 500 }),
  };
}

/** Memastikan isi file sesuai jenisnya (bukan sekadar label MIME dari browser). */
function proofMagicOk_(bytes, mime) {
  const b = i => (bytes[i] + 256) % 256;
  const ascii = (from, len) => String.fromCharCode.apply(null, bytes.slice(from, from + len).map((x, i) => b(from + i)));
  if (bytes.length < 12) return false;
  if (mime === 'image/jpeg') return b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF;
  if (mime === 'image/png') return b(0) === 0x89 && ascii(1, 3) === 'PNG';
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  if (mime === 'application/pdf') return ascii(0, 4) === '%PDF';
  return false;
}

/** Validasi bukti { mimeType, data(base64) }. Mengembalikan null bila tidak ada bukti. */
function readProof_(bukti) {
  if (!bukti) return null;
  const mime = vEnum_(bukti.mimeType, 'Jenis file bukti', Object.keys(PROOF_EXT), { required: true });
  let bytes;
  try {
    bytes = Utilities.base64Decode(String(bukti.data || ''));
  } catch (e) {
    throw new AppError('VALIDATION', 'File bukti rusak. Silakan pilih ulang.');
  }
  if (!bytes.length) throw new AppError('VALIDATION', 'File bukti kosong.');
  if (bytes.length > MAX_PROOF_BYTES) throw new AppError('VALIDATION', 'Ukuran file bukti maksimal 2,5 MB.');
  if (!proofMagicOk_(bytes, mime)) throw new AppError('VALIDATION', 'Isi file bukti tidak sesuai jenisnya. Gunakan foto (JPG/PNG) atau PDF.');
  return { bytes: bytes, mimeType: mime, ext: PROOF_EXT[mime] };
}

function getProofFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROP_BUKTI_FOLDER_ID);
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (e) { /* folder terhapus: buat baru */ }
  }
  const folder = DriveApp.createFolder('Bukti Izin Absensi Guru');
  props.setProperty(PROP_BUKTI_FOLDER_ID, folder.getId());
  return folder;
}

/** Menyimpan bukti ke folder privat. Mengembalikan URL file (hanya bisa dibuka pemilik). */
function saveProofFile_(proof, submissionId, user) {
  const blob = Utilities.newBlob(proof.bytes, proof.mimeType, submissionId + '.' + proof.ext);
  const file = getProofFolder_().createFile(blob);
  file.setDescription('Bukti ' + submissionId + ' — ' + user.nama_guru);
  return file.getUrl();
}

function fileIdFromUrl_(url) {
  const m = String(url || '').match(/\/d\/([A-Za-z0-9_-]+)/) || String(url || '').match(/[?&]id=([A-Za-z0-9_-]+)/);
  return m ? m[1] : '';
}

function trashProofFile_(url) {
  const id = fileIdFromUrl_(url);
  if (id) DriveApp.getFileById(id).setTrashed(true);
}

/* ---------- Pengajuan ---------- */

function publicLeave_(r) {
  return {
    submissionId: r.submission_id,
    userId: r.user_id,
    nama: r.nama_guru,
    jenis: r.jenis_pengajuan,
    tanggalMulai: r.tanggal_mulai,
    tanggalSelesai: r.tanggal_selesai,
    alasan: r.alasan,
    hasBukti: !!r.bukti_url,
    status: r.status_persetujuan,
    catatanAdmin: r.catatan_admin,
    diprosesAt: r.diproses_at,
    createdAt: r.created_at,
  };
}

/** Membuat pengajuan baru berstatus Menunggu. */
function createLeave_(user, input, proof, now) {
  const id = generateId_('SUB');
  // File disimpan di luar lock (lambat) agar tidak menahan absensi guru lain.
  const buktiUrl = proof ? saveProofFile_(proof, id, user) : '';
  try {
    return withLock_(() => {
      const overlap = findRowsBy_(SHEETS.PENGAJUAN, 'user_id', user.user_id).find(r =>
        (r.status_persetujuan === STATUS_PENGAJUAN.MENUNGGU || r.status_persetujuan === STATUS_PENGAJUAN.DISETUJUI) &&
        !(r.tanggal_selesai < input.mulai || r.tanggal_mulai > input.selesai));
      if (overlap) {
        throw new AppError('OVERLAP', 'Sudah ada pengajuan ' + overlap.jenis_pengajuan + ' (' + overlap.status_persetujuan +
          ') untuk tanggal ' + overlap.tanggal_mulai + ' s.d. ' + overlap.tanggal_selesai + '.');
      }
      const rec = insertRow_(SHEETS.PENGAJUAN, {
        submission_id: id,
        user_id: user.user_id,
        nama_guru: user.nama_guru,
        jenis_pengajuan: input.jenis,
        tanggal_mulai: input.mulai,
        tanggal_selesai: input.selesai,
        alasan: input.alasan,
        bukti_url: buktiUrl,
        status_persetujuan: STATUS_PENGAJUAN.MENUNGGU,
        catatan_admin: '',
        diproses_oleh: '',
        diproses_at: '',
        created_at: now.waktu,
      });
      return publicLeave_(rec);
    });
  } catch (err) {
    if (buktiUrl) trashProofFile_(buktiUrl);
    throw err;
  }
}

function cancelLeave_(user, submissionId, now) {
  return withLock_(() => {
    const r = findByKey_(SHEETS.PENGAJUAN, submissionId);
    if (!r || r.user_id !== user.user_id) throw new AppError('NOT_FOUND', 'Pengajuan tidak ditemukan.');
    if (r.status_persetujuan !== STATUS_PENGAJUAN.MENUNGGU) {
      throw new AppError('NOT_PENDING', 'Hanya pengajuan berstatus Menunggu yang dapat dibatalkan.');
    }
    const updated = updateByKey_(SHEETS.PENGAJUAN, submissionId, {
      status_persetujuan: STATUS_PENGAJUAN.DIBATALKAN,
      diproses_oleh: user.user_id,
      diproses_at: now.waktu,
    });
    logAudit_(user.user_id, 'BATAL_PENGAJUAN', { submission_id: submissionId });
    return publicLeave_(updated);
  });
}

/**
 * Menerapkan pengajuan yang disetujui ke ABSENSI untuk setiap hari kerja dalam rentang.
 * - Belum ada data          → dibuat dengan status Izin/Sakit.
 * - Tanpa Keterangan (auto) → diubah menjadi Izin/Sakit.
 * - Sudah absen / status lain → tidak diubah (dilaporkan sebagai dilewati).
 */
function applyLeaveToAttendance_(leave, schedule, now) {
  const diterapkan = [];
  const dilewati = [];
  const keterangan = leave.jenis_pengajuan + ': ' + leave.alasan + ' (' + leave.submission_id + ')';
  const guru = findByKey_(SHEETS.USERS, leave.user_id) || { user_id: leave.user_id };
  for (let t = leave.tanggal_mulai; t <= leave.tanggal_selesai; t = addDays_(t, 1)) {
    if (!isScheduledFor_(guru, t, schedule)) continue; // libur umum / bukan giliran sif

    const id = attendanceId_(t, leave.user_id);
    const existing = findByKey_(SHEETS.ABSENSI, id);
    if (!existing) {
      insertRow_(SHEETS.ABSENSI, {
        attendance_id: id, user_id: leave.user_id, nama_guru: leave.nama_guru, tanggal: t,
        status: leave.jenis_pengajuan, keterangan: keterangan, anomali: '',
        created_at: now.waktu, updated_at: now.waktu,
      });
      diterapkan.push(t);
    } else if (existing.status === STATUS_HADIR.TANPA_KETERANGAN && !existing.jam_masuk) {
      updateByKey_(SHEETS.ABSENSI, id, { status: leave.jenis_pengajuan, keterangan: keterangan, updated_at: now.waktu });
      diterapkan.push(t);
    } else {
      dilewati.push({ tanggal: t, alasan: existing.jam_masuk ? 'sudah absen masuk' : 'sudah tercatat ' + existing.status });
    }
  }
  return { diterapkan: diterapkan, dilewati: dilewati };
}

/** Admin menyetujui/menolak pengajuan berstatus Menunggu. */
function processLeave_(adminUser, p, schedule, now) {
  const submissionId = vString_(p.submissionId, 'ID pengajuan', { required: true, max: 40 });
  const decision = vEnum_(p.keputusan, 'Keputusan', [STATUS_PENGAJUAN.DISETUJUI, STATUS_PENGAJUAN.DITOLAK], { required: true });
  const catatan = vString_(p.catatan, 'Catatan', { max: 500, required: decision === STATUS_PENGAJUAN.DITOLAK });

  return withLock_(() => {
    const r = findByKey_(SHEETS.PENGAJUAN, submissionId);
    if (!r) throw new AppError('NOT_FOUND', 'Pengajuan tidak ditemukan.');
    if (r.status_persetujuan !== STATUS_PENGAJUAN.MENUNGGU) {
      throw new AppError('NOT_PENDING', 'Pengajuan ini sudah ' + String(r.status_persetujuan).toLowerCase() + '.');
    }
    const applied = decision === STATUS_PENGAJUAN.DISETUJUI
      ? applyLeaveToAttendance_(r, schedule, now)
      : { diterapkan: [], dilewati: [] };
    const updated = updateByKey_(SHEETS.PENGAJUAN, submissionId, {
      status_persetujuan: decision,
      catatan_admin: catatan,
      diproses_oleh: adminUser.user_id,
      diproses_at: now.waktu,
    });
    logAudit_(adminUser.user_id, 'PROSES_PENGAJUAN', {
      submission_id: submissionId, guru: r.nama_guru, keputusan: decision, catatan: catatan,
      diterapkan: applied.diterapkan, dilewati: applied.dilewati,
    });
    return { leave: publicLeave_(updated), applied: applied };
  });
}

/* ---------- Tanpa Keterangan otomatis ---------- */

/** Menandai Tanpa Keterangan untuk guru yang tidak punya data absensi pada `tanggal`. */
function markAbsenteesFor_(tanggal, gurus, cutoff, now) {
  return withLock_(() => {
    const sudahAda = {};
    findRowsBy_(SHEETS.ABSENSI, 'tanggal', tanggal).forEach(r => { sudahAda[r.user_id] = true; });
    let count = 0;
    gurus.forEach(u => {
      if (sudahAda[u.user_id]) return;
      insertRow_(SHEETS.ABSENSI, {
        attendance_id: attendanceId_(tanggal, u.user_id), user_id: u.user_id, nama_guru: u.nama_guru,
        tanggal: tanggal, status: STATUS_HADIR.TANPA_KETERANGAN,
        keterangan: 'Otomatis: tidak ada absensi hingga ' + cutoff + ' WIB', anomali: '',
        created_at: now.waktu, updated_at: now.waktu,
      });
      count++;
    });
    return count;
  });
}

/**
 * Guru yang wajib hadir pada tanggal t: sudah terdaftar pada tanggal itu dan
 * dijadwalkan (bukan libur sif Sabtu). Hanya mereka yang dapat ditandai Tanpa Keterangan.
 */
function scheduledGurus_(gurus, t, schedule) {
  return gurus.filter(u => String(u.created_at).slice(0, 10) <= t && isScheduledFor_(u, t, schedule));
}

/**
 * Dipanggil trigger setiap jam. Memproses hari ini (bila sudah lewat batas absen masuk)
 * serta hari-hari yang terlewat sejak proses terakhir (maks. 7 hari, mis. saat trigger gagal).
 */
function autoMarkTanpaKeterangan() {
  const now = nowWib_();
  const schedule = getSchedule_();
  const props = PropertiesService.getScriptProperties();
  const last = props.getProperty(PROP_LAST_ALPA_DATE) || addDays_(now.tanggal, -1);
  const pastCutoff = now.jam.slice(0, 5) > schedule.batasAbsenMasuk;

  const gurus = readAll_(SHEETS.USERS).filter(u => hasRole_(u, ROLES.GURU) && u.status_akun === STATUS_AKUN.AKTIF);
  for (let i = 7; i >= 0; i--) {
    const t = addDays_(now.tanggal, -i);
    if (t <= last || (i === 0 && !pastCutoff)) continue;
    if (schedule.hariKerja.indexOf(dayOfWeek_(t)) >= 0) {
      const eligible = scheduledGurus_(gurus, t, schedule);
      const n = markAbsenteesFor_(t, eligible, schedule.batasAbsenMasuk, now);
      if (n) logAudit_('SYSTEM', 'OTOMATIS_TANPA_KETERANGAN', { tanggal: t, jumlah: n });
    }
    props.setProperty(PROP_LAST_ALPA_DATE, t);
  }
}

/**
 * Memasang trigger per jam untuk autoMarkTanpaKeterangan. Aman dijalankan ulang.
 * Penandaan dimulai dari hari berikutnya agar data sebelum trigger dipasang tidak ikut ditandai.
 */
function installTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'autoMarkTanpaKeterangan')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('autoMarkTanpaKeterangan').timeBased().everyHours(1).create();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP_LAST_ALPA_DATE)) props.setProperty(PROP_LAST_ALPA_DATE, nowWib_().tanggal);
  console.log('Trigger Tanpa Keterangan terpasang (setiap jam). Mulai memproses tanggal setelah ' +
    props.getProperty(PROP_LAST_ALPA_DATE) + '.');
}

/* ---------- Handler API ---------- */

function apiSubmitLeave_(payload, ctx) {
  const now = nowWib_();
  const input = validateLeaveInput_(payload, now.tanggal);
  const proof = readProof_(payload.bukti);
  const leave = createLeave_(ctx.session.user, input, proof, now);
  logAudit_(ctx.session.user.user_id, 'AJUKAN_PENGAJUAN', {
    submission_id: leave.submissionId, jenis: leave.jenis, mulai: leave.tanggalMulai, selesai: leave.tanggalSelesai,
  });
  return leave;
}

function apiMyLeaves_(payload, ctx) {
  return findRowsBy_(SHEETS.PENGAJUAN, 'user_id', ctx.session.user.user_id)
    .map(publicLeave_)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50);
}

function apiCancelLeave_(payload, ctx) {
  const id = vString_(payload.submissionId, 'ID pengajuan', { required: true, max: 40 });
  return cancelLeave_(ctx.session.user, id, nowWib_());
}

function apiAdminListLeaves_(payload) {
  const status = vEnum_(payload.status, 'Status', Object.keys(STATUS_PENGAJUAN).map(k => STATUS_PENGAJUAN[k]), {});
  return readAll_(SHEETS.PENGAJUAN)
    .filter(r => !status || r.status_persetujuan === status)
    .map(publicLeave_)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 200);
}

function apiAdminProcessLeave_(payload, ctx) {
  return processLeave_(ctx.session.user, payload, getSchedule_(), nowWib_());
}

/** Mengirim isi file bukti (base64) agar admin dapat melihatnya tanpa membuka akses Drive. */
function apiAdminGetLeaveProof_(payload) {
  const id = vString_(payload.submissionId, 'ID pengajuan', { required: true, max: 40 });
  const r = findByKey_(SHEETS.PENGAJUAN, id);
  if (!r || !r.bukti_url) throw new AppError('NOT_FOUND', 'Bukti tidak ditemukan.');
  const blob = DriveApp.getFileById(fileIdFromUrl_(r.bukti_url)).getBlob();
  return { mimeType: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

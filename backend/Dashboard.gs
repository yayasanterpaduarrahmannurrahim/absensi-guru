/**
 * Dashboard.gs — Data dashboard guru & admin, rekap harian, koreksi absensi,
 * identitas sekolah, dan audit log.
 */

const BELUM_ABSEN = 'Belum absen';
const LIBUR_SIF = 'Libur sif';

function emptyCounts_() {
  return { 'Hadir': 0, 'Terlambat': 0, 'Izin': 0, 'Sakit': 0, 'Tanpa Keterangan': 0 };
}

function countStatuses_(records) {
  const c = emptyCounts_();
  records.forEach(r => { if (Object.prototype.hasOwnProperty.call(c, r.status)) c[r.status]++; });
  return c;
}

/* ---------- Guru ---------- */

/** Riwayat absensi milik guru untuk satu bulan ('yyyy-MM'), terbaru di atas. */
function apiMyHistory_(payload, ctx) {
  const now = nowWib_();
  const bulan = payload.bulan
    ? vString_(payload.bulan, 'Bulan', { pattern: /^\d{4}-(0[1-9]|1[0-2])$/ })
    : now.tanggal.slice(0, 7);
  const rows = findRowsBy_(SHEETS.ABSENSI, 'user_id', ctx.session.user.user_id)
    .filter(r => String(r.tanggal).slice(0, 7) === bulan)
    .sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)));
  return { bulan: bulan, ringkasan: countStatuses_(rows), records: rows.map(publicAttendance_) };
}

/* ---------- Admin: rekap harian ---------- */

function adminDayRow_(u, r, offShift) {
  return {
    userId: u.user_id,
    nama: u.nama_guru,
    jenjang: u.jenjang || '',
    sifSabtu: u.sif_sabtu || '',
    statusAkun: u.status_akun || '',
    attendanceId: r ? r.attendance_id : '',
    status: r ? r.status : (offShift ? LIBUR_SIF : BELUM_ABSEN),
    jamMasuk: r ? r.jam_masuk : '',
    jamPulang: r ? r.jam_pulang : '',
    jarakMasuk: r ? r.jarak_masuk : '',
    jarakPulang: r ? r.jarak_pulang : '',
    accuracyMasuk: r ? r.accuracy_masuk : '',
    accuracyPulang: r ? r.accuracy_pulang : '',
    keterangan: r ? r.keterangan : '',
    anomali: r ? r.anomali : '',
  };
}

/**
 * Menyusun baris rekap satu tanggal: semua guru aktif (yang belum absen ditandai
 * "Belum absen", atau "Libur sif" bila Sabtu itu bukan gilirannya), ditambah siapa pun
 * yang punya data pada tanggal itu (mis. guru yang kemudian dinonaktifkan/dihapus).
 * `tanggal` & `schedule` opsional; tanpa keduanya sif tidak diperhitungkan.
 */
function buildDayRows_(users, records, tanggal, schedule) {
  const byUser = {};
  records.forEach(r => { byUser[r.user_id] = r; });
  const known = {};
  const rows = [];
  users.forEach(u => {
    known[u.user_id] = true;
    if (byUser[u.user_id] || (hasRole_(u, ROLES.GURU) && u.status_akun === STATUS_AKUN.AKTIF)) {
      const offShift = !!(tanggal && schedule) && schedule.hariKerja.indexOf(dayOfWeek_(tanggal)) >= 0 &&
        !isScheduledFor_(u, tanggal, schedule);
      rows.push(adminDayRow_(u, byUser[u.user_id], offShift));
    }
  });
  records.filter(r => !known[r.user_id]).forEach(r => {
    rows.push(adminDayRow_({ user_id: r.user_id, nama_guru: r.nama_guru, jenjang: '', status_akun: 'dihapus' }, r, false));
  });
  return rows.sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
}

/** Ringkasan angka dari baris rekap. */
function summarizeDay_(rows, totalGuru) {
  const c = countStatuses_(rows);
  return {
    totalGuru: totalGuru,
    hadir: c['Hadir'] + c['Terlambat'],
    tepatWaktu: c['Hadir'],
    terlambat: c['Terlambat'],
    izin: c['Izin'],
    sakit: c['Sakit'],
    tanpaKeterangan: c['Tanpa Keterangan'],
    belumAbsen: rows.filter(r => r.status === BELUM_ABSEN).length,
    liburSif: rows.filter(r => r.status === LIBUR_SIF).length,
  };
}

/** Jumlah per status untuk `days` hari terakhir sampai `endDate`. */
function buildTrend_(records, endDate, days, hariKerja) {
  const byDate = {};
  records.forEach(r => { (byDate[r.tanggal] = byDate[r.tanggal] || []).push(r); });
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const t = addDays_(endDate, -i);
    out.push(Object.assign({ tanggal: t, hariKerja: hariKerja.indexOf(dayOfWeek_(t)) >= 0 }, countStatuses_(byDate[t] || [])));
  }
  return out;
}

function apiAdminDashboard_(payload) {
  const now = nowWib_();
  const tanggal = payload.tanggal ? parseIsoDate_(payload.tanggal, 'Tanggal') : now.tanggal;
  const schedule = getSchedule_();
  const users = readAll_(SHEETS.USERS);
  const activeGurus = users.filter(u => hasRole_(u, ROLES.GURU) && u.status_akun === STATUS_AKUN.AKTIF);

  const rows = buildDayRows_(users, findRowsBy_(SHEETS.ABSENSI, 'tanggal', tanggal), tanggal, schedule);

  // Tren 14 hari: cukup membaca baris terakhir ABSENSI (data ditulis kurang lebih berurutan waktu).
  const TREND_DAYS = 14;
  const tail = readTail_(SHEETS.ABSENSI, Math.max(2000, activeGurus.length * TREND_DAYS * 3));
  const start = addDays_(tanggal, -(TREND_DAYS - 1));
  const trendRecords = tail.filter(r => r.tanggal >= start && r.tanggal <= tanggal);

  const pendingLeaves = findRowsBy_(SHEETS.PENGAJUAN, 'status_persetujuan', STATUS_PENGAJUAN.MENUNGGU).length;

  return {
    tanggal: tanggal,
    hariIni: now.tanggal,
    isWorkday: schedule.hariKerja.indexOf(dayOfWeek_(tanggal)) >= 0,
    schedule: { batasAbsenMasuk: schedule.batasAbsenMasuk, batasTerlambat: schedule.batasTerlambat },
    summary: summarizeDay_(rows, activeGurus.length),
    rows: rows,
    trend: buildTrend_(trendRecords, tanggal, TREND_DAYS, schedule.hariKerja),
    pendingLeaves: pendingLeaves,
  };
}

/* ---------- Admin: koreksi absensi ---------- */

function validateCorrection_(p, today) {
  const userId = vString_(p.userId, 'ID guru', { required: true, max: 40 });
  const tanggal = parseIsoDate_(p.tanggal, 'Tanggal');
  if (tanggal > today) throw new AppError('VALIDATION', 'Koreksi tidak dapat dilakukan untuk tanggal yang akan datang.');
  const status = vEnum_(p.status, 'Status',
    [STATUS_HADIR.HADIR, STATUS_HADIR.TERLAMBAT, STATUS_HADIR.IZIN, STATUS_HADIR.SAKIT, STATUS_HADIR.TANPA_KETERANGAN],
    { required: true });
  const present = status === STATUS_HADIR.HADIR || status === STATUS_HADIR.TERLAMBAT;
  const jam = (v, label, required) => {
    const s = vString_(v, label, {
      required: required,
      pattern: /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/,
      patternMessage: label + ' harus berformat JJ:MM.',
    });
    return s && s.length === 5 ? s + ':00' : s;
  };
  const jamMasuk = present ? jam(p.jamMasuk, 'Jam masuk', true) : '';
  const jamPulang = present ? jam(p.jamPulang, 'Jam pulang', false) : '';
  if (jamPulang && jamPulang < jamMasuk) throw new AppError('VALIDATION', 'Jam pulang tidak boleh sebelum jam masuk.');
  return {
    userId: userId,
    tanggal: tanggal,
    status: status,
    jamMasuk: jamMasuk,
    jamPulang: jamPulang,
    alasan: vString_(p.alasan, 'Alasan koreksi', { required: true, min: 5, max: 300 }),
  };
}

/**
 * Menerapkan koreksi admin. Membuat data bila belum ada. Nilai sebelum & sesudah
 * dicatat di AUDIT_LOG; keterangan baris diberi tanda "Koreksi admin".
 */
function correctAttendance_(adminUser, input, now) {
  return withLock_(() => {
    const user = findByKey_(SHEETS.USERS, input.userId);
    const id = attendanceId_(input.tanggal, input.userId);
    const existing = findByKey_(SHEETS.ABSENSI, id);
    if (!user && !existing) throw new AppError('NOT_FOUND', 'Guru tidak ditemukan.');

    const nama = user ? user.nama_guru : existing.nama_guru;
    const changes = {
      status: input.status,
      jam_masuk: input.jamMasuk,
      jam_pulang: input.jamPulang,
      keterangan: 'Koreksi admin: ' + input.alasan,
      updated_at: now.waktu,
    };
    const pick = r => ({ status: r.status, jam_masuk: r.jam_masuk, jam_pulang: r.jam_pulang, keterangan: r.keterangan });
    let saved;
    if (existing) {
      saved = updateByKey_(SHEETS.ABSENSI, id, changes);
    } else {
      saved = insertRow_(SHEETS.ABSENSI, Object.assign({
        attendance_id: id, user_id: input.userId, nama_guru: nama, tanggal: input.tanggal,
        anomali: '', created_at: now.waktu,
      }, changes));
    }
    // Koreksi menentukan ulang status/jam; penanda anti-ganda lama tidak lagi berlaku.
    clearAttendanceMarkers_(id);
    logAudit_(adminUser.user_id, 'KOREKSI_ABSENSI', {
      attendance_id: id, guru: nama, tanggal: input.tanggal,
      sebelum: existing ? pick(existing) : null, sesudah: pick(saved), alasan: input.alasan,
    });
    return adminDayRow_(user || { user_id: input.userId, nama_guru: nama, jenjang: '', status_akun: 'dihapus' }, saved, false);
  });
}

function apiAdminCorrectAttendance_(payload, ctx) {
  const now = nowWib_();
  return correctAttendance_(ctx.session.user, validateCorrection_(payload, now.tanggal), now);
}

/* ---------- Admin: revisi absensi per guru (tanggal yang sudah lewat) ---------- */

const HAPUS_CATATAN = 'HAPUS';
const TANPA_DATA = 'Tanpa data';
const LIBUR = 'Libur';

/** Tanggal terakhir pada bulan 'yyyy-MM'. */
function lastDayOfMonth_(bulan) {
  let t = bulan + '-28';
  while (addDays_(t, 1).slice(0, 7) === bulan) t = addDays_(t, 1);
  return t;
}

/**
 * Semua tanggal dalam satu bulan (sampai hari ini) untuk satu guru, termasuk hari tanpa catatan,
 * hari libur, dan libur sif — agar admin dapat merevisi tanggal mana pun yang sudah lewat.
 */
function buildGuruMonth_(user, records, bulan, schedule, today) {
  const byDate = {};
  records.forEach(r => { byDate[r.tanggal] = r; });
  const first = bulan + '-01';
  const last = lastDayOfMonth_(bulan) < today ? lastDayOfMonth_(bulan) : today;
  const days = [];
  for (let t = first; t <= last; t = addDays_(t, 1)) {
    const r = byDate[t];
    const hariKerja = schedule.hariKerja.indexOf(dayOfWeek_(t)) >= 0;
    const terjadwal = isScheduledFor_(user, t, schedule);
    let status = r ? r.status : (!hariKerja ? LIBUR : !terjadwal ? LIBUR_SIF : t === today ? BELUM_ABSEN : TANPA_DATA);
    days.push({
      tanggal: t, hariKerja: hariKerja, terjadwal: terjadwal, adaCatatan: !!r, status: status,
      jamMasuk: r ? r.jam_masuk : '', jamPulang: r ? r.jam_pulang : '',
      jarakMasuk: r ? r.jarak_masuk : '', jarakPulang: r ? r.jarak_pulang : '',
      keterangan: r ? r.keterangan : '', anomali: r ? r.anomali : '',
    });
  }
  return days.reverse(); // terbaru di atas
}

function apiAdminGuruMonth_(payload) {
  const now = nowWib_();
  const userId = vString_(payload.userId, 'Guru', { required: true, max: 40 });
  const bulan = payload.bulan
    ? vString_(payload.bulan, 'Bulan', { pattern: /^\d{4}-(0[1-9]|1[0-2])$/ })
    : now.tanggal.slice(0, 7);
  if (bulan > now.tanggal.slice(0, 7)) throw new AppError('VALIDATION', 'Bulan yang akan datang belum dapat direvisi.');
  const records = findRowsBy_(SHEETS.ABSENSI, 'user_id', userId).filter(r => String(r.tanggal).slice(0, 7) === bulan);
  const user = findByKey_(SHEETS.USERS, userId);
  if (!user && !records.length) throw new AppError('NOT_FOUND', 'Guru tidak ditemukan.');
  const u = user || { user_id: userId, nama_guru: records[0].nama_guru, jenjang: '', status_akun: 'dihapus' };
  return {
    guru: publicUser_(u),
    bulan: bulan,
    hariIni: now.tanggal,
    ringkasan: countStatuses_(records),
    days: buildGuruMonth_(u, records, bulan, getSchedule_(), now.tanggal),
  };
}

/** Validasi revisi untuk satu atau beberapa tanggal milik satu guru. */
function validateBulkCorrection_(p, today) {
  if (!Array.isArray(p.tanggal) || !p.tanggal.length) throw new AppError('VALIDATION', 'Pilih minimal satu tanggal.');
  if (p.tanggal.length > 62) throw new AppError('VALIDATION', 'Maksimal 62 tanggal sekali revisi.');
  const dates = p.tanggal.map(t => parseIsoDate_(t, 'Tanggal')).filter((t, i, a) => a.indexOf(t) === i).sort();
  if (dates[dates.length - 1] > today) throw new AppError('VALIDATION', 'Tanggal yang akan datang tidak dapat direvisi.');
  if (p.status === HAPUS_CATATAN) {
    return {
      userId: vString_(p.userId, 'ID guru', { required: true, max: 40 }),
      dates: dates,
      hapus: true,
      alasan: vString_(p.alasan, 'Alasan revisi', { required: true, min: 5, max: 300 }),
    };
  }
  // Status/jam/alasan divalidasi dengan aturan koreksi biasa (memakai tanggal pertama).
  const base = validateCorrection_(Object.assign({}, p, { tanggal: dates[0] }), today);
  return Object.assign(base, { dates: dates, hapus: false });
}

/**
 * Menerapkan revisi ke setiap tanggal. Setiap tanggal tercatat sendiri di AUDIT_LOG
 * (nilai sebelum & sesudah). "Hapus catatan" mengosongkan hari tersebut.
 */
function bulkCorrect_(adminUser, input, now) {
  return withLock_(() => {
    let diubah = 0;
    let dihapus = 0;
    input.dates.forEach(t => {
      if (input.hapus) {
        const id = attendanceId_(t, input.userId);
        const existing = findByKey_(SHEETS.ABSENSI, id);
        if (!existing) return;
        deleteByKey_(SHEETS.ABSENSI, id);
        clearAttendanceMarkers_(id);
        logAudit_(adminUser.user_id, 'HAPUS_CATATAN_ABSENSI', {
          attendance_id: id, guru: existing.nama_guru, tanggal: t, alasan: input.alasan,
          sebelum: { status: existing.status, jam_masuk: existing.jam_masuk, jam_pulang: existing.jam_pulang, keterangan: existing.keterangan },
        });
        dihapus++;
      } else {
        correctAttendance_(adminUser, Object.assign({}, input, { tanggal: t }), now);
        diubah++;
      }
    });
    return { diubah: diubah, dihapus: dihapus };
  });
}

function apiAdminBulkCorrect_(payload, ctx) {
  const now = nowWib_();
  return bulkCorrect_(ctx.session.user, validateBulkCorrection_(payload, now.tanggal), now);
}

/* ---------- Admin: hapus data (mis. data uji coba) ---------- */

function validateDeleteData_(p) {
  const jenis = vEnum_(p.jenis, 'Jenis data', ['absensi', 'pengajuan', 'semua'], { required: true });
  const mulai = parseIsoDate_(p.mulai, 'Tanggal mulai');
  const selesai = parseIsoDate_(p.selesai, 'Tanggal selesai');
  if (selesai < mulai) throw new AppError('VALIDATION', 'Tanggal selesai tidak boleh sebelum tanggal mulai.');
  return { jenis: jenis, mulai: mulai, selesai: selesai, userId: vString_(p.userId, 'Guru', { max: 40 }) };
}

function deleteMatchers_(f) {
  const user = r => !f.userId || r.user_id === f.userId;
  return {
    absensi: r => user(r) && r.tanggal >= f.mulai && r.tanggal <= f.selesai,
    // Pengajuan terhapus bila rentang tanggalnya bersinggungan dengan rentang yang dipilih.
    pengajuan: r => user(r) && r.tanggal_mulai <= f.selesai && r.tanggal_selesai >= f.mulai,
  };
}

/**
 * Menghapus data absensi dan/atau pengajuan dalam rentang tanggal (opsional satu guru).
 * Tanpa `konfirmasi: "HAPUS"` hanya menghitung (pratinjau), tidak menghapus apa pun.
 * Bukti pengajuan di Drive ikut dibuang ke sampah. AUDIT_LOG tidak pernah dihapus.
 */
function deleteData_(adminUser, f, confirmed) {
  const m = deleteMatchers_(f);
  const doAbsensi = f.jenis !== 'pengajuan';
  const doPengajuan = f.jenis !== 'absensi';
  if (!confirmed) {
    return {
      dryRun: true,
      absensi: doAbsensi ? readAll_(SHEETS.ABSENSI).filter(m.absensi).length : 0,
      pengajuan: doPengajuan ? readAll_(SHEETS.PENGAJUAN).filter(m.pengajuan).length : 0,
    };
  }
  return withLock_(() => {
    const absensi = doAbsensi ? deleteRowsWhere_(SHEETS.ABSENSI, m.absensi) : [];
    const pengajuan = doPengajuan ? deleteRowsWhere_(SHEETS.PENGAJUAN, m.pengajuan) : [];
    absensi.forEach(r => clearAttendanceMarkers_(r.attendance_id));
    pengajuan.filter(r => r.bukti_url).forEach(r => { try { trashProofFile_(r.bukti_url); } catch (e) { /* file sudah tidak ada */ } });
    logAudit_(adminUser.user_id, 'HAPUS_DATA', {
      jenis: f.jenis, mulai: f.mulai, selesai: f.selesai, guru: f.userId || 'semua',
      jumlah_absensi: absensi.length, jumlah_pengajuan: pengajuan.length,
    });
    return { dryRun: false, absensi: absensi.length, pengajuan: pengajuan.length };
  });
}

function apiAdminDeleteData_(payload, ctx) {
  return deleteData_(ctx.session.user, validateDeleteData_(payload), payload.konfirmasi === 'HAPUS');
}

/* ---------- Admin: identitas & audit log ---------- */

function apiAdminUpdateIdentity_(payload, ctx) {
  const schoolName = vString_(payload.schoolName, 'Nama sekolah', { required: true, min: 3, max: 100 });
  const before = setSettings_({ school_name: schoolName });
  logAudit_(ctx.session.user.user_id, 'UBAH_IDENTITAS_SEKOLAH', { sebelum: before, sesudah: { school_name: schoolName } });
  return apiGetPublicConfig_();
}

/** 200 aktivitas terbaru (opsional disaring kata kunci), terbaru di atas. */
function apiAdminAuditLog_(payload) {
  const q = vString_(payload.q, 'Pencarian', { max: 100 }).toLowerCase();
  const names = {};
  readAll_(SHEETS.USERS).forEach(u => { names[u.user_id] = u.nama_guru; });
  return readTail_(SHEETS.AUDIT_LOG, 1500)
    .reverse()
    .map(r => ({
      waktu: r.waktu,
      aktivitas: r.aktivitas,
      pelaku: names[r.user_id] || (r.user_id === 'SYSTEM' ? 'Sistem' : r.user_id || '—'),
      detail: r.detail,
    }))
    .filter(r => !q || [r.waktu, r.aktivitas, r.pelaku, r.detail].join(' ').toLowerCase().indexOf(q) >= 0)
    .slice(0, 200);
}

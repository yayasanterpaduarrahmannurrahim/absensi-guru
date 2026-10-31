/**
 * Dashboard.gs — Data dashboard guru & admin, rekap harian, koreksi absensi,
 * identitas sekolah, dan audit log.
 */

const BELUM_ABSEN = 'Belum absen';

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

function adminDayRow_(u, r) {
  return {
    userId: u.user_id,
    nama: u.nama_guru,
    jenjang: u.jenjang || '',
    statusAkun: u.status_akun || '',
    attendanceId: r ? r.attendance_id : '',
    status: r ? r.status : BELUM_ABSEN,
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
 * "Belum absen"), ditambah siapa pun yang punya data pada tanggal itu
 * (mis. guru yang kemudian dinonaktifkan/dihapus).
 */
function buildDayRows_(users, records) {
  const byUser = {};
  records.forEach(r => { byUser[r.user_id] = r; });
  const known = {};
  const rows = [];
  users.forEach(u => {
    known[u.user_id] = true;
    if (byUser[u.user_id] || (u.role === ROLES.GURU && u.status_akun === STATUS_AKUN.AKTIF)) {
      rows.push(adminDayRow_(u, byUser[u.user_id]));
    }
  });
  records.filter(r => !known[r.user_id]).forEach(r => {
    rows.push(adminDayRow_({ user_id: r.user_id, nama_guru: r.nama_guru, jenjang: '', status_akun: 'dihapus' }, r));
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
  const activeGurus = users.filter(u => u.role === ROLES.GURU && u.status_akun === STATUS_AKUN.AKTIF);

  const rows = buildDayRows_(users, findRowsBy_(SHEETS.ABSENSI, 'tanggal', tanggal));

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
    return adminDayRow_(user || { user_id: input.userId, nama_guru: nama, jenjang: '', status_akun: 'dihapus' }, saved);
  });
}

function apiAdminCorrectAttendance_(payload, ctx) {
  const now = nowWib_();
  return correctAttendance_(ctx.session.user, validateCorrection_(payload, now.tanggal), now);
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

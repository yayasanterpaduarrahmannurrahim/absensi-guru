/**
 * Attendance.gs — Absen masuk & absen pulang.
 *
 * Prinsip:
 * - Jam & tanggal selalu dari server (nowWib_), bukan dari HP guru.
 * - Lokasi selalu divalidasi ulang di server (Geo.gs) sebelum disimpan.
 * - attendance_id deterministik (tanggal + user_id) dan pemeriksaan "sudah absen?"
 *   dilakukan di dalam withLock_ yang sama dengan penulisan, sehingga absen ganda
 *   tidak mungkin terjadi walau tombol ditekan berkali-kali atau dari dua perangkat.
 * - Fungsi perform* menerima `now`, `school`, `schedule` sebagai parameter agar
 *   dapat diuji dengan waktu & lokasi buatan.
 */

/** Jadwal kerja dari SETTINGS. Nilai tidak valid diganti default. */
function getSchedule_() {
  const s = getSettings_();
  const hhmm = (v, def) => (/^\d{2}:\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : def);
  const hariKerja = String(s.hari_kerja || '1,2,3,4,5,6').split(',')
    .map(x => Number(x.trim()))
    .filter(n => n >= 1 && n <= 7);
  const acuan = String(s.sif_sabtu_acuan || '').trim();
  return {
    jamMasuk: hhmm(s.jam_masuk, '07:00'),
    batasTerlambat: hhmm(s.batas_terlambat, '07:15'),
    batasAbsenMasuk: hhmm(s.batas_absen_masuk, '12:00'),
    jamPulang: hhmm(s.jam_pulang, '14:00'),
    hariKerja: hariKerja,
    sifAcuan: /^\d{4}-\d{2}-\d{2}$/.test(acuan) ? acuan : '2026-10-31',
  };
}

/** Giliran sif ('A' / 'B') pada hari Sabtu `tanggal`, berselang-seling mulai dari Sabtu acuan (= Sif A). */
function saturdayShift_(tanggal, acuan) {
  const weeks = Math.round(daysBetween_(acuan, tanggal) / 7);
  return ((weeks % 2) + 2) % 2 === 0 ? SIF_SABTU.A : SIF_SABTU.B;
}

/**
 * Apakah guru DIJADWALKAN bekerja pada `tanggal` (hari kerja umum + sif Sabtu pribadinya).
 * Dipakai untuk penandaan Tanpa Keterangan, penerapan izin, rekap, dan laporan.
 * Absen tetap diizinkan pada hari kerja umum walau di luar jadwal sif (guru yang tetap masuk).
 */
function isScheduledFor_(user, tanggal, schedule) {
  const dow = dayOfWeek_(tanggal);
  if (schedule.hariKerja.indexOf(dow) < 0) return false;
  if (dow !== 6) return true;
  const sif = String((user && user.sif_sabtu) || '');
  if (sif === SIF_SABTU.LIBUR) return false;
  if (sif === SIF_SABTU.A || sif === SIF_SABTU.B) return saturdayShift_(tanggal, schedule.sifAcuan || '2026-10-31') === sif;
  return true;
}

function attendanceId_(tanggal, userId) {
  return 'ATT-' + String(tanggal).replace(/-/g, '') + '-' + userId;
}

/** Data absensi yang boleh dilihat pemiliknya. Kolom anomali sengaja tidak dikirim. */
function publicAttendance_(r) {
  return {
    attendanceId: r.attendance_id,
    tanggal: r.tanggal,
    jamMasuk: r.jam_masuk,
    jarakMasuk: r.jarak_masuk,
    jamPulang: r.jam_pulang,
    jarakPulang: r.jarak_pulang,
    status: r.status,
    keterangan: r.keterangan,
  };
}

/**
 * Menilai lokasi untuk absensi. Bila tidak valid, percobaan dicatat di AUDIT_LOG
 * (berguna untuk menelusuri kecurangan) lalu ditolak.
 */
function validateAttendanceLocation_(user, input, school, now, jenis) {
  const result = analyzeLocation_(input, school);
  if (!result.valid) {
    logAudit_(user.user_id, 'ABSEN_DITOLAK', {
      jenis: jenis,
      tanggal: now.tanggal,
      jam: now.jam,
      jarak: result.distance,
      akurasi: result.accuracy,
      alasan: result.message,
      anomali: result.anomalies,
    });
    throw new AppError('LOCATION_INVALID', result.message);
  }
  return result;
}

/** Koordinat yang persis sama dengan absensi sebelumnya hampir mustahil pada GPS asli. */
function previousCoordinateAnomaly_(userId, lat, lng) {
  const same = findRowsBy_(SHEETS.ABSENSI, 'user_id', userId).some(r =>
    (r.latitude_masuk === lat && r.longitude_masuk === lng) ||
    (r.latitude_pulang === lat && r.longitude_pulang === lng));
  return same ? ['Koordinat persis sama dengan absensi sebelumnya'] : [];
}

/**
 * Penanda anti-ganda di CacheService (selalu dibaca langsung dari server, tidak di-cache
 * per eksekusi seperti nilai sel Spreadsheet). Dipasang di dalam lock setelah absen tersimpan.
 * jenis: 'in' | 'out'. Berlaku 6 jam (batas CacheService).
 */
function attendanceMarkerKey_(attendanceId, jenis) {
  return 'att_' + jenis + '_' + attendanceId;
}

function setAttendanceMarker_(attendanceId, jenis, jam) {
  CacheService.getScriptCache().put(attendanceMarkerKey_(attendanceId, jenis), jam || '1', 21600);
}

function clearAttendanceMarkers_(attendanceId) {
  CacheService.getScriptCache().removeAll([attendanceMarkerKey_(attendanceId, 'in'), attendanceMarkerKey_(attendanceId, 'out')]);
}

function formatAnomali_(label, list) {
  return list.length ? label + ': ' + list.join('; ') : '';
}

/** Absen masuk. Mengembalikan publicAttendance_. */
function performCheckIn_(user, input, now, school, schedule) {
  if (schedule.hariKerja.indexOf(now.hari) < 0) {
    throw new AppError('NOT_WORKDAY', 'Hari ini bukan hari kerja.');
  }
  const hm = now.jam.slice(0, 5);
  if (hm > schedule.batasAbsenMasuk) {
    throw new AppError('CHECKIN_CLOSED', 'Absen masuk sudah ditutup pukul ' + schedule.batasAbsenMasuk + ' WIB.');
  }
  const loc = validateAttendanceLocation_(user, input, school, now, 'masuk');
  // Dibaca di luar lock agar antrean guru lain tidak tertahan oleh pembacaan riwayat.
  const anomalies = loc.anomalies.concat(previousCoordinateAnomaly_(user.user_id, input.lat, input.lng));

  return withLock_(() => {
    const id = attendanceId_(now.tanggal, user.user_id);
    const marker = CacheService.getScriptCache().get(attendanceMarkerKey_(id, 'in'));
    if (marker) {
      throw new AppError('ALREADY_CHECKED_IN', 'Anda sudah absen masuk hari ini pukul ' + marker + ' WIB.');
    }
    const existing = findByKey_(SHEETS.ABSENSI, id);
    if (existing) {
      if (existing.jam_masuk) {
        throw new AppError('ALREADY_CHECKED_IN', 'Anda sudah absen masuk hari ini pukul ' + existing.jam_masuk + ' WIB.');
      }
      throw new AppError('HAS_STATUS', 'Anda sudah tercatat ' + existing.status + ' hari ini.');
    }
    const rec = insertRow_(SHEETS.ABSENSI, {
      attendance_id: id,
      user_id: user.user_id,
      nama_guru: user.nama_guru,
      tanggal: now.tanggal,
      jam_masuk: now.jam,
      latitude_masuk: input.lat,
      longitude_masuk: input.lng,
      accuracy_masuk: loc.accuracy,
      jarak_masuk: loc.distance,
      status: hm > schedule.batasTerlambat ? STATUS_HADIR.TERLAMBAT : STATUS_HADIR.HADIR,
      keterangan: isScheduledFor_(user, now.tanggal, schedule) ? '' : 'Masuk di luar jadwal sif Sabtu',
      anomali: formatAnomali_('Masuk', anomalies),
      created_at: now.waktu,
      updated_at: now.waktu,
    });
    setAttendanceMarker_(id, 'in', now.jam);
    return publicAttendance_(rec);
  });
}

/** Absen pulang. Mengembalikan publicAttendance_. */
function performCheckOut_(user, input, now, school, schedule) {
  const id = attendanceId_(now.tanggal, user.user_id);
  const assertCanCheckOut = rec => {
    if (!rec || !rec.jam_masuk) throw new AppError('NOT_CHECKED_IN', 'Anda belum absen masuk hari ini.');
    if (rec.jam_pulang) {
      throw new AppError('ALREADY_CHECKED_OUT', 'Anda sudah absen pulang hari ini pukul ' + rec.jam_pulang + ' WIB.');
    }
  };

  // Pemeriksaan awal (tanpa lock) agar pesan kesalahan cepat dan jelas.
  assertCanCheckOut(findByKey_(SHEETS.ABSENSI, id));
  if (now.jam.slice(0, 5) < schedule.jamPulang) {
    throw new AppError('TOO_EARLY', 'Absen pulang baru dapat dilakukan mulai pukul ' + schedule.jamPulang + ' WIB.');
  }
  const loc = validateAttendanceLocation_(user, input, school, now, 'pulang');
  const pulang = formatAnomali_('Pulang', loc.anomalies.concat(previousCoordinateAnomaly_(user.user_id, input.lat, input.lng)));

  return withLock_(() => {
    const marker = CacheService.getScriptCache().get(attendanceMarkerKey_(id, 'out'));
    if (marker) {
      throw new AppError('ALREADY_CHECKED_OUT', 'Anda sudah absen pulang hari ini pukul ' + marker + ' WIB.');
    }
    const current = findByKey_(SHEETS.ABSENSI, id);
    assertCanCheckOut(current); // diperiksa ulang di dalam lock
    const updated = updateByKey_(SHEETS.ABSENSI, id, {
      jam_pulang: now.jam,
      latitude_pulang: input.lat,
      longitude_pulang: input.lng,
      accuracy_pulang: loc.accuracy,
      jarak_pulang: loc.distance,
      anomali: [current.anomali, pulang].filter(String).join(' | '),
      updated_at: now.waktu,
    });
    setAttendanceMarker_(id, 'out', now.jam);
    return publicAttendance_(updated);
  });
}

/** Validasi pengaturan jam kerja dari admin. Mengembalikan nilai siap simpan ke SETTINGS. */
function validateScheduleInput_(p) {
  const time = (v, label) => vString_(v, label, {
    required: true,
    pattern: /^([01]\d|2[0-3]):[0-5]\d$/,
    patternMessage: label + ' harus berformat JJ:MM, contoh 07:00.',
  });
  const jamMasuk = time(p.jamMasuk, 'Jam masuk');
  const batasTerlambat = time(p.batasTerlambat, 'Batas terlambat');
  const batasAbsenMasuk = time(p.batasAbsenMasuk, 'Batas absen masuk');
  const jamPulang = time(p.jamPulang, 'Jam pulang');
  if (batasTerlambat < jamMasuk) {
    throw new AppError('VALIDATION', 'Batas terlambat tidak boleh lebih awal dari jam masuk.');
  }
  if (batasAbsenMasuk < batasTerlambat) {
    throw new AppError('VALIDATION', 'Batas absen masuk tidak boleh lebih awal dari batas terlambat.');
  }
  let sifAcuan = '';
  if (p.sifAcuan) {
    sifAcuan = parseIsoDate_(p.sifAcuan, 'Sabtu acuan Sif A');
    if (dayOfWeek_(sifAcuan) !== 6) throw new AppError('VALIDATION', 'Tanggal acuan Sif A harus hari Sabtu.');
  }
  if (!Array.isArray(p.hariKerja)) throw new AppError('VALIDATION', 'Hari kerja wajib dipilih.');
  const hari = p.hariKerja.map(h => vNumber_(h, 'Hari kerja', 1, 7))
    .filter((h, i, arr) => Number.isInteger(h) && arr.indexOf(h) === i)
    .sort((a, b) => a - b);
  if (!hari.length) throw new AppError('VALIDATION', 'Pilih minimal satu hari kerja.');
  const values = {
    jam_masuk: jamMasuk,
    batas_terlambat: batasTerlambat,
    batas_absen_masuk: batasAbsenMasuk,
    jam_pulang: jamPulang,
    hari_kerja: hari.join(','),
  };
  if (sifAcuan) values.sif_sabtu_acuan = sifAcuan;
  return values;
}

/* ---------- Handler API ---------- */

function apiAdminGetSchedule_() {
  const s = getSchedule_();
  const today = nowWib_().tanggal;
  // Sabtu terdekat (hari ini bila Sabtu) beserta gilirannya, untuk ditampilkan di pengaturan.
  const nextSat = addDays_(today, (6 - dayOfWeek_(today) + 7) % 7);
  return Object.assign({}, s, { sabtuBerikut: nextSat, giliranSabtuBerikut: saturdayShift_(nextSat, s.sifAcuan) });
}

function apiAdminUpdateSchedule_(payload, ctx) {
  const values = validateScheduleInput_(payload);
  const before = setSettings_(values);
  logAudit_(ctx.session.user.user_id, 'UBAH_JAM_KERJA', { sebelum: before, sesudah: values });
  return apiAdminGetSchedule_();
}

/** Status absensi hari ini milik pengguna yang login + jadwal + waktu server. */
function apiGetToday_(payload, ctx) {
  const now = nowWib_();
  const schedule = getSchedule_();
  const rec = findByKey_(SHEETS.ABSENSI, attendanceId_(now.tanggal, ctx.session.user.user_id));
  const isWorkday = schedule.hariKerja.indexOf(now.hari) >= 0;
  return {
    serverNow: now.date.getTime(),
    tanggal: now.tanggal,
    isWorkday: isWorkday,
    // Hari kerja umum tetapi bukan giliran sif guru ini: tidak wajib, tetap boleh absen.
    liburSif: isWorkday && !isScheduledFor_(ctx.session.user, now.tanggal, schedule),
    schedule: {
      jamMasuk: schedule.jamMasuk,
      batasTerlambat: schedule.batasTerlambat,
      batasAbsenMasuk: schedule.batasAbsenMasuk,
      jamPulang: schedule.jamPulang,
    },
    record: rec ? publicAttendance_(rec) : null,
  };
}

function apiCheckIn_(payload, ctx) {
  return performCheckIn_(ctx.session.user, readLocationInput_(payload), nowWib_(), getSchoolLocation_(), getSchedule_());
}

function apiCheckOut_(payload, ctx) {
  return performCheckOut_(ctx.session.user, readLocationInput_(payload), nowWib_(), getSchoolLocation_(), getSchedule_());
}

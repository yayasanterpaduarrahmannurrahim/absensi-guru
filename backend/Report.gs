/**
 * Report.gs — Laporan absensi per periode (harian, mingguan, bulanan, atau rentang bebas).
 * Data mentah dikirim ke frontend; berkas Excel/CSV dibuat di browser admin.
 */

function validateReportRange_(p, today) {
  const mulai = parseIsoDate_(p.mulai, 'Tanggal mulai');
  const selesai = parseIsoDate_(p.selesai, 'Tanggal selesai');
  if (selesai < mulai) throw new AppError('VALIDATION', 'Tanggal selesai tidak boleh sebelum tanggal mulai.');
  if (daysBetween_(mulai, selesai) > 92) throw new AppError('VALIDATION', 'Rentang laporan maksimal 3 bulan.');
  if (mulai > today) throw new AppError('VALIDATION', 'Tanggal mulai tidak boleh setelah hari ini.');
  return { mulai: mulai, selesai: selesai, jenjang: vEnum_(p.jenjang, 'Jenjang', [JENJANG.TK, JENJANG.SD], {}) };
}

/**
 * Menyusun laporan. Hari kerja dihitung sampai hari ini (hari yang belum terjadi tidak dihitung).
 * Hari kerja tiap guru mengikuti jadwalnya (sif Sabtu); bila ia tetap masuk di luar jadwal,
 * hari itu ikut dihitung sebagai hari kerja & hadir (persentase tidak melebihi 100%).
 * "Tanpa data" = hari kerja terjadwal tanpa catatan apa pun (mis. sebelum penandaan otomatis aktif).
 * `scheduleOrHariKerja`: objek jadwal (getSchedule_) atau array hari kerja.
 */
function buildReport_(users, records, range, scheduleOrHariKerja, today) {
  const schedule = Array.isArray(scheduleOrHariKerja)
    ? { hariKerja: scheduleOrHariKerja, sifAcuan: '' }
    : scheduleOrHariKerja;
  const hariKerja = schedule.hariKerja;
  const end = range.selesai < today ? range.selesai : today;
  const workdays = [];
  for (let t = range.mulai; t <= end; t = addDays_(t, 1)) {
    if (hariKerja.indexOf(dayOfWeek_(t)) >= 0) workdays.push(t);
  }
  const workdaySet = {};
  workdays.forEach(t => { workdaySet[t] = true; });

  const inRange = records.filter(r => r.tanggal >= range.mulai && r.tanggal <= range.selesai);
  const byUser = {};
  inRange.forEach(r => { (byUser[r.user_id] = byUser[r.user_id] || []).push(r); });

  const known = {};
  const people = [];
  users.forEach(u => {
    known[u.user_id] = true;
    if ((hasRole_(u, ROLES.GURU) && u.status_akun === STATUS_AKUN.AKTIF) || byUser[u.user_id]) people.push(u);
  });
  Object.keys(byUser).filter(id => !known[id]).forEach(id => {
    people.push({ user_id: id, nama_guru: byUser[id][0].nama_guru, jenjang: '', created_at: '' });
  });
  const selected = people.filter(u => !range.jenjang || u.jenjang === range.jenjang);
  const selectedIds = {};
  selected.forEach(u => { selectedIds[u.user_id] = u; });

  const perGuru = selected.map(u => {
    const rs = byUser[u.user_id] || [];
    const c = countStatuses_(rs);
    const since = String(u.created_at || '').slice(0, 10);
    const scheduled = workdays.filter(t => (!since || t >= since) && isScheduledFor_(u, t, schedule));
    const scheduledSet = {};
    scheduled.forEach(t => { scheduledSet[t] = true; });
    // Hari di luar jadwal sif tetapi guru tetap hadir → dihitung sebagai hari kerja.
    const extra = rs.filter(r => workdaySet[r.tanggal] && !scheduledSet[r.tanggal] &&
      (r.status === STATUS_HADIR.HADIR || r.status === STATUS_HADIR.TERLAMBAT)).map(r => r.tanggal);
    const eligible = scheduled.concat(extra);
    const recordedWorkdays = rs.filter(r => scheduledSet[r.tanggal]).length;
    const hadir = c['Hadir'] + c['Terlambat'];
    return {
      userId: u.user_id,
      nama: u.nama_guru,
      jenjang: u.jenjang || '',
      hariKerja: eligible.length,
      diLuarSif: extra.length,
      hadir: c['Hadir'],
      terlambat: c['Terlambat'],
      izin: c['Izin'],
      sakit: c['Sakit'],
      alpa: c['Tanpa Keterangan'],
      tanpaData: Math.max(0, scheduled.length - recordedWorkdays),
      persenHadir: eligible.length ? Math.round((hadir / eligible.length) * 1000) / 10 : 0,
    };
  }).sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));

  const details = inRange
    .filter(r => selectedIds[r.user_id])
    .map(r => ({
      tanggal: r.tanggal,
      nama: r.nama_guru,
      jenjang: selectedIds[r.user_id].jenjang || '',
      jamMasuk: r.jam_masuk,
      jamPulang: r.jam_pulang,
      status: r.status,
      jarakMasuk: r.jarak_masuk,
      jarakPulang: r.jarak_pulang,
      keterangan: r.keterangan,
    }))
    .sort((a, b) => a.tanggal === b.tanggal ? String(a.nama).localeCompare(String(b.nama), 'id') : (a.tanggal < b.tanggal ? -1 : 1));

  const sum = k => perGuru.reduce((a, g) => a + g[k], 0);
  return {
    mulai: range.mulai,
    selesai: range.selesai,
    jenjang: range.jenjang,
    hariKerja: workdays.length,
    totals: { guru: perGuru.length, hadir: sum('hadir'), terlambat: sum('terlambat'), izin: sum('izin'), sakit: sum('sakit'), alpa: sum('alpa'), tanpaData: sum('tanpaData') },
    perGuru: perGuru,
    details: details,
  };
}

function apiAdminReport_(payload) {
  const now = nowWib_();
  const range = validateReportRange_(payload, now.tanggal);
  return buildReport_(readAll_(SHEETS.USERS), readAll_(SHEETS.ABSENSI), range, getSchedule_(), now.tanggal);
}

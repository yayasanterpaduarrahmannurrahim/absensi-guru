/**
 * Tests.gs — Pengujian otomatis per tahap. Jalankan dari editor Apps Script.
 * Pengujian tidak mengubah data produksi: uji tulis memakai sheet sementara
 * yang dihapus kembali di akhir.
 */

function runTahap1Tests() {
  const results = [];
  const test = (name, fn) => {
    try {
      fn();
      results.push(['LULUS', name, '']);
    } catch (err) {
      results.push(['GAGAL', name, err && err.message ? err.message : String(err)]);
    }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const assertEq = (actual, expected, label) => {
    if (actual !== expected) {
      throw new Error(label + ': diharapkan ' + JSON.stringify(expected) + ', didapat ' + JSON.stringify(actual));
    }
  };

  resetDbCache_();

  test('SPREADSHEET_ID tersimpan di Script Properties dan dapat dibuka', () => {
    const id = PropertiesService.getScriptProperties().getProperty(APP.PROP_SPREADSHEET_ID);
    assert(id, 'SPREADSHEET_ID kosong — jalankan setup()');
    assert(getSpreadsheet_().getId() === id, 'ID spreadsheet tidak cocok');
  });

  test('Semua sheet ada dengan header lengkap', () => {
    Object.keys(SCHEMA).forEach(name => {
      const headers = getHeaders_(name);
      SCHEMA[name].columns.forEach(c => assert(headers.indexOf(c) >= 0, name + ' tidak memiliki kolom ' + c));
    });
  });

  test('Zona waktu spreadsheet Asia/Jakarta', () => {
    assertEq(getSpreadsheet_().getSpreadsheetTimeZone(), APP.TIMEZONE, 'timezone');
  });

  test('Seluruh pengaturan default tersedia', () => {
    invalidateSettingsCache_();
    const s = getSettings_();
    DEFAULT_SETTINGS.forEach(([key]) => assert(key in s, 'Pengaturan ' + key + ' tidak ada'));
    assertEq(getSettingNumber_('radius_meter') > 0, true, 'radius_meter valid');
  });

  test('Minimal satu admin aktif', () => {
    const admins = readAll_(SHEETS.USERS)
      .filter(u => u.role === ROLES.ADMIN && u.status_akun === STATUS_AKUN.AKTIF);
    assert(admins.length >= 1, 'Belum ada admin aktif');
  });

  test('Waktu server WIB terformat benar', () => {
    const t = nowWib_();
    assert(/^\d{4}-\d{2}-\d{2}$/.test(t.tanggal), 'format tanggal');
    assert(/^\d{2}:\d{2}:\d{2}$/.test(t.jam), 'format jam');
    assert(t.hari >= 1 && t.hari <= 7, 'hari 1-7');
    assertEq(t.tanggal, Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd'), 'tanggal WIB');
  });

  test('ID unik dan hash SHA-256', () => {
    const a = generateId_('T'), b = generateId_('T');
    assert(a !== b && /^T-[0-9A-F]{12}$/.test(a), 'format/keunikan ID');
    assertEq(sha256Hex_('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256');
  });

  test('withLock_ reentrant dan mengembalikan nilai', () => {
    assertEq(withLock_(() => withLock_(() => 42)), 42, 'nilai lock bersarang');
  });

  test('CRUD sheet: tanggal/jam tetap teks, angka presisi, anti formula injection', () => {
    const name = '_TEST_TAHAP1';
    const ss = getSpreadsheet_();
    SCHEMA[name] = {
      key: 'id',
      columns: ['id', 'tanggal', 'jam', 'teks', 'lat'],
      formats: { lat: '0.0000000' },
    };
    try {
      const old = ss.getSheetByName(name);
      if (old) ss.deleteSheet(old);
      ensureSheet_(ss, name, SCHEMA[name]);
      resetDbCache_();

      insertRow_(name, { id: 'T-1', tanggal: '2026-10-31', jam: '07:05:00', teks: '=1+1', lat: -6.2088123 });
      insertRow_(name, { id: 'T-2', tanggal: '2026-11-01', jam: '14:00:00', teks: '-6.2', lat: 106.8456 });

      const r1 = findByKey_(name, 'T-1');
      assert(r1, 'T-1 tidak ditemukan');
      assertEq(r1.tanggal, '2026-10-31', 'tanggal');
      assertEq(r1.jam, '07:05:00', 'jam');
      assertEq(r1.teks, '=1+1', 'teks berawalan =');
      assertEq(r1.lat, -6.2088123, 'latitude');
      assertEq(findByKey_(name, 'T-2').teks, '-6.2', 'teks berawalan -');

      updateByKey_(name, 'T-1', { jam: '07:30:00', id: 'DIUBAH' });
      const r1b = findByKey_(name, 'T-1');
      assertEq(r1b.jam, '07:30:00', 'update jam');
      assertEq(r1b.tanggal, '2026-10-31', 'kolom lain tetap');
      assertEq(readAll_(name).length, 2, 'jumlah baris setelah update');

      deleteByKey_(name, 'T-1');
      assertEq(findByKey_(name, 'T-1'), null, 'T-1 terhapus');
      assertEq(readAll_(name).length, 1, 'jumlah baris setelah hapus');

      let notFound = false;
      try { updateByKey_(name, 'TIDAK-ADA', {}); } catch (e) { notFound = e.code === 'NOT_FOUND'; }
      assert(notFound, 'update key tidak ada harus NOT_FOUND');
    } finally {
      delete SCHEMA[name];
      const sh = ss.getSheetByName(name);
      if (sh) ss.deleteSheet(sh);
      resetDbCache_();
    }
  });

  test('Router: ping, aksi tak dikenal, prototype, GET dibatasi', () => {
    const ping = dispatch_({ action: 'ping' }, 'POST');
    assert(ping.ok && ping.data.timezone === APP.TIMEZONE, 'ping gagal');
    assertEq(dispatch_({ action: 'tidakAda' }, 'POST').error.code, 'UNKNOWN_ACTION', 'aksi tak dikenal');
    assertEq(dispatch_({ action: 'toString' }, 'POST').error.code, 'UNKNOWN_ACTION', 'akses prototype');
    assertEq(dispatch_(null, 'POST').error.code, 'BAD_REQUEST', 'request null');
    const cfg = dispatch_({ action: 'getPublicConfig' }, 'GET');
    assert(cfg.ok && !('school_latitude' in cfg.data) && !('schoolLatitude' in cfg.data),
      'config publik tidak boleh berisi koordinat');
  });

  test('doPost menolak body tidak valid', () => {
    const out = JSON.parse(doPost({ postData: { contents: '{bukan json' } }).getContent());
    assertEq(out.error.code, 'BAD_REQUEST', 'body rusak');
  });

  const failed = results.filter(r => r[0] === 'GAGAL');
  results.forEach(r => console.log('[' + r[0] + '] ' + r[1] + (r[2] ? ' — ' + r[2] : '')));
  console.log('Hasil: ' + (results.length - failed.length) + '/' + results.length + ' lulus.');
  if (failed.length) throw new Error(failed.length + ' pengujian gagal. Lihat log di atas.');
}

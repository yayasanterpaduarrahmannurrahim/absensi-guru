/**
 * Tests.gs — Pengujian otomatis per tahap. Jalankan dari editor Apps Script.
 * Data uji (sheet sementara, pengguna uji berawalan "uji.tahap") dihapus kembali
 * di akhir. Jejaknya tetap tercatat di AUDIT_LOG dengan user_id 'TEST'.
 */

/** Pembantu pengujian: mencatat hasil tiap kasus lalu melaporkan ringkasan. */
function createTestRunner_() {
  const results = [];
  const t = {
    test(name, fn) {
      try {
        fn();
        results.push(['LULUS', name, '']);
      } catch (err) {
        results.push(['GAGAL', name, err && err.message ? err.message : String(err)]);
      }
    },
    assert(cond, msg) { if (!cond) throw new Error(msg); },
    assertEq(actual, expected, label) {
      if (actual !== expected) {
        throw new Error(label + ': diharapkan ' + JSON.stringify(expected) + ', didapat ' + JSON.stringify(actual));
      }
    },
    /** Memastikan fn melempar AppError dengan kode tertentu. */
    expectError(code, fn, label) {
      try {
        fn();
      } catch (err) {
        if (err.code === code) return;
        throw new Error(label + ': diharapkan error ' + code + ', didapat ' + (err.code || err.message));
      }
      throw new Error(label + ': diharapkan error ' + code + ', tetapi berhasil');
    },
    finish() {
      const failed = results.filter(r => r[0] === 'GAGAL');
      results.forEach(r => console.log('[' + r[0] + '] ' + r[1] + (r[2] ? ' — ' + r[2] : '')));
      console.log('Hasil: ' + (results.length - failed.length) + '/' + results.length + ' lulus.');
      if (failed.length) throw new Error(failed.length + ' pengujian gagal. Lihat log di atas.');
    },
  };
  return t;
}

function runTahap1Tests() {
  const { test, assert, assertEq, finish } = createTestRunner_();

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

  finish();
}

/**
 * Tahap 2: login Google, sesi, hak akses, dan manajemen pengguna.
 * Menjalankan fungsi ini pertama kali juga memunculkan permintaan izin
 * "terhubung ke layanan eksternal" yang dibutuhkan untuk verifikasi token Google.
 */
function runTahap2Tests() {
  const { test, assert, assertEq, expectError, finish } = createTestRunner_();
  resetDbCache_();

  const testCtx = { session: { user: { user_id: 'TEST' } } };
  const suffix = Utilities.getUuid().slice(0, 8);
  const guruEmail = 'uji.tahap2.' + suffix + '@example.invalid';
  const realAdmin = readAll_(SHEETS.USERS)
    .find(u => u.role === ROLES.ADMIN && u.status_akun === STATUS_AKUN.AKTIF);
  let guru = null;

  try {
    test('Token Google palsu ditolak (lokal & oleh server Google)', () => {
      expectError('INVALID_GOOGLE_TOKEN', () => verifyGoogleIdToken_('pendek'), 'token pendek');
      expectError('INVALID_GOOGLE_TOKEN', () => verifyGoogleIdToken_(null), 'token null');
      const fake = 'a'.repeat(60) + '.' + 'b'.repeat(60) + '.' + 'c'.repeat(40);
      expectError('INVALID_GOOGLE_TOKEN', () => verifyGoogleIdToken_(fake), 'token palsu ke tokeninfo');
      const viaApi = dispatch_({ action: 'loginGoogle', payload: { credential: fake } }, 'POST');
      assertEq(viaApi.error && viaApi.error.code, 'INVALID_GOOGLE_TOKEN', 'loginGoogle via router');
    });

    test('Validasi input pengguna', () => {
      const base = { nama: 'Guru Uji', email: guruEmail, role: 'guru', jenjang: 'SD', nip: '' };
      expectError('VALIDATION', () => apiAdminCreateUser_(Object.assign({}, base, { email: 'bukan-email' }), testCtx), 'email salah');
      expectError('VALIDATION', () => apiAdminCreateUser_(Object.assign({}, base, { jenjang: '' }), testCtx), 'guru tanpa jenjang');
      expectError('VALIDATION', () => apiAdminCreateUser_(Object.assign({}, base, { jenjang: 'SMP' }), testCtx), 'jenjang tidak dikenal');
      expectError('VALIDATION', () => apiAdminCreateUser_(Object.assign({}, base, { role: 'superadmin' }), testCtx), 'peran tidak dikenal');
      expectError('VALIDATION', () => apiAdminCreateUser_(Object.assign({}, base, { nama: 'A' }), testCtx), 'nama terlalu pendek');
      expectError('VALIDATION', () => apiAdminCreateUser_(Object.assign({}, base, { nip: '=HYPERLINK()' }), testCtx), 'NIP berisi rumus');
    });

    test('Admin menambah guru; email ganda ditolak; email disimpan huruf kecil', () => {
      guru = apiAdminCreateUser_({ nama: 'Guru Uji', email: guruEmail.toUpperCase(), role: 'guru', jenjang: 'SD', nip: '1987 01' }, testCtx);
      assertEq(guru.email, guruEmail, 'email lowercase');
      assertEq(guru.statusAkun, STATUS_AKUN.AKTIF, 'status awal');
      expectError('DUPLICATE', () => apiAdminCreateUser_({ nama: 'Lain', email: guruEmail, role: 'guru', jenjang: 'TK' }, testCtx), 'email ganda');
      assert(apiAdminListUsers_().some(u => u.userId === guru.userId), 'guru muncul di daftar');
    });

    test('Email tidak terdaftar ditolak saat login', () => {
      expectError('NOT_REGISTERED', () => createSessionForEmail_('tidak.ada.' + suffix + '@example.invalid'), 'tidak terdaftar');
    });

    test('Sesi guru: akses data sendiri ya, fitur admin tidak', () => {
      const s = createSessionForEmail_(guruEmail);
      assert(/^[a-f0-9]{64}$/.test(s.token), 'format token');
      assert(!findByKey_(SHEETS.SESSIONS, s.token), 'token mentah tidak boleh tersimpan');
      assert(findByKey_(SHEETS.SESSIONS, sha256Hex_(s.token)), 'hash token tersimpan');
      assertEq(requireSession_(s.token, 'user').user.user_id, guru.userId, 'requireSession user');
      expectError('FORBIDDEN', () => requireSession_(s.token, 'admin'), 'guru akses admin');

      const me = dispatch_({ action: 'me', token: s.token }, 'POST');
      assert(me.ok && me.data.user.email === guruEmail, 'aksi me');
      assertEq(dispatch_({ action: 'adminListUsers', token: s.token }, 'POST').error.code, 'FORBIDDEN', 'adminListUsers oleh guru');
      assertEq(dispatch_({ action: 'me', token: 'f'.repeat(64) }, 'POST').error.code, 'SESSION_INVALID', 'token asal');
      assertEq(dispatch_({ action: 'me' }, 'POST').error.code, 'SESSION_INVALID', 'tanpa token');
      assertEq(dispatch_({ action: 'me', token: s.token }, 'GET').error.code, 'METHOD_NOT_ALLOWED', 'GET dibatasi');
    });

    test('Sesi kedaluwarsa ditolak', () => {
      const s = createSessionForEmail_(guruEmail);
      const hash = sha256Hex_(s.token);
      updateByKey_(SHEETS.SESSIONS, hash, { expires_at: String(Date.now() - 1000) });
      removeSessionCache_(hash);
      expectError('SESSION_INVALID', () => requireSession_(s.token, 'user'), 'sesi kedaluwarsa');
    });

    test('Logout mengakhiri sesi', () => {
      const s = createSessionForEmail_(guruEmail);
      assert(dispatch_({ action: 'logout', token: s.token }, 'POST').ok, 'logout');
      expectError('SESSION_INVALID', () => requireSession_(s.token, 'user'), 'setelah logout');
    });

    test('Menonaktifkan guru memutus sesi dan menolak login', () => {
      const s = createSessionForEmail_(guruEmail);
      apiAdminUpdateUser_({ userId: guru.userId, nama: 'Guru Uji', email: guruEmail, role: 'guru', jenjang: 'SD', statusAkun: 'nonaktif' }, testCtx);
      expectError('SESSION_INVALID', () => requireSession_(s.token, 'user'), 'sesi setelah nonaktif');
      expectError('ACCOUNT_DISABLED', () => createSessionForEmail_(guruEmail), 'login setelah nonaktif');
      const re = apiAdminUpdateUser_({ userId: guru.userId, nama: 'Guru Uji Diubah', email: guruEmail, role: 'guru', jenjang: 'TK', statusAkun: 'aktif' }, testCtx);
      assertEq(re.nama, 'Guru Uji Diubah', 'nama diubah');
      assertEq(re.jenjang, 'TK', 'jenjang diubah');
    });

    test('Admin tidak bisa menonaktifkan/menghapus diri sendiri', () => {
      assert(realAdmin, 'admin aktif tidak ditemukan');
      const selfCtx = { session: { user: realAdmin } };
      expectError('FORBIDDEN_SELF', () => apiAdminUpdateUser_({
        userId: realAdmin.user_id, nama: realAdmin.nama_guru, email: realAdmin.email,
        role: 'guru', jenjang: 'SD', statusAkun: 'aktif',
      }, selfCtx), 'cabut admin sendiri');
      expectError('FORBIDDEN_SELF', () => apiAdminDeleteUser_({ userId: realAdmin.user_id }, selfCtx), 'hapus diri sendiri');
      assertEq(findByKey_(SHEETS.USERS, realAdmin.user_id).role, ROLES.ADMIN, 'admin tetap admin');
    });

    test('Menghapus guru juga menghapus sesinya', () => {
      const s = createSessionForEmail_(guruEmail);
      apiAdminDeleteUser_({ userId: guru.userId }, testCtx);
      assertEq(findByKey_(SHEETS.USERS, guru.userId), null, 'guru terhapus');
      expectError('SESSION_INVALID', () => requireSession_(s.token, 'user'), 'sesi guru terhapus');
      assert(!readAll_(SHEETS.SESSIONS).some(r => r.user_id === guru.userId), 'tidak ada sisa sesi');
      guru = null;
    });
  } finally {
    // Bersihkan sisa data uji bila ada kasus yang gagal di tengah jalan.
    const leftovers = deleteRowsWhere_(SHEETS.USERS, u => String(u.email).indexOf('uji.tahap2.') === 0);
    leftovers.forEach(u => deleteSessionsForUser_(u.user_id));
  }

  finish();
}

/** Tahap 3: perhitungan jarak, validasi radius & akurasi, deteksi anomali, pengaturan lokasi. */
function runTahap3Tests() {
  const { test, assert, assertEq, expectError, finish } = createTestRunner_();
  resetDbCache_();

  // Titik sekolah fiktif khusus pengujian (tidak disimpan).
  const school = { lat: -6.2088123, lng: 106.8456789, radius: 50, maxAccuracy: 30 };
  const north = meters => school.lat + meters / 111195.08; // geser ke utara sejauh N meter
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const sample = (lat, lng, accuracy, t) => ({ lat: lat, lng: lng, accuracy: accuracy, t: t });

  test('Haversine: 0.00045° lintang ≈ 50,04 m; Monas–Bundaran HI ≈ 2,22 km', () => {
    assert(near(haversineMeters_(0, 0, 0.00045, 0), 50.04, 0.05), 'jarak 0.00045°');
    assertEq(haversineMeters_(school.lat, school.lng, school.lat, school.lng), 0, 'titik sama');
    const monasHi = haversineMeters_(-6.1753924, 106.8271528, -6.1949389, 106.8230356);
    assert(near(monasHi, 2221, 30), 'Monas–Bundaran HI: ' + Math.round(monasHi));
  });

  test('Di dalam radius & akurasi baik = valid', () => {
    const r = analyzeLocation_({ lat: north(30), lng: school.lng, accuracy: 12.3456, samples: [] }, school);
    assert(r.valid && r.withinRadius && r.accuracyOk, 'harus valid');
    assert(near(r.distance, 30, 0.2), 'jarak ±30 m, didapat ' + r.distance);
    assertEq(r.accuracy, 12.3, 'akurasi dibulatkan');
  });

  test('Batas radius: 49,5 m valid, 50,5 m ditolak', () => {
    assert(analyzeLocation_({ lat: north(49.5), lng: school.lng, accuracy: 10.5, samples: [] }, school).valid, '49,5 m');
    const out = analyzeLocation_({ lat: north(50.5), lng: school.lng, accuracy: 10.5, samples: [] }, school);
    assert(!out.valid && !out.withinRadius && out.accuracyOk, '50,5 m harus ditolak');
    assert(out.message.indexOf('radius 50 m') >= 0, 'pesan menyebut radius');
  });

  test('Akurasi lebih dari 30 m ditolak walau di dalam radius', () => {
    const r = analyzeLocation_({ lat: north(5), lng: school.lng, accuracy: 35.2, samples: [] }, school);
    assert(!r.valid && !r.accuracyOk && r.withinRadius, 'akurasi buruk harus ditolak');
    assert(r.message.indexOf('Akurasi GPS') === 0, 'pesan akurasi');
  });

  test('Input lokasi tidak valid ditolak', () => {
    expectError('VALIDATION', () => readLocationInput_({ latitude: 100, longitude: 106, accuracy: 10 }), 'lat > 90');
    expectError('VALIDATION', () => readLocationInput_({ latitude: -6.2, longitude: 'abc', accuracy: 10 }), 'lng bukan angka');
    expectError('VALIDATION', () => readLocationInput_({ latitude: -6.2, longitude: 106.8 }), 'akurasi kosong');
    expectError('VALIDATION', () => readLocationInput_({ latitude: true, longitude: 106.8, accuracy: 5 }), 'boolean');
    expectError('VALIDATION', () => readLocationInput_({ latitude: -6.2, longitude: 106.8, accuracy: 5, samples: [{ lat: 'x' }] }), 'sampel rusak');
    assertEq(readLocationInput_({ latitude: -6.2, longitude: 106.8, accuracy: 5, samples: new Array(25).fill(sample(-6.2, 106.8, 5, 0)) }).samples.length, 10, 'maksimal 10 sampel');
  });

  test('Lokasi wajar tidak ditandai anomali', () => {
    const lat = north(20), lng = school.lng;
    const samples = [sample(lat + 0.00002, lng - 0.00001, 14.2, 0), sample(lat - 0.00001, lng + 0.00002, 11.8, 1500), sample(lat, lng, 9.6, 3100)];
    const r = analyzeLocation_({ lat: lat, lng: lng, accuracy: 9.6, samples: samples }, school);
    assertEq(r.anomalies.length, 0, 'anomali: ' + r.anomalies.join('; '));
  });

  test('Anomali: akurasi tidak wajar & koordinat presisi rendah', () => {
    const a = detectLocationAnomalies_({ lat: north(10), lng: school.lng, accuracy: 0.5, samples: [] });
    assert(a.some(x => x.indexOf('Akurasi GPS tidak wajar') === 0), 'akurasi ≤ 1 m');
    const b = detectLocationAnomalies_({ lat: -6.2088, lng: 106.8457, accuracy: 10, samples: [] });
    assert(b.some(x => x.indexOf('presisi rendah') >= 0), 'presisi rendah');
  });

  test('Anomali: pembacaan identik sempurna (pola fake GPS)', () => {
    const lat = north(10), lng = school.lng;
    const s = [sample(lat, lng, 5, 0), sample(lat, lng, 5, 1000), sample(lat, lng, 5, 2000)];
    const a = detectLocationAnomalies_({ lat: lat, lng: lng, accuracy: 5, samples: s });
    assert(a.some(x => x.indexOf('identik') >= 0), 'identik');
  });

  test('Anomali: lompatan lokasi mustahil & lokasi kiriman berbeda dari sampel', () => {
    const lng = school.lng;
    const s = [sample(north(5000), lng, 10, 0), sample(north(10), lng, 10, 2000)];
    const a = detectLocationAnomalies_({ lat: north(10), lng: lng, accuracy: 10, samples: s });
    assert(a.some(x => x.indexOf('Lompatan lokasi') === 0), 'lompatan 5 km/2 detik');
    const b = detectLocationAnomalies_({ lat: north(10), lng: lng, accuracy: 10, samples: [sample(north(900), lng, 10, 0)] });
    assert(b.some(x => x.indexOf('berbeda jauh') >= 0), 'kiriman ≠ sampel terakhir');
  });

  test('Validasi pengaturan lokasi admin', () => {
    expectError('VALIDATION', () => validateLocationSettings_({ latitude: -6.2, longitude: 106.8456789, radius: 50, maxAccuracy: 30 }), 'presisi rendah');
    expectError('VALIDATION', () => validateLocationSettings_({ latitude: -6.2088123, longitude: 106.8456789, radius: 5, maxAccuracy: 30 }), 'radius < 10');
    expectError('VALIDATION', () => validateLocationSettings_({ latitude: -6.2088123, longitude: 106.8456789, radius: 50, maxAccuracy: 500 }), 'akurasi > 100');
    const v = validateLocationSettings_({ latitude: '-6,20881234', longitude: '106.8456789', radius: '50', maxAccuracy: 30 });
    assertEq(v.school_latitude, '-6.2088123', 'koma desimal & 7 digit');
  });

  test('Simpan pengaturan lokasi lalu kembalikan nilai asli', () => {
    const keys = ['school_latitude', 'school_longitude', 'radius_meter', 'max_accuracy_meter'];
    invalidateSettingsCache_();
    const original = {};
    keys.forEach(k => { original[k] = getSettings_()[k] || ''; });
    try {
      const cfg = apiAdminUpdateLocation_({ latitude: -6.2088123, longitude: 106.8456789, radius: 75, maxAccuracy: 25 },
        { session: { user: { user_id: 'TEST' } } });
      assert(cfg.configured, 'harus terkonfigurasi');
      assertEq(cfg.lat, -6.2088123, 'latitude negatif tersimpan utuh');
      assertEq(cfg.radius, 75, 'radius');
      const check = apiCheckLocation_({ latitude: -6.2088123 + 60 / 111195.08, longitude: 106.8456789, accuracy: 10.5 });
      assert(check.valid && !('anomalies' in check), 'checkLocation 60 m dalam radius 75 m, tanpa daftar anomali');
    } finally {
      setSettings_(original);
    }
    invalidateSettingsCache_();
    keys.forEach(k => assertEq(getSettings_()[k] || '', original[k], 'nilai asli ' + k));
  });

  finish();
}

/**
 * Tahap 4: absen masuk & pulang dengan waktu dan lokasi buatan.
 * Memakai pengguna fiktif (tanpa baris di USERS) dan tanggal tahun 2000; baris ABSENSI uji dihapus di akhir.
 */
function runTahap4Tests() {
  const { test, assert, assertEq, expectError, finish } = createTestRunner_();
  resetDbCache_();

  const user = { user_id: 'TEST-T4-' + Utilities.getUuid().slice(0, 8).toUpperCase(), nama_guru: 'Guru Uji Tahap 4' };
  const school = { lat: -6.2088123, lng: 106.8456789, radius: 50, maxAccuracy: 30 };
  const schedule = { jamMasuk: '07:00', batasTerlambat: '07:15', batasAbsenMasuk: '12:00', jamPulang: '14:00', hariKerja: [1, 2, 3, 4, 5, 6] };
  // 3 Januari 2000 = Senin.
  const at = (tanggal, jam, hari) => ({ tanggal: tanggal, jam: jam, hari: hari, waktu: tanggal + ' ' + jam });
  let jitter = 0;
  // Lokasi N meter di utara titik sekolah; jitter kecil agar tiap panggilan berbeda seperti GPS asli.
  const loc = (meters, accuracy, samples) => ({
    lat: school.lat + meters / 111195.08 + (++jitter) * 1.3e-7,
    lng: school.lng + jitter * 1.1e-7,
    accuracy: accuracy,
    samples: samples || [],
  });

  try {
    test('Absen masuk tepat waktu = Hadir; data tersimpan benar', () => {
      const input = loc(20, 9.5);
      const r = performCheckIn_(user, input, at('2000-01-03', '07:05:12', 1), school, schedule);
      assertEq(r.status, STATUS_HADIR.HADIR, 'status');
      assertEq(r.jamMasuk, '07:05:12', 'jam masuk dari server');
      const row = findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-03', user.user_id));
      assertEq(row.tanggal, '2000-01-03', 'tanggal tetap teks');
      assertEq(row.latitude_masuk, input.lat, 'latitude utuh');
      assert(Math.abs(row.jarak_masuk - 20) < 1, 'jarak ±20 m, didapat ' + row.jarak_masuk);
      assertEq(row.accuracy_masuk, 9.5, 'akurasi');
      assertEq(row.anomali, '', 'tanpa anomali');
      assert(!('anomali' in r), 'anomali tidak dikirim ke guru');
    });

    test('Absen masuk ganda ditolak', () => {
      expectError('ALREADY_CHECKED_IN', () => performCheckIn_(user, loc(10, 8), at('2000-01-03', '07:30:00', 1), school, schedule), 'masuk kedua');
      assertEq(findRowsBy_(SHEETS.ABSENSI, 'attendance_id', attendanceId_('2000-01-03', user.user_id)).length, 1, 'tetap satu baris');
    });

    test('Absen pulang: terlalu awal, di luar radius, berhasil, lalu ganda ditolak', () => {
      expectError('TOO_EARLY', () => performCheckOut_(user, loc(10, 8), at('2000-01-03', '13:59:59', 1), school, schedule), 'sebelum 14:00');
      expectError('LOCATION_INVALID', () => performCheckOut_(user, loc(80, 8), at('2000-01-03', '14:05:00', 1), school, schedule), 'di luar radius');
      const r = performCheckOut_(user, loc(15, 8), at('2000-01-03', '14:05:00', 1), school, schedule);
      assertEq(r.jamPulang, '14:05:00', 'jam pulang');
      assertEq(r.jamMasuk, '07:05:12', 'jam masuk tidak berubah');
      assertEq(r.status, STATUS_HADIR.HADIR, 'status tidak berubah');
      expectError('ALREADY_CHECKED_OUT', () => performCheckOut_(user, loc(15, 8), at('2000-01-03', '15:00:00', 1), school, schedule), 'pulang kedua');
    });

    test('Absen pulang tanpa absen masuk ditolak', () => {
      expectError('NOT_CHECKED_IN', () => performCheckOut_(user, loc(10, 8), at('2000-01-04', '14:30:00', 2), school, schedule), 'belum masuk');
    });

    test('Masuk lewat batas terlambat = Terlambat (07:15:59 masih tepat waktu)', () => {
      assertEq(performCheckIn_(user, loc(10, 8), at('2000-01-05', '07:15:59', 3), school, schedule).status, STATUS_HADIR.HADIR, '07:15:59');
      assertEq(performCheckIn_(user, loc(10, 8), at('2000-01-06', '07:16:00', 4), school, schedule).status, STATUS_HADIR.TERLAMBAT, '07:16:00');
    });

    test('Absen masuk ditutup setelah batas & ditolak di luar hari kerja', () => {
      expectError('CHECKIN_CLOSED', () => performCheckIn_(user, loc(10, 8), at('2000-01-07', '12:01:00', 5), school, schedule), 'lewat 12:00');
      expectError('NOT_WORKDAY', () => performCheckIn_(user, loc(10, 8), at('2000-01-09', '07:00:00', 7), school, schedule), 'Minggu');
      assertEq(findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-07', user.user_id)), null, 'tidak ada baris tersimpan');
    });

    test('Lokasi tidak valid ditolak dan tidak tersimpan', () => {
      expectError('LOCATION_INVALID', () => performCheckIn_(user, loc(60, 8), at('2000-01-08', '07:00:00', 6), school, schedule), 'di luar radius');
      expectError('LOCATION_INVALID', () => performCheckIn_(user, loc(10, 45), at('2000-01-08', '07:00:00', 6), school, schedule), 'akurasi buruk');
      assertEq(findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-08', user.user_id)), null, 'tidak tersimpan');
    });

    test('Anomali dicatat: sampel identik & koordinat sama dengan absensi sebelumnya', () => {
      const prev = findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-03', user.user_id));
      const same = { lat: prev.latitude_masuk, lng: prev.longitude_masuk, accuracy: 5 };
      same.samples = [0, 1000, 2000].map(t => ({ lat: same.lat, lng: same.lng, accuracy: 5, t: t }));
      performCheckIn_(user, same, at('2000-01-10', '07:00:00', 1), school, schedule);
      const row = findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-10', user.user_id));
      assert(row.anomali.indexOf('Masuk: ') === 0, 'label Masuk: ' + row.anomali);
      assert(row.anomali.indexOf('identik') >= 0, 'sampel identik: ' + row.anomali);
      assert(row.anomali.indexOf('sama dengan absensi sebelumnya') >= 0, 'koordinat sama: ' + row.anomali);

      performCheckOut_(user, same, at('2000-01-10', '14:00:00', 1), school, schedule);
      const after = findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-10', user.user_id));
      assert(after.anomali.indexOf(' | Pulang: ') > 0, 'anomali pulang ditambahkan: ' + after.anomali);
    });

    test('Riwayat banyak baris terbaca benar (pencarian per pengguna)', () => {
      // 4 baris dari kasus di atas + 8 baris tambahan agar jalur "baca sekaligus" (>10 hasil) teruji.
      for (let d = 1; d <= 8; d++) {
        const tgl = '2000-02-0' + d;
        insertRow_(SHEETS.ABSENSI, { attendance_id: attendanceId_(tgl, user.user_id), user_id: user.user_id, nama_guru: user.nama_guru, tanggal: tgl, status: STATUS_HADIR.HADIR });
      }
      const rows = findRowsBy_(SHEETS.ABSENSI, 'user_id', user.user_id);
      assertEq(rows.length, 12, 'jumlah baris uji');
      assert(rows.every(r => r.user_id === user.user_id && r.attendance_id.indexOf('ATT-2000') === 0), 'semua milik pengguna uji');
    });

    test('Validasi pengaturan jam kerja admin', () => {
      const ok = { jamMasuk: '07:00', batasTerlambat: '07:15', batasAbsenMasuk: '12:00', jamPulang: '14:00', hariKerja: [6, 1, 2, 2, 3, 4, 5] };
      const v = validateScheduleInput_(ok);
      assertEq(v.hari_kerja, '1,2,3,4,5,6', 'hari diurutkan & tanpa duplikat');
      assertEq(v.batas_terlambat, '07:15', 'batas terlambat');
      expectError('VALIDATION', () => validateScheduleInput_(Object.assign({}, ok, { jamMasuk: '7:00' })), 'format jam');
      expectError('VALIDATION', () => validateScheduleInput_(Object.assign({}, ok, { jamPulang: '24:00' })), 'jam 24:00');
      expectError('VALIDATION', () => validateScheduleInput_(Object.assign({}, ok, { batasTerlambat: '06:50' })), 'terlambat < masuk');
      expectError('VALIDATION', () => validateScheduleInput_(Object.assign({}, ok, { batasAbsenMasuk: '07:10' })), 'tutup < terlambat');
      expectError('VALIDATION', () => validateScheduleInput_(Object.assign({}, ok, { hariKerja: [] })), 'tanpa hari');
      expectError('VALIDATION', () => validateScheduleInput_(Object.assign({}, ok, { hariKerja: [8] })), 'hari 8');
    });

    test('API absensi wajib login', () => {
      assertEq(dispatch_({ action: 'checkIn', payload: { latitude: -6.2, longitude: 106.8, accuracy: 5 } }, 'POST').error.code, 'SESSION_INVALID', 'checkIn tanpa sesi');
      assertEq(dispatch_({ action: 'getToday' }, 'POST').error.code, 'SESSION_INVALID', 'getToday tanpa sesi');
      const sch = getSchedule_();
      assert(/^\d{2}:\d{2}$/.test(sch.batasTerlambat) && sch.hariKerja.length > 0, 'jadwal dari SETTINGS valid');
    });
  } finally {
    deleteRowsWhere_(SHEETS.ABSENSI, r => r.user_id === user.user_id);
  }

  finish();
}

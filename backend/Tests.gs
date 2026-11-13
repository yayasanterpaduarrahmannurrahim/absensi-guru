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

/**
 * Menjalankan semua uji regresi (Tahap 1–7 + login kode) berurutan lalu meringkas hasilnya.
 * runTahap9Tests (uji beban) sengaja dijalankan terpisah karena mengubah jam kerja sementara.
 */
function runSemuaTes() {
  const suites = ['runTahap1Tests', 'runTahap2Tests', 'runTahap3Tests', 'runTahap4Tests',
    'runTahap5Tests', 'runTahap6Tests', 'runTahap7Tests', 'runLoginKodeTests', 'runSifHapusTests', 'runRevisiTests', 'runPeranTests', 'runPerformaTests'];
  const summary = suites.map(name => {
    console.log('===== ' + name + ' =====');
    try {
      globalThis[name]();
      return '[LULUS] ' + name;
    } catch (err) {
      return '[GAGAL] ' + name + ' — ' + err.message;
    }
  });
  console.log('===== RINGKASAN =====');
  summary.forEach(line => console.log(line));
  const failed = summary.filter(l => l.indexOf('[GAGAL]') === 0).length;
  if (failed) throw new Error(failed + ' kelompok uji gagal. Lihat rincian di atas.');
  console.log('Semua ' + suites.length + ' kelompok uji lulus.');
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
    expectError('VALIDATION', () => validateLocationSettings_({ latitude: -6.2088123, longitude: 106.8456789, radius: 50, maxAccuracy: 201 }), 'akurasi > 200');
    expectError('VALIDATION', () => validateLocationSettings_({ latitude: -6.2088123, longitude: 106.8456789, radius: 201, maxAccuracy: 30 }), 'radius > 200');
    const max = validateLocationSettings_({ latitude: -6.2088123, longitude: 106.8456789, radius: 200, maxAccuracy: 200 });
    assertEq(max.radius_meter + '/' + max.max_accuracy_meter, '200/200', 'batas 200 m diterima');
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

/**
 * Tahap 5: pengajuan izin/sakit, bukti di Drive, persetujuan, dan Tanpa Keterangan otomatis.
 * Memakai pengguna fiktif & tanggal tahun 2000. Baris uji dan file bukti uji dihapus di akhir.
 */
function runTahap5Tests() {
  const { test, assert, assertEq, expectError, finish } = createTestRunner_();
  resetDbCache_();

  const tag = Utilities.getUuid().slice(0, 8).toUpperCase();
  const guru = { user_id: 'TEST-T5-' + tag, nama_guru: 'Guru Uji Tahap 5', role: ROLES.GURU };
  const guru2 = { user_id: 'TEST-T5B-' + tag, nama_guru: 'Guru Uji Tahap 5 B', role: ROLES.GURU };
  const admin = { user_id: 'TEST-ADMIN' };
  const schedule = { jamMasuk: '07:00', batasTerlambat: '07:15', batasAbsenMasuk: '12:00', jamPulang: '14:00', hariKerja: [1, 2, 3, 4, 5, 6] };
  const now = { tanggal: '2000-01-03', jam: '08:00:00', hari: 1, waktu: '2000-01-03 08:00:00' };
  const proofUrls = [];
  // PNG 1x1 & PDF minimal yang valid.
  const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const PDF_MIN = Utilities.base64Encode('%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

  try {
    test('Tanggal: validasi, tambah hari, hari dalam minggu', () => {
      assertEq(parseIsoDate_('2000-02-29', 'Tgl'), '2000-02-29', 'kabisat');
      expectError('VALIDATION', () => parseIsoDate_('2001-02-29', 'Tgl'), 'bukan kabisat');
      expectError('VALIDATION', () => parseIsoDate_('03-01-2000', 'Tgl'), 'format salah');
      assertEq(addDays_('2000-01-31', 1), '2000-02-01', 'pergantian bulan');
      assertEq(dayOfWeek_('2000-01-03'), 1, 'Senin');
      assertEq(dayOfWeek_('2000-01-09'), 7, 'Minggu');
      assertEq(daysBetween_('2000-01-03', '2000-01-10'), 7, 'selisih hari');
    });

    test('Validasi pengajuan', () => {
      const ok = { jenis: 'Sakit', tanggalMulai: '2000-01-03', tanggalSelesai: '2000-01-04', alasan: 'Demam tinggi' };
      assertEq(validateLeaveInput_(ok, '2000-01-03').selesai, '2000-01-04', 'valid');
      assertEq(validateLeaveInput_(Object.assign({}, ok, { tanggalSelesai: '' }), '2000-01-03').selesai, '2000-01-03', 'satu hari');
      expectError('VALIDATION', () => validateLeaveInput_(Object.assign({}, ok, { jenis: 'Cuti' }), '2000-01-03'), 'jenis');
      expectError('VALIDATION', () => validateLeaveInput_(Object.assign({}, ok, { tanggalSelesai: '2000-01-02' }), '2000-01-03'), 'selesai < mulai');
      expectError('VALIDATION', () => validateLeaveInput_(Object.assign({}, ok, { tanggalSelesai: '2000-02-10' }), '2000-01-03'), '> 31 hari');
      expectError('VALIDATION', () => validateLeaveInput_(Object.assign({}, ok, { tanggalMulai: '1999-12-20', tanggalSelesai: '1999-12-20' }), '2000-01-03'), '> 7 hari lampau');
      expectError('VALIDATION', () => validateLeaveInput_(Object.assign({}, ok, { alasan: 'sak' }), '2000-01-03'), 'alasan pendek');
    });

    test('Bukti: PNG & PDF diterima, isi palsu/terlalu besar ditolak', () => {
      assertEq(readProof_({ mimeType: 'image/png', data: PNG_1PX }).ext, 'png', 'png');
      assertEq(readProof_({ mimeType: 'application/pdf', data: PDF_MIN }).ext, 'pdf', 'pdf');
      assertEq(readProof_(null), null, 'tanpa bukti');
      expectError('VALIDATION', () => readProof_({ mimeType: 'image/jpeg', data: PNG_1PX }), 'PNG mengaku JPEG');
      expectError('VALIDATION', () => readProof_({ mimeType: 'text/html', data: PNG_1PX }), 'jenis tidak diizinkan');
      expectError('VALIDATION', () => readProof_({ mimeType: 'application/pdf', data: Utilities.base64Encode('<script>alert(1)</script>') }), 'HTML mengaku PDF');
      const big = Utilities.base64Encode(Utilities.newBlob('%PDF' + new Array(2700000).join('a')).getBytes());
      expectError('VALIDATION', () => readProof_({ mimeType: 'application/pdf', data: big }), 'lebih dari 2,5 MB');
    });

    let leaveA;
    test('Ajukan sakit dengan bukti → tersimpan di Drive privat; overlap ditolak', () => {
      const input = validateLeaveInput_({ jenis: 'Sakit', tanggalMulai: '2000-01-07', tanggalSelesai: '2000-01-10', alasan: 'Demam, surat dokter terlampir' }, now.tanggal);
      leaveA = createLeave_(guru, input, readProof_({ mimeType: 'image/png', data: PNG_1PX }), now);
      const row = findByKey_(SHEETS.PENGAJUAN, leaveA.submissionId);
      proofUrls.push(row.bukti_url);
      assertEq(leaveA.status, STATUS_PENGAJUAN.MENUNGGU, 'status awal');
      assert(leaveA.hasBukti && !('bukti_url' in leaveA), 'URL Drive tidak dikirim ke frontend');
      const file = DriveApp.getFileById(fileIdFromUrl_(row.bukti_url));
      assertEq(file.getSharingAccess(), DriveApp.Access.PRIVATE, 'file bukti privat');
      const proof = apiAdminGetLeaveProof_({ submissionId: leaveA.submissionId });
      assertEq(proof.data, PNG_1PX, 'isi bukti terbaca utuh');

      const overlap = validateLeaveInput_({ jenis: 'Izin', tanggalMulai: '2000-01-10', tanggalSelesai: '2000-01-11', alasan: 'Acara keluarga' }, now.tanggal);
      expectError('OVERLAP', () => createLeave_(guru, overlap, null, now), 'tanggal bertumpuk');
    });

    test('Batalkan: hanya milik sendiri & berstatus Menunggu', () => {
      const input = validateLeaveInput_({ jenis: 'Izin', tanggalMulai: '2000-01-04', tanggalSelesai: '2000-01-04', alasan: 'Urusan keluarga' }, now.tanggal);
      const l = createLeave_(guru, input, null, now);
      expectError('NOT_FOUND', () => cancelLeave_(guru2, l.submissionId, now), 'milik guru lain');
      assertEq(cancelLeave_(guru, l.submissionId, now).status, STATUS_PENGAJUAN.DIBATALKAN, 'dibatalkan');
      expectError('NOT_PENDING', () => cancelLeave_(guru, l.submissionId, now), 'batal dua kali');
    });

    test('Tolak wajib catatan; pengajuan yang sudah diproses tidak bisa diproses lagi', () => {
      const input = validateLeaveInput_({ jenis: 'Izin', tanggalMulai: '2000-01-05', tanggalSelesai: '2000-01-05', alasan: 'Keperluan pribadi' }, now.tanggal);
      const l = createLeave_(guru, input, null, now);
      expectError('VALIDATION', () => processLeave_(admin, { submissionId: l.submissionId, keputusan: 'Ditolak', catatan: '' }, schedule, now), 'tanpa catatan');
      const res = processLeave_(admin, { submissionId: l.submissionId, keputusan: 'Ditolak', catatan: 'Tidak ada keterangan jelas' }, schedule, now);
      assertEq(res.leave.status, STATUS_PENGAJUAN.DITOLAK, 'ditolak');
      assertEq(findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-05', guru.user_id)), null, 'ditolak tidak menulis ABSENSI');
      expectError('NOT_PENDING', () => processLeave_(admin, { submissionId: l.submissionId, keputusan: 'Disetujui' }, schedule, now), 'proses ulang');
    });

    test('Setujui: hari kerja terisi Sakit, Minggu dilewati, absen yang ada tidak ditimpa, Tanpa Keterangan diganti', () => {
      // 7 Jan (Jumat) sudah absen masuk; 8 Jan (Sabtu) sudah Tanpa Keterangan; 9 Jan Minggu; 10 Jan (Senin) kosong.
      insertRow_(SHEETS.ABSENSI, { attendance_id: attendanceId_('2000-01-07', guru.user_id), user_id: guru.user_id, nama_guru: guru.nama_guru, tanggal: '2000-01-07', jam_masuk: '07:01:00', status: 'Hadir' });
      insertRow_(SHEETS.ABSENSI, { attendance_id: attendanceId_('2000-01-08', guru.user_id), user_id: guru.user_id, nama_guru: guru.nama_guru, tanggal: '2000-01-08', status: STATUS_HADIR.TANPA_KETERANGAN });
      const res = processLeave_(admin, { submissionId: leaveA.submissionId, keputusan: 'Disetujui', catatan: '' }, schedule, now);
      assertEq(res.leave.status, STATUS_PENGAJUAN.DISETUJUI, 'disetujui');
      assertEq(res.applied.diterapkan.join(','), '2000-01-08,2000-01-10', 'tanggal diterapkan');
      assertEq(res.applied.dilewati.length, 1, 'satu hari dilewati');
      assertEq(res.applied.dilewati[0].tanggal, '2000-01-07', 'hari yang sudah absen');
      assertEq(findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-07', guru.user_id)).status, 'Hadir', 'Hadir tidak ditimpa');
      assertEq(findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-08', guru.user_id)).status, 'Sakit', 'Tanpa Keterangan → Sakit');
      assertEq(findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-09', guru.user_id)), null, 'Minggu tidak diisi');
      const senin = findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-10', guru.user_id));
      assert(senin.status === 'Sakit' && senin.keterangan.indexOf(leaveA.submissionId) > 0, 'keterangan menyebut ID pengajuan');
      expectError('HAS_STATUS', () => performCheckIn_(guru, { lat: -6.2088123, lng: 106.8456789, accuracy: 8, samples: [] },
        { tanggal: '2000-01-10', jam: '07:00:00', hari: 1, waktu: '2000-01-10 07:00:00' },
        { lat: -6.2088123, lng: 106.8456789, radius: 50, maxAccuracy: 30 }, schedule), 'tidak bisa absen saat Sakit');
    });

    test('Tanpa Keterangan otomatis: hanya yang belum punya data, tidak ganda bila diulang', () => {
      // 11 Jan: guru sudah absen, guru2 belum.
      insertRow_(SHEETS.ABSENSI, { attendance_id: attendanceId_('2000-01-11', guru.user_id), user_id: guru.user_id, nama_guru: guru.nama_guru, tanggal: '2000-01-11', jam_masuk: '07:00:00', status: 'Hadir' });
      assertEq(markAbsenteesFor_('2000-01-11', [guru, guru2], '12:00', now), 1, 'satu guru ditandai');
      const r = findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-11', guru2.user_id));
      assertEq(r.status, STATUS_HADIR.TANPA_KETERANGAN, 'status');
      assert(r.keterangan.indexOf('12:00') > 0, 'keterangan menyebut batas');
      assertEq(markAbsenteesFor_('2000-01-11', [guru, guru2], '12:00', now), 0, 'diulang tidak ganda');
      assertEq(findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-11', guru.user_id)).status, 'Hadir', 'yang hadir tetap');
    });

    test('Izin disetujui belakangan mengganti Tanpa Keterangan', () => {
      const input = validateLeaveInput_({ jenis: 'Izin', tanggalMulai: '2000-01-11', tanggalSelesai: '2000-01-11', alasan: 'Mengantar anak berobat' }, '2000-01-12');
      const l = createLeave_(guru2, input, readProof_({ mimeType: 'application/pdf', data: PDF_MIN }), now);
      proofUrls.push(findByKey_(SHEETS.PENGAJUAN, l.submissionId).bukti_url);
      processLeave_(admin, { submissionId: l.submissionId, keputusan: 'Disetujui' }, schedule, now);
      assertEq(findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-11', guru2.user_id)).status, 'Izin', 'Tanpa Keterangan → Izin');
    });

    test('API pengajuan wajib login & admin', () => {
      assertEq(dispatch_({ action: 'submitLeave', payload: {} }, 'POST').error.code, 'SESSION_INVALID', 'submitLeave tanpa sesi');
      assertEq(dispatch_({ action: 'adminProcessLeave', payload: {} }, 'POST').error.code, 'SESSION_INVALID', 'adminProcessLeave tanpa sesi');
      assert(ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'autoMarkTanpaKeterangan'),
        'trigger autoMarkTanpaKeterangan belum terpasang — jalankan installTriggers()');
    });
  } finally {
    const ids = [guru.user_id, guru2.user_id];
    deleteRowsWhere_(SHEETS.ABSENSI, r => ids.indexOf(r.user_id) >= 0);
    deleteRowsWhere_(SHEETS.PENGAJUAN, r => ids.indexOf(r.user_id) >= 0);
    proofUrls.forEach(u => { try { trashProofFile_(u); } catch (e) { /* abaikan */ } });
  }

  finish();
}

/** Login dengan kode email: kirim, jeda, salah/benar, sekali pakai, batas percobaan. Tidak mengirim email sungguhan. */
function runLoginKodeTests() {
  const { test, assert, assertEq, expectError, finish } = createTestRunner_();
  resetDbCache_();
  const tag = Utilities.getUuid().slice(0, 8).toLowerCase();
  const email = 'uji.kode.' + tag + '@example.invalid';
  const now = nowWib_().waktu;
  const sent = [];
  const fakeSend = (to, nama, code) => sent.push({ to: to, code: code });
  const cache = CacheService.getScriptCache();
  const clear = e => { cache.remove(OTP_PREFIX + e); cache.remove(OTP_PREFIX + 'n_' + e); };

  insertRow_(SHEETS.USERS, { user_id: 'TEST-OTP-' + tag, nama_guru: 'Guru Kode', email: email, jenjang: 'SD', role: ROLES.GURU, status_akun: STATUS_AKUN.AKTIF, created_at: now, updated_at: now });
  try {
    test('Kode 6 angka dikirim ke email terdaftar; hanya hash yang disimpan', () => {
      clear(email);
      issueLoginCode_(email, fakeSend);
      assertEq(sent.length, 1, 'satu email');
      assert(/^\d{6}$/.test(sent[0].code), 'format kode');
      const stored = cache.get(OTP_PREFIX + email);
      assert(stored.indexOf(sent[0].code) < 0, 'kode mentah tidak tersimpan');
    });

    test('Minta ulang terlalu cepat ditolak', () => {
      expectError('TOO_SOON', () => issueLoginCode_(email, fakeSend), 'jeda 60 detik');
    });

    test('Kode salah ditolak; kode benar membuat sesi; kode tidak bisa dipakai dua kali', () => {
      const code = sent[0].code;
      const wrong = code === '000000' ? '111111' : '000000';
      expectError('INVALID_CODE', () => verifyLoginCode_(email, wrong), 'kode salah');
      const session = verifyLoginCode_(email, code);
      assert(/^[a-f0-9]{64}$/.test(session.token), 'token sesi');
      assertEq(requireSession_(session.token, 'user').user.email, email, 'sesi milik guru');
      expectError('INVALID_CODE', () => verifyLoginCode_(email, code), 'dipakai ulang');
    });

    test('5 kali salah → kode hangus', () => {
      clear(email);
      issueLoginCode_(email, fakeSend);
      const code = sent[sent.length - 1].code;
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) expectError('INVALID_CODE', () => verifyLoginCode_(email, wrong), 'salah ke-' + (i + 1));
      expectError('TOO_MANY', () => verifyLoginCode_(email, code), 'kode benar setelah 5x salah');
    });

    test('Email tidak terdaftar: respons sama, tidak ada email terkirim, tidak bisa login', () => {
      const other = 'tidak.terdaftar.' + tag + '@example.invalid';
      clear(other);
      const before = sent.length;
      assertEq(issueLoginCode_(other, fakeSend).sent, true, 'respons sama');
      assertEq(sent.length, before, 'tidak mengirim email');
      expectError('INVALID_CODE', () => verifyLoginCode_(other, '123456'), 'tidak bisa login');
      clear(other);
    });

    test('Validasi input API', () => {
      assertEq(dispatch_({ action: 'verifyLoginCode', payload: { email: email, code: '12ab' } }, 'POST').error.code, 'VALIDATION', 'kode bukan angka');
      assertEq(dispatch_({ action: 'requestLoginCode', payload: { email: 'bukan-email' } }, 'POST').error.code, 'VALIDATION', 'email salah');
    });
  } finally {
    clear(email);
    deleteSessionsForUser_('TEST-OTP-' + tag);
    deleteRowsWhere_(SHEETS.USERS, u => u.user_id === 'TEST-OTP-' + tag);
  }
  finish();
}

/**
 * Tahap 9: uji keamanan & uji beban melalui Web App sungguhan (HTTP paralel dengan UrlFetchApp.fetchAll).
 *
 * - Membuat 21 guru uji sementara (TEST-T9-*) beserta sesinya.
 * - Selama ±1 menit pengaturan jam diubah sementara (semua hari kerja, absen masuk ditutup 23:59,
 *   pulang mulai 00:00) agar uji bisa berjalan kapan saja; nilai asli SELALU dikembalikan.
 *   Jalankan di luar jam absen guru.
 * - Semua data uji (pengguna, sesi, absensi) dihapus di akhir.
 */
function runTahap9Tests() {
  const { test, assert, assertEq, finish } = createTestRunner_();
  resetDbCache_();
  const now = nowWib_();
  const tag = Utilities.getUuid().slice(0, 6).toUpperCase();
  const school = getSchoolLocation_();
  const PARALEL = 15;

  const makeUser = i => {
    const u = {
      user_id: 'TEST-T9-' + tag + '-' + i, nama_guru: 'Uji Beban ' + i, email: 'uji.t9.' + tag.toLowerCase() + '.' + i + '@example.invalid',
      nip: '', jenjang: i % 2 ? 'SD' : 'TK', role: ROLES.GURU, status_akun: STATUS_AKUN.AKTIF, created_at: now.waktu, updated_at: now.waktu, last_login: '',
    };
    insertRow_(SHEETS.USERS, u);
    return u;
  };
  const req = (action, token, payload) => ({
    url: APP.WEBAPP_URL, method: 'post', contentType: 'text/plain;charset=utf-8', muteHttpExceptions: true, followRedirects: true,
    payload: JSON.stringify({ action: action, token: token, payload: payload || {} }),
  });
  const parse = res => { try { return JSON.parse(res.getContentText()); } catch (e) { return { ok: false, error: { code: 'HTTP_' + res.getResponseCode() } }; } };
  const call = (action, token, payload) => parse(UrlFetchApp.fetch(req(action, token, payload).url, req(action, token, payload)));
  const loc = i => ({ latitude: school.lat + i * 2.1e-6, longitude: school.lng - i * 1.7e-6, accuracy: 8 + (i % 5) });
  const tally = list => list.reduce((m, r) => { const k = r.ok ? 'OK' : r.error.code; m[k] = (m[k] || 0) + 1; return m; }, {});

  const keys = ['hari_kerja', 'batas_absen_masuk', 'jam_pulang'];
  invalidateSettingsCache_();
  const original = {};
  keys.forEach(k => { original[k] = getSettings_()[k]; });

  let users = [];
  try {
    setSettings_({ hari_kerja: '1,2,3,4,5,6,7', batas_absen_masuk: '23:59', jam_pulang: '00:00' });
    users = Array.from({ length: PARALEL + 6 }, (_, i) => makeUser(i));
    const tokens = users.map(u => createSessionForEmail_(u.email).token);
    const guruToken = tokens[PARALEL + 1];

    /* ----- Keamanan ----- */
    test('Semua aksi terlindungi menolak permintaan tanpa sesi', () => {
      const protectedActions = Object.keys(getRoutes_()).filter(a => getRoutes_()[a].auth !== 'public');
      const res = UrlFetchApp.fetchAll(protectedActions.map(a => req(a, '', {}))).map(parse);
      const bocor = protectedActions.filter((a, i) => res[i].error && res[i].error.code !== 'SESSION_INVALID' || res[i].ok);
      assertEq(bocor.join(','), '', 'aksi yang tidak menolak');
    });

    test('Token palsu / rusak ditolak', () => {
      ['f'.repeat(64), 'abc', guruToken.slice(0, 63) + (guruToken.slice(-1) === 'a' ? 'b' : 'a'), '<script>'].forEach(t => {
        assertEq(call('me', t).error.code, 'SESSION_INVALID', 'token ' + t.slice(0, 6));
      });
    });

    test('Guru tidak bisa memakai satu pun fitur admin', () => {
      const adminActions = Object.keys(getRoutes_()).filter(a => getRoutes_()[a].auth === 'admin');
      const res = UrlFetchApp.fetchAll(adminActions.map(a => req(a, guruToken, {}))).map(parse);
      const bocor = adminActions.filter((a, i) => !(res[i].error && res[i].error.code === 'FORBIDDEN'));
      assertEq(bocor.join(','), '', 'aksi admin yang tidak menolak guru');
    });

    test('user_id & jam kiriman frontend diabaikan; jam dari server', () => {
      const victim = users[PARALEL + 2];
      const r = call('checkIn', tokens[PARALEL + 3], Object.assign({ user_id: victim.user_id, userId: victim.user_id, jam: '06:00:00', tanggal: '2000-01-01' }, loc(40)));
      assert(r.ok, 'absen gagal: ' + JSON.stringify(r.error));
      const row = findByKey_(SHEETS.ABSENSI, attendanceId_(now.tanggal, users[PARALEL + 3].user_id));
      assert(row, 'tercatat atas nama pemilik token');
      assertEq(findByKey_(SHEETS.ABSENSI, attendanceId_(now.tanggal, victim.user_id)), null, 'korban tidak tercatat');
      assert(row.jam_masuk !== '06:00:00' && Math.abs(wibNoon_(now.tanggal) - wibNoon_(row.tanggal)) === 0, 'jam & tanggal dari server');
    });

    test('Lokasi palsu / di luar radius / akurasi buruk / data rusak ditolak', () => {
      const t = tokens[PARALEL + 4];
      assertEq(call('checkIn', t, { latitude: school.lat + 0.01, longitude: school.lng, accuracy: 5 }).error.code, 'LOCATION_INVALID', '±1 km');
      assertEq(call('checkIn', t, { latitude: school.lat, longitude: school.lng, accuracy: 500 }).error.code, 'LOCATION_INVALID', 'akurasi 500 m');
      assertEq(call('checkIn', t, { latitude: 'NaN', longitude: school.lng, accuracy: 5 }).error.code, 'VALIDATION', 'NaN');
      assertEq(call('checkIn', t, { latitude: 1e309, longitude: school.lng, accuracy: 5 }).error.code, 'VALIDATION', 'Infinity');
      assertEq(findByKey_(SHEETS.ABSENSI, attendanceId_(now.tanggal, users[PARALEL + 4].user_id)), null, 'tidak tersimpan');
    });

    test('Riwayat hanya berisi data milik sendiri', () => {
      const r = call('myHistory', tokens[PARALEL + 3], {});
      assert(r.ok && r.data.records.length === 1, 'hanya 1 baris milik sendiri, didapat ' + (r.data && r.data.records.length));
      const other = call('myHistory', tokens[PARALEL + 5], {});
      assertEq(other.data.records.length, 0, 'guru lain tidak melihat data siapa pun');
    });

    /* ----- Beban & absen ganda ----- */
    // Verifikasi lewat Web App (eksekusi baru = data terbaru) & TextFinder (selalu segar),
    // bukan lewat nilai sel yang mungkin sudah di-cache oleh eksekusi uji ini.
    const todayOf = list => UrlFetchApp.fetchAll(list.map(t => req('getToday', t))).map(parse).map(r => (r.ok ? r.data.record : null));
    const countRows = u => findRowsBy_(SHEETS.ABSENSI, 'attendance_id', attendanceId_(now.tanggal, u.user_id)).length;

    const timing = {};
    test(PARALEL + ' guru absen masuk BERSAMAAN: semua tercatat, tidak ada yang hilang/ganda', () => {
      const t0 = Date.now();
      const res = UrlFetchApp.fetchAll(users.slice(0, PARALEL).map((u, i) => req('checkIn', tokens[i], loc(i)))).map(parse);
      timing.masuk = Date.now() - t0;
      const c = tally(res);
      console.log('Absen masuk paralel → ' + JSON.stringify(c));
      assertEq(c.OK || 0, PARALEL, 'berhasil');
      const counts = users.slice(0, PARALEL).map(countRows);
      assertEq(counts.filter(n => n !== 1).length, 0, 'setiap guru tepat 1 baris (jumlah baris: ' + counts.join(',') + ')');
      const recs = todayOf(tokens.slice(0, PARALEL));
      assertEq(recs.filter(r => r && r.jamMasuk).length, PARALEL, 'jam masuk terbaca dari server');
    });

    test('6 absen masuk sekaligus dari guru yang sama → tepat 1 berhasil', () => {
      const i = PARALEL;
      const res = UrlFetchApp.fetchAll([0, 1, 2, 3, 4, 5].map(k => req('checkIn', tokens[i], loc(i + k)))).map(parse);
      const c = tally(res);
      console.log('6 absen masuk guru yang sama → ' + JSON.stringify(c));
      assertEq(c.OK || 0, 1, 'berhasil');
      assertEq(c.ALREADY_CHECKED_IN || 0, 5, 'ditolak sebagai ganda');
      assertEq(countRows(users[i]), 1, 'tepat 1 baris');
    });

    test(PARALEL + ' guru absen pulang BERSAMAAN + percobaan pulang ganda', () => {
      const t0 = Date.now();
      const list = users.slice(0, PARALEL).map((u, i) => req('checkOut', tokens[i], loc(i + 50)));
      list.push(req('checkOut', tokens[0], loc(99)), req('checkOut', tokens[1], loc(98))); // ganda
      const res = UrlFetchApp.fetchAll(list).map(parse);
      timing.pulang = Date.now() - t0;
      const c = tally(res);
      console.log('Absen pulang paralel (+2 ganda) → ' + JSON.stringify(c));
      assertEq(c.OK || 0, PARALEL, 'pulang berhasil');
      assertEq(c.ALREADY_CHECKED_OUT || 0, 2, 'pulang ganda ditolak');
      const recs = todayOf(tokens.slice(0, PARALEL));
      assertEq(recs.filter(r => r && r.jamMasuk && r.jamPulang).length, PARALEL, 'jam masuk & pulang utuh untuk semua');
      console.log('Waktu ' + PARALEL + ' absen masuk paralel: ' + (timing.masuk / 1000).toFixed(1) + ' dtk; pulang: ' + (timing.pulang / 1000).toFixed(1) + ' dtk.');
    });
  } finally {
    setSettings_(original);
    const prefix = 'TEST-T9-' + tag;
    deleteRowsWhere_(SHEETS.ABSENSI, r => String(r.user_id).indexOf(prefix) === 0);
    deleteRowsWhere_(SHEETS.SESSIONS, r => String(r.user_id).indexOf(prefix) === 0);
    deleteRowsWhere_(SHEETS.USERS, r => String(r.user_id).indexOf(prefix) === 0);
    invalidateSettingsCache_();
  }
  test('Pengaturan jam kerja kembali ke nilai asli', () => {
    keys.forEach(k => assertEq(getSettings_()[k], original[k], k));
  });
  finish();
}

/** Sif Sabtu (guru SD) & hapus data. Memakai guru fiktif dan tanggal tahun 2000; data uji dihapus di akhir. */
function runSifHapusTests() {
  const { test, assert, assertEq, expectError, finish } = createTestRunner_();
  resetDbCache_();
  // Sabtu acuan Sif A = 2000-01-08. Sabtu 2000-01-15 = Sif B, 2000-01-22 = Sif A.
  const sch = { jamMasuk: '07:00', batasTerlambat: '07:15', batasAbsenMasuk: '12:00', jamPulang: '14:00', hariKerja: [1, 2, 3, 4, 5, 6], sifAcuan: '2000-01-08' };
  const tag = Utilities.getUuid().slice(0, 6).toUpperCase();
  const mk = (k, sif) => ({ user_id: 'TEST-SIF-' + tag + '-' + k, nama_guru: 'Guru Sif ' + k, jenjang: 'SD', role: ROLES.GURU, status_akun: STATUS_AKUN.AKTIF, created_at: '1999-12-01 07:00:00', sif_sabtu: sif });
  const gA = mk('A', 'A'), gB = mk('B', 'B'), gAll = mk('S', ''), gOff = mk('L', 'libur');
  const school = { lat: -6.2088123, lng: 106.8456789, radius: 50, maxAccuracy: 30 };

  try {
    test('Giliran Sif A/B bergantian dari Sabtu acuan (maju & mundur)', () => {
      assertEq(saturdayShift_('2000-01-08', sch.sifAcuan), 'A', 'acuan');
      assertEq(saturdayShift_('2000-01-15', sch.sifAcuan), 'B', '+1 minggu');
      assertEq(saturdayShift_('2000-01-22', sch.sifAcuan), 'A', '+2 minggu');
      assertEq(saturdayShift_('2000-01-01', sch.sifAcuan), 'B', '-1 minggu');
    });

    test('Jadwal per guru: Sabtu sesuai sif, hari lain & guru tanpa sif tidak berubah', () => {
      assert(isScheduledFor_(gA, '2000-01-08', sch) && !isScheduledFor_(gA, '2000-01-15', sch), 'Sif A');
      assert(!isScheduledFor_(gB, '2000-01-08', sch) && isScheduledFor_(gB, '2000-01-15', sch), 'Sif B');
      assert(isScheduledFor_(gAll, '2000-01-08', sch) && isScheduledFor_(gAll, '2000-01-15', sch), 'tanpa sif = setiap Sabtu');
      assert(!isScheduledFor_(gOff, '2000-01-08', sch), 'tidak masuk Sabtu');
      assert(isScheduledFor_(gB, '2000-01-10', sch), 'Senin tetap terjadwal');
      assert(!isScheduledFor_(gAll, '2000-01-09', sch), 'Minggu tidak terjadwal');
    });

    test('Tanpa Keterangan otomatis melewati guru yang libur sif', () => {
      const ids = scheduledGurus_([gA, gB, gAll, gOff], '2000-01-15', sch).map(u => u.user_id);
      assertEq(ids.sort().join(','), [gB.user_id, gAll.user_id].sort().join(','), 'hanya yang terjadwal');
    });

    test('Di luar jadwal sif tetap bisa absen, dengan keterangan', () => {
      const r = performCheckIn_(gA, { lat: school.lat + 1e-5, lng: school.lng, accuracy: 8, samples: [] },
        { tanggal: '2000-01-15', jam: '07:05:00', hari: 6, waktu: '2000-01-15 07:05:00' }, school, sch);
      assertEq(r.status, 'Hadir', 'status');
      assertEq(r.keterangan, 'Masuk di luar jadwal sif Sabtu', 'keterangan');
      const r2 = performCheckIn_(gB, { lat: school.lat + 2e-5, lng: school.lng, accuracy: 8, samples: [] },
        { tanggal: '2000-01-15', jam: '07:06:00', hari: 6, waktu: '2000-01-15 07:06:00' }, school, sch);
      assertEq(r2.keterangan, '', 'sesuai jadwal tanpa keterangan');
    });

    test('Rekap harian: libur sif tidak dihitung "Belum absen"', () => {
      const rows = buildDayRows_([gA, gB, gAll, gOff], [], '2000-01-15', sch);
      const st = {};
      rows.forEach(r => { st[r.nama] = r.status; });
      assertEq(st['Guru Sif A'], LIBUR_SIF, 'A libur');
      assertEq(st['Guru Sif L'], LIBUR_SIF, 'tidak masuk Sabtu');
      assertEq(st['Guru Sif B'], BELUM_ABSEN, 'B wajib');
      const s = summarizeDay_(rows, 4);
      assertEq(s.liburSif, 2, 'jumlah libur sif');
      assertEq(s.belumAbsen, 2, 'jumlah belum absen');
    });

    test('Laporan: Sabtu di luar sif tidak dihitung, kecuali guru tetap masuk', () => {
      const rec = (u, t, st) => ({ user_id: u.user_id, nama_guru: u.nama_guru, tanggal: t, status: st, jam_masuk: '07:00:00' });
      // 10–22 Jan 2000: Senin–Sabtu x2 (Sabtu 15 = B, Sabtu 22 = A) + 2 hari minggu depan.
      const recs = [rec(gA, '2000-01-15', 'Hadir'), rec(gA, '2000-01-22', 'Hadir'), rec(gB, '2000-01-15', 'Hadir')];
      const rep = buildReport_([gA, gB], recs, { mulai: '2000-01-10', selesai: '2000-01-22', jenjang: '' }, sch, '2000-02-01');
      const a = rep.perGuru.find(g => g.userId === gA.user_id), b = rep.perGuru.find(g => g.userId === gB.user_id);
      assertEq(b.hariKerja, 11, 'B: 10 hari biasa + Sabtu 15');
      assertEq(a.hariKerja, 12, 'A: 10 hari biasa + Sabtu 22 + Sabtu 15 (tetap masuk)');
      assertEq(a.diLuarSif, 1, 'satu hari di luar sif');
      assert(a.persenHadir <= 100 && b.persenHadir <= 100, 'persentase ≤ 100%');
    });

    test('Validasi sif guru & Sabtu acuan', () => {
      const base = { nama: 'Guru Uji', email: 'uji.sif@example.com', role: 'guru', jenjang: 'SD' };
      assertEq(validateUserInput_(Object.assign({ sifSabtu: 'A' }, base)).sif_sabtu, 'A', 'A');
      assertEq(validateUserInput_(base).sif_sabtu, '', 'kosong = setiap Sabtu');
      expectError('VALIDATION', () => validateUserInput_(Object.assign({ sifSabtu: 'C' }, base)), 'sif C');
      const ok = { jamMasuk: '07:00', batasTerlambat: '07:15', batasAbsenMasuk: '12:00', jamPulang: '14:00', hariKerja: [1, 2, 3, 4, 5, 6] };
      assertEq(validateScheduleInput_(Object.assign({ sifAcuan: '2026-11-07' }, ok)).sif_sabtu_acuan, '2026-11-07', 'Sabtu valid');
      expectError('VALIDATION', () => validateScheduleInput_(Object.assign({ sifAcuan: '2026-11-06' }, ok)), 'bukan Sabtu');
    });

    test('Hapus data: pratinjau tidak menghapus; konfirmasi menghapus tepat sasaran', () => {
      const now = nowWib_();
      const row = (u, t) => insertRow_(SHEETS.ABSENSI, { attendance_id: attendanceId_(t, u.user_id), user_id: u.user_id, nama_guru: u.nama_guru, tanggal: t, status: 'Hadir', jam_masuk: '07:00:00' });
      row(gAll, '2000-03-01'); row(gAll, '2000-03-02'); row(gAll, '2000-03-03'); row(gOff, '2000-03-02');
      insertRow_(SHEETS.PENGAJUAN, { submission_id: 'SUB-T-' + tag, user_id: gAll.user_id, nama_guru: gAll.nama_guru, jenis_pengajuan: 'Izin', tanggal_mulai: '2000-03-02', tanggal_selesai: '2000-03-04', alasan: 'uji', status_persetujuan: 'Menunggu', created_at: now.waktu });
      const f = validateDeleteData_({ jenis: 'semua', mulai: '2000-03-02', selesai: '2000-03-03', userId: gAll.user_id });
      const dry = deleteData_({ user_id: 'TEST' }, f, false);
      assert(dry.dryRun && dry.absensi === 2 && dry.pengajuan === 1, 'pratinjau: ' + JSON.stringify(dry));
      assertEq(findRowsBy_(SHEETS.ABSENSI, 'user_id', gAll.user_id).length, 3, 'pratinjau tidak menghapus (3 baris guru S)');
      const done = deleteData_({ user_id: 'TEST' }, f, true);
      assertEq(done.absensi, 2, 'absensi terhapus');
      assertEq(done.pengajuan, 1, 'pengajuan terhapus');
      assertEq(findRowsBy_(SHEETS.ABSENSI, 'user_id', gAll.user_id).map(r => r.tanggal).join(','), '2000-03-01', 'di luar rentang tetap ada');
      assertEq(findRowsBy_(SHEETS.ABSENSI, 'user_id', gOff.user_id).length, 1, 'guru lain tetap ada');
      expectError('VALIDATION', () => validateDeleteData_({ jenis: 'audit', mulai: '2000-03-01', selesai: '2000-03-02' }), 'audit log tidak bisa dihapus');
      assertEq(dispatch_({ action: 'adminDeleteData', payload: {} }, 'POST').error.code, 'SESSION_INVALID', 'wajib admin');
    });
  } finally {
    const prefix = 'TEST-SIF-' + tag;
    deleteRowsWhere_(SHEETS.ABSENSI, r => String(r.user_id).indexOf(prefix) === 0);
    deleteRowsWhere_(SHEETS.PENGAJUAN, r => String(r.user_id).indexOf(prefix) === 0);
  }
  finish();
}

/** Revisi absensi per guru untuk tanggal yang sudah lewat (satu/banyak hari, hapus catatan). */
function runRevisiTests() {
  const { test, assert, assertEq, expectError, finish } = createTestRunner_();
  resetDbCache_();
  const tag = Utilities.getUuid().slice(0, 6).toUpperCase();
  const now = nowWib_();
  const admin = { user_id: 'TEST-ADM-REV' };
  const g = { user_id: 'TEST-REV-' + tag, nama_guru: 'Guru Revisi', email: 'uji.rev.' + tag.toLowerCase() + '@example.invalid', jenjang: 'SD',
    role: ROLES.GURU, status_akun: STATUS_AKUN.AKTIF, created_at: '1999-12-01 07:00:00', updated_at: now.waktu, sif_sabtu: 'A' };
  const sch = { jamMasuk: '07:00', batasTerlambat: '07:15', batasAbsenMasuk: '12:00', jamPulang: '14:00', hariKerja: [1, 2, 3, 4, 5, 6], sifAcuan: '2000-01-08' };
  const rec = (t, st) => insertRow_(SHEETS.ABSENSI, { attendance_id: attendanceId_(t, g.user_id), user_id: g.user_id, nama_guru: g.nama_guru, tanggal: t, status: st });

  insertRow_(SHEETS.USERS, g);
  try {
    test('Tampilan bulan: semua tanggal, tanpa data, libur, libur sif, terbaru di atas', () => {
      const days = buildGuruMonth_(g, [{ tanggal: '2000-01-03', status: 'Hadir', jam_masuk: '07:00:00' }], '2000-01', sch, '2000-02-15');
      assertEq(days.length, 31, '31 hari Januari');
      assertEq(days[0].tanggal, '2000-01-31', 'terbaru di atas');
      const by = {};
      days.forEach(d => { by[d.tanggal] = d.status; });
      assertEq(by['2000-01-03'], 'Hadir', 'ada catatan');
      assertEq(by['2000-01-04'], TANPA_DATA, 'hari kerja tanpa catatan');
      assertEq(by['2000-01-09'], LIBUR, 'Minggu');
      assertEq(by['2000-01-15'], LIBUR_SIF, 'Sabtu Sif B untuk guru Sif A');
      assertEq(by['2000-01-08'], TANPA_DATA, 'Sabtu Sif A terjadwal');
      assertEq(buildGuruMonth_(g, [], '2000-02', sch, '2000-02-10').length, 10, 'bulan berjalan hanya sampai hari ini');
    });

    test('Validasi revisi', () => {
      const ok = { userId: g.user_id, tanggal: ['2000-01-05', '2000-01-04', '2000-01-04'], status: 'Hadir', jamMasuk: '07:10', alasan: 'HP rusak, hadir sesuai daftar piket' };
      const v = validateBulkCorrection_(ok, now.tanggal);
      assertEq(v.dates.join(','), '2000-01-04,2000-01-05', 'urut & tanpa duplikat');
      assertEq(v.jamMasuk, '07:10:00', 'jam dinormalkan');
      expectError('VALIDATION', () => validateBulkCorrection_(Object.assign({}, ok, { tanggal: [] }), now.tanggal), 'tanpa tanggal');
      expectError('VALIDATION', () => validateBulkCorrection_(Object.assign({}, ok, { tanggal: [addDays_(now.tanggal, 1)] }), now.tanggal), 'tanggal depan');
      expectError('VALIDATION', () => validateBulkCorrection_(Object.assign({}, ok, { alasan: 'x' }), now.tanggal), 'alasan pendek');
      expectError('VALIDATION', () => validateBulkCorrection_(Object.assign({}, ok, { status: 'HAPUS', alasan: '' }), now.tanggal), 'hapus tanpa alasan');
      assert(validateBulkCorrection_(Object.assign({}, ok, { status: 'HAPUS' }), now.tanggal).hapus, 'hapus catatan');
    });

    test('Revisi banyak hari sekaligus: membuat & mengubah, satu baris per hari', () => {
      rec('2000-01-04', 'Tanpa Keterangan');
      const res = bulkCorrect_(admin, validateBulkCorrection_({ userId: g.user_id, tanggal: ['2000-01-04', '2000-01-05', '2000-01-06'], status: 'Hadir', jamMasuk: '07:05', jamPulang: '14:00', alasan: 'Hadir, HP rusak' }, now.tanggal), now);
      assertEq(res.diubah, 3, 'tiga hari direvisi');
      ['2000-01-04', '2000-01-05', '2000-01-06'].forEach(t => {
        const rows = findRowsBy_(SHEETS.ABSENSI, 'attendance_id', attendanceId_(t, g.user_id));
        assertEq(rows.length, 1, 'satu baris ' + t);
      });
      const month = apiAdminGuruMonth_({ userId: g.user_id, bulan: '2000-01' });
      const d4 = month.days.find(d => d.tanggal === '2000-01-04');
      assertEq(d4.status, 'Hadir', 'TK → Hadir');
      assertEq(d4.jamMasuk, '07:05:00', 'jam masuk');
      assert(d4.keterangan.indexOf('Koreksi admin') === 0, 'ditandai koreksi');
    });

    test('Hapus catatan mengosongkan hari & tercatat di log', () => {
      const res = bulkCorrect_(admin, validateBulkCorrection_({ userId: g.user_id, tanggal: ['2000-01-05', '2000-01-20'], status: 'HAPUS', alasan: 'Libur nasional' }, now.tanggal), now);
      assertEq(res.dihapus, 1, 'hanya yang ada catatannya');
      assertEq(findByKey_(SHEETS.ABSENSI, attendanceId_('2000-01-05', g.user_id)), null, 'terhapus');
      const log = readTail_(SHEETS.AUDIT_LOG, 5).filter(l => l.aktivitas === 'HAPUS_CATATAN_ABSENSI' && l.user_id === admin.user_id);
      assert(log.length >= 1 && JSON.parse(log[log.length - 1].detail).sebelum.status === 'Hadir', 'log menyimpan nilai sebelum');
    });

    test('API revisi wajib admin; bulan depan & guru tidak dikenal ditolak', () => {
      assertEq(dispatch_({ action: 'adminGuruMonth', payload: { userId: g.user_id } }, 'POST').error.code, 'SESSION_INVALID', 'tanpa sesi');
      assertEq(dispatch_({ action: 'adminBulkCorrect', payload: {} }, 'POST').error.code, 'SESSION_INVALID', 'tanpa sesi');
      const nextMonth = addDays_(lastDayOfMonth_(now.tanggal.slice(0, 7)), 1).slice(0, 7);
      expectError('VALIDATION', () => apiAdminGuruMonth_({ userId: g.user_id, bulan: nextMonth }), 'bulan depan');
      expectError('NOT_FOUND', () => apiAdminGuruMonth_({ userId: 'TIDAK-ADA-' + tag, bulan: '2000-01' }), 'guru tidak dikenal');
    });
  } finally {
    deleteRowsWhere_(SHEETS.ABSENSI, r => r.user_id === g.user_id);
    deleteRowsWhere_(SHEETS.USERS, r => r.user_id === g.user_id);
  }
  finish();
}

/** Batch (banyak aksi baca dalam satu permintaan) & cache akun pada pemeriksaan sesi. */
function runPerformaTests() {
  const { test, assert, assertEq, finish } = createTestRunner_();
  resetDbCache_();
  const tag = Utilities.getUuid().slice(0, 6).toLowerCase();
  const ctx = { session: { user: { user_id: 'TEST' } } };
  const email = 'uji.performa.' + tag + '@example.invalid';
  let guru = null;
  try {
    guru = apiAdminCreateUser_({ nama: 'Guru Performa', email: email, jenjang: 'SD', roles: ['guru'] }, ctx);
    const token = createSessionForEmail_(email).token;

    test('Batch: beberapa aksi baca dalam satu permintaan, urutan hasil terjaga', () => {
      const res = dispatch_({ action: 'batch', token: token, payload: { calls: [
        { action: 'getLocationConfig' }, { action: 'myHistory' }, { action: 'getToday' },
      ] } }, 'POST');
      assert(res.ok, 'batch gagal: ' + JSON.stringify(res.error));
      assertEq(res.data.length, 3, 'tiga hasil');
      assert(res.data.every(r => r.ok), 'semua berhasil');
      assert('radius' in res.data[0].data && 'records' in res.data[1].data && 'serverNow' in res.data[2].data, 'urutan sesuai');
    });

    test('Batch: hak akses tiap aksi tetap diperiksa & aksi ubah data ditolak', () => {
      const res = dispatch_({ action: 'batch', token: token, payload: { calls: [
        { action: 'adminListUsers' }, { action: 'checkIn' }, { action: 'batch' }, { action: 'myLeaves' },
      ] } }, 'POST').data;
      assertEq(res[0].error.code, 'FORBIDDEN', 'guru minta data admin');
      assertEq(res[1].error.code, 'UNKNOWN_ACTION', 'aksi ubah data tidak boleh di-batch');
      assertEq(res[2].error.code, 'UNKNOWN_ACTION', 'batch bersarang');
      assert(res[3].ok, 'aksi lain tetap berjalan');
      assertEq(dispatch_({ action: 'batch', payload: { calls: [{ action: 'me' }] } }, 'POST').error.code, 'SESSION_INVALID', 'tanpa sesi');
      assertEq(dispatch_({ action: 'batch', token: token, payload: { calls: new Array(11).fill({ action: 'me' }) } }, 'POST').error.code, 'VALIDATION', 'maks 10');
    });

    test('Cache akun: menonaktifkan / mencabut admin tetap langsung berlaku', () => {
      assertEq(requireSession_(token, 'user').user.user_id, guru.userId, 'sesi aktif (akun kini tersimpan di cache)');
      assert(CacheService.getScriptCache().get(USER_CACHE_PREFIX + guru.userId), 'akun tersimpan di cache');
      apiAdminUpdateUser_({ userId: guru.userId, nama: 'Guru Performa', email: email, jenjang: 'SD', roles: ['guru', 'admin'], statusAkun: 'aktif' }, ctx);
      assertEq(CacheService.getScriptCache().get(USER_CACHE_PREFIX + guru.userId), null, 'cache dibuang setelah ubah peran');
      apiAdminUpdateUser_({ userId: guru.userId, nama: 'Guru Performa', email: email, jenjang: 'SD', roles: ['guru'], statusAkun: 'nonaktif' }, ctx);
      assertEq(CacheService.getScriptCache().get(USER_CACHE_PREFIX + guru.userId), null, 'cache dibuang setelah dinonaktifkan');
      assertEq(dispatch_({ action: 'me', token: token }, 'POST').error.code, 'SESSION_INVALID', 'akses langsung hilang');
    });
  } finally {
    const left = deleteRowsWhere_(SHEETS.USERS, u => u.email === email);
    left.forEach(u => deleteSessionsForUser_(u.user_id));
  }
  finish();
}

/** Peran ganda (Guru + Admin) dalam satu akun. Pengguna uji dihapus di akhir. */
function runPeranTests() {
  const { test, assert, assertEq, expectError, finish } = createTestRunner_();
  resetDbCache_();
  const tag = Utilities.getUuid().slice(0, 6).toLowerCase();
  const ctx = { session: { user: { user_id: 'TEST' } } };
  const email = 'uji.peran.' + tag + '@example.invalid';
  let dual = null;

  try {
    test('Membaca peran: format lama, ganda, urutan tetap, nilai asing diabaikan', () => {
      assertEq(parseRoles_('guru').join(','), 'guru', 'lama: guru');
      assertEq(parseRoles_('admin').join(','), 'admin', 'lama: admin');
      assertEq(parseRoles_('admin, guru').join(','), 'guru,admin', 'ganda diurutkan');
      assertEq(parseRoles_('guru,superadmin').join(','), 'guru', 'nilai asing diabaikan');
      assert(hasRole_({ role: 'guru,admin' }, 'admin') && hasRole_({ role: 'guru,admin' }, 'guru'), 'hasRole_ ganda');
      assert(!hasRole_({ role: 'guru' }, 'admin'), 'guru bukan admin');
    });

    test('Validasi peran dari formulir', () => {
      const base = { nama: 'Guru Ganda', email: email, jenjang: 'SD' };
      assertEq(validateUserInput_(Object.assign({ roles: ['admin', 'guru', 'guru'] }, base)).role, 'guru,admin', 'ganda');
      assertEq(validateUserInput_(Object.assign({ role: 'guru' }, base)).role, 'guru', 'format lama');
      expectError('VALIDATION', () => validateUserInput_(Object.assign({ roles: [] }, base)), 'tanpa peran');
      expectError('VALIDATION', () => validateUserInput_(Object.assign({ roles: ['guru', 'kepala'] }, base)), 'peran asing');
      expectError('VALIDATION', () => validateUserInput_({ nama: 'Tanpa Jenjang', email: email, roles: ['guru', 'admin'] }), 'guru wajib jenjang');
      assertEq(validateUserInput_({ nama: 'Admin Saja', email: email, roles: ['admin'] }).jenjang, '', 'admin murni boleh tanpa jenjang');
    });

    test('Akun ganda: bisa fitur admin DAN dihitung sebagai guru', () => {
      dual = apiAdminCreateUser_({ nama: 'Guru Ganda', email: email, jenjang: 'SD', roles: ['guru', 'admin'] }, ctx);
      assertEq(dual.roles.join(','), 'guru,admin', 'roles di frontend');
      assertEq(dual.role, 'admin', 'peran utama = admin');
      const s = createSessionForEmail_(email);
      assertEq(requireSession_(s.token, 'admin').user.user_id, dual.userId, 'akses admin');
      assert(dispatch_({ action: 'adminListUsers', token: s.token }, 'POST').ok, 'fitur admin');
      assert(dispatch_({ action: 'getToday', token: s.token }, 'POST').ok, 'fitur guru (absen)');
      const row = findByKey_(SHEETS.USERS, dual.userId);
      const rows = buildDayRows_([row], [], '2000-01-03', { hariKerja: [1, 2, 3, 4, 5, 6], sifAcuan: '2000-01-08' });
      assertEq(rows.length, 1, 'muncul di rekap harian');
      assertEq(rows[0].status, BELUM_ABSEN, 'dihitung wajib absen');
      assert(scheduledGurus_([row], '2000-01-03', { hariKerja: [1, 2, 3, 4, 5, 6] }).length === 1, 'ikut penandaan Alpa otomatis');
    });

    test('Mencabut peran guru / admin dari akun ganda', () => {
      const asGuru = apiAdminUpdateUser_({ userId: dual.userId, nama: 'Guru Ganda', email: email, jenjang: 'SD', roles: ['guru'], statusAkun: 'aktif' }, ctx);
      assertEq(asGuru.roles.join(','), 'guru', 'tinggal guru');
      const s = createSessionForEmail_(email);
      assertEq(dispatch_({ action: 'adminListUsers', token: s.token }, 'POST').error.code, 'FORBIDDEN', 'hak admin langsung hilang');
      const asAdmin = apiAdminUpdateUser_({ userId: dual.userId, nama: 'Guru Ganda', email: email, jenjang: '', roles: ['admin'], statusAkun: 'aktif' }, ctx);
      assertEq(asAdmin.roles.join(','), 'admin', 'tinggal admin');
      assertEq(buildDayRows_([findByKey_(SHEETS.USERS, dual.userId)], []).length, 0, 'admin murni tidak dihitung di rekap');
    });

    test('Admin tidak bisa mencabut hak admin sendiri, tetapi boleh menambah peran guru', () => {
      const self = { session: { user: findByKey_(SHEETS.USERS, dual.userId) } };
      expectError('FORBIDDEN_SELF', () => apiAdminUpdateUser_({ userId: dual.userId, nama: 'Guru Ganda', email: email, jenjang: 'SD', roles: ['guru'], statusAkun: 'aktif' }, self), 'cabut admin sendiri');
      const both = apiAdminUpdateUser_({ userId: dual.userId, nama: 'Guru Ganda', email: email, jenjang: 'SD', roles: ['guru', 'admin'], statusAkun: 'aktif' }, self);
      assertEq(both.roles.join(','), 'guru,admin', 'menambah peran guru untuk diri sendiri');
    });
  } finally {
    const left = deleteRowsWhere_(SHEETS.USERS, u => u.email === email);
    left.forEach(u => deleteSessionsForUser_(u.user_id));
  }
  finish();
}

/** Tahap 7: laporan per periode (perhitungan murni, tanpa menulis data). */
function runTahap7Tests() {
  const { test, assert, assertEq, expectError, finish } = createTestRunner_();
  const hk = [1, 2, 3, 4, 5, 6];
  const a = { user_id: 'A', nama_guru: 'Bunga', jenjang: 'SD', role: ROLES.GURU, status_akun: STATUS_AKUN.AKTIF, created_at: '1999-12-01 08:00:00' };
  const b = { user_id: 'B', nama_guru: 'Anggrek', jenjang: 'TK', role: ROLES.GURU, status_akun: STATUS_AKUN.AKTIF, created_at: '2000-01-05 08:00:00' };
  const c = { user_id: 'C', nama_guru: 'Cempaka', jenjang: 'SD', role: ROLES.GURU, status_akun: STATUS_AKUN.NONAKTIF, created_at: '1999-12-01 08:00:00' };
  const r = (u, t, st, jm) => ({ user_id: u.user_id, nama_guru: u.nama_guru, tanggal: t, status: st, jam_masuk: jm || '', jam_pulang: '' });
  // 3–9 Jan 2000: Senin–Minggu (6 hari kerja).
  const records = [
    r(a, '2000-01-03', 'Hadir', '07:00:00'), r(a, '2000-01-04', 'Terlambat', '07:30:00'), r(a, '2000-01-05', 'Sakit'),
    r(a, '2000-01-06', 'Tanpa Keterangan'), r(a, '2000-01-07', 'Hadir', '07:01:00'),
    r(b, '2000-01-05', 'Hadir', '07:02:00'), r(b, '2000-01-06', 'Izin'),
    r({ user_id: 'X', nama_guru: 'Zaitun Lama' }, '2000-01-03', 'Hadir', '07:00:00'),
    r(a, '2000-01-10', 'Hadir', '07:00:00'), // di luar rentang
  ];
  const range = { mulai: '2000-01-03', selesai: '2000-01-09', jenjang: '' };

  test('Hari kerja dihitung (Minggu tidak) & hanya sampai hari ini', () => {
    assertEq(buildReport_([a], records, range, hk, '2000-01-20').hariKerja, 6, '6 hari kerja');
    assertEq(buildReport_([a], records, range, hk, '2000-01-05').hariKerja, 3, 'sampai hari ini saja');
  });

  test('Rekap per guru: jumlah status, tanpa data, persentase', () => {
    const rep = buildReport_([a, b, c], records, range, hk, '2000-01-20');
    const ga = rep.perGuru.find(g => g.userId === 'A');
    assertEq(ga.hadir, 2, 'hadir'); assertEq(ga.terlambat, 1, 'terlambat'); assertEq(ga.sakit, 1, 'sakit'); assertEq(ga.alpa, 1, 'alpa');
    assertEq(ga.tanpaData, 1, 'Sabtu tanpa data');
    assertEq(ga.persenHadir, 50, '3 dari 6 hari = 50%');
    const gb = rep.perGuru.find(g => g.userId === 'B');
    assertEq(gb.hariKerja, 4, 'dihitung sejak terdaftar 5 Jan');
    assertEq(gb.tanpaData, 2, '2 hari tanpa data');
    assert(!rep.perGuru.some(g => g.userId === 'C'), 'nonaktif tanpa data tidak masuk');
    assert(rep.perGuru.some(g => g.nama === 'Zaitun Lama'), 'guru terhapus yang punya data tetap masuk');
    assertEq(rep.details.length, 8, 'detail hanya dalam rentang');
    assertEq(rep.details[0].tanggal, '2000-01-03', 'detail urut tanggal');
  });

  test('Filter jenjang', () => {
    const rep = buildReport_([a, b, c], records, Object.assign({}, range, { jenjang: 'TK' }), hk, '2000-01-20');
    assertEq(rep.perGuru.map(g => g.nama).join(','), 'Anggrek', 'hanya TK');
    assert(rep.details.every(d => d.jenjang === 'TK'), 'detail hanya TK');
    assertEq(rep.totals.izin, 1, 'total izin TK');
  });

  test('Validasi rentang', () => {
    assertEq(validateReportRange_({ mulai: '2000-01-01', selesai: '2000-01-31' }, '2000-02-01').selesai, '2000-01-31', 'valid');
    expectError('VALIDATION', () => validateReportRange_({ mulai: '2000-01-10', selesai: '2000-01-01' }, '2000-02-01'), 'terbalik');
    expectError('VALIDATION', () => validateReportRange_({ mulai: '2000-01-01', selesai: '2000-06-01' }, '2000-07-01'), '> 3 bulan');
    expectError('VALIDATION', () => validateReportRange_({ mulai: '2000-03-01', selesai: '2000-03-02' }, '2000-02-01'), 'mulai di masa depan');
    expectError('VALIDATION', () => validateReportRange_({ mulai: '2000-01-01', selesai: '2000-01-02', jenjang: 'SMP' }, '2000-02-01'), 'jenjang');
  });

  test('API laporan wajib admin & berjalan pada data nyata', () => {
    assertEq(dispatch_({ action: 'adminReport', payload: {} }, 'POST').error.code, 'SESSION_INVALID', 'tanpa sesi');
    const today = nowWib_().tanggal;
    const rep = apiAdminReport_({ mulai: today.slice(0, 8) + '01', selesai: today });
    assert(Array.isArray(rep.perGuru) && Array.isArray(rep.details), 'struktur laporan');
  });

  finish();
}

/** Tahap 6: rekap harian, tren, riwayat, koreksi absensi, audit log. */
function runTahap6Tests() {
  const { test, assert, assertEq, expectError, finish } = createTestRunner_();
  resetDbCache_();

  const tag = Utilities.getUuid().slice(0, 8).toUpperCase();
  const g1 = { user_id: 'TEST-T6A-' + tag, nama_guru: 'Bunga Uji', jenjang: 'SD', role: ROLES.GURU, status_akun: STATUS_AKUN.AKTIF };
  const g2 = { user_id: 'TEST-T6B-' + tag, nama_guru: 'Anggrek Uji', jenjang: 'TK', role: ROLES.GURU, status_akun: STATUS_AKUN.AKTIF };
  const g3 = { user_id: 'TEST-T6C-' + tag, nama_guru: 'Cempaka Uji', jenjang: 'SD', role: ROLES.GURU, status_akun: STATUS_AKUN.NONAKTIF };
  const adminUser = { user_id: 'TEST-ADM-' + tag, nama_guru: 'Admin Uji', role: ROLES.ADMIN, status_akun: STATUS_AKUN.AKTIF };
  const now = { tanggal: '2000-01-20', jam: '15:00:00', hari: 4, waktu: '2000-01-20 15:00:00' };
  const rec = (u, tanggal, status, jamMasuk) => ({ attendance_id: attendanceId_(tanggal, u.user_id), user_id: u.user_id, nama_guru: u.nama_guru, tanggal: tanggal, status: status, jam_masuk: jamMasuk || '' });

  try {
    test('Rekap harian: guru aktif tanpa data = Belum absen; nonaktif hanya muncul bila punya data', () => {
      const rows = buildDayRows_([g1, g2, g3, adminUser], [rec(g1, '2000-01-20', 'Terlambat', '07:20:00')]);
      assertEq(rows.map(r => r.nama).join(','), 'Anggrek Uji,Bunga Uji', 'urut nama, tanpa nonaktif & admin');
      assertEq(rows[0].status, BELUM_ABSEN, 'belum absen');
      assertEq(rows[1].jamMasuk, '07:20:00', 'jam masuk');
      const withOld = buildDayRows_([g1, g2, g3], [rec(g3, '2000-01-20', 'Hadir', '07:00:00'), rec({ user_id: 'X-DIHAPUS', nama_guru: 'Zaitun Lama' }, '2000-01-20', 'Izin')]);
      assert(withOld.some(r => r.userId === g3.user_id), 'nonaktif yang punya data tetap tampil');
      assert(withOld.some(r => r.nama === 'Zaitun Lama' && r.statusAkun === 'dihapus'), 'guru terhapus tetap tampil');
    });

    test('Ringkasan angka harian', () => {
      const rows = buildDayRows_([g1, g2], [rec(g1, '2000-01-20', 'Terlambat', '07:20:00')]);
      const s = summarizeDay_(rows, 2);
      assertEq(s.hadir, 1, 'hadir termasuk terlambat');
      assertEq(s.terlambat, 1, 'terlambat');
      assertEq(s.tepatWaktu, 0, 'tepat waktu');
      assertEq(s.belumAbsen, 1, 'belum absen');
    });

    test('Tren 14 hari: urut, hari kerja ditandai, jumlah benar', () => {
      const t = buildTrend_([rec(g1, '2000-01-20', 'Hadir'), rec(g2, '2000-01-20', 'Sakit'), rec(g1, '2000-01-19', 'Tanpa Keterangan')],
        '2000-01-20', 14, [1, 2, 3, 4, 5, 6]);
      assertEq(t.length, 14, 'jumlah hari');
      assertEq(t[0].tanggal, '2000-01-07', 'hari pertama');
      assertEq(t[13].Hadir, 1, 'hadir hari terakhir');
      assertEq(t[13].Sakit, 1, 'sakit hari terakhir');
      assertEq(t[12]['Tanpa Keterangan'], 1, 'TK sehari sebelumnya');
      assertEq(t.find(d => d.tanggal === '2000-01-09').hariKerja, false, 'Minggu bukan hari kerja');
    });

    test('Validasi koreksi', () => {
      const ok = { userId: g1.user_id, tanggal: '2000-01-20', status: 'Hadir', jamMasuk: '07:05', jamPulang: '14:10', alasan: 'Lupa absen, hadir sesuai daftar piket' };
      const v = validateCorrection_(ok, now.tanggal);
      assertEq(v.jamMasuk, '07:05:00', 'jam dinormalkan');
      assertEq(validateCorrection_(Object.assign({}, ok, { status: 'Sakit' }), now.tanggal).jamMasuk, '', 'Sakit mengosongkan jam');
      expectError('VALIDATION', () => validateCorrection_(Object.assign({}, ok, { tanggal: '2000-01-21' }), now.tanggal), 'tanggal depan');
      expectError('VALIDATION', () => validateCorrection_(Object.assign({}, ok, { jamMasuk: '' }), now.tanggal), 'Hadir tanpa jam masuk');
      expectError('VALIDATION', () => validateCorrection_(Object.assign({}, ok, { jamPulang: '06:00' }), now.tanggal), 'pulang < masuk');
      expectError('VALIDATION', () => validateCorrection_(Object.assign({}, ok, { alasan: 'ok' }), now.tanggal), 'alasan pendek');
      expectError('VALIDATION', () => validateCorrection_(Object.assign({}, ok, { status: 'Cuti' }), now.tanggal), 'status tidak dikenal');
    });

    test('Koreksi: membuat data baru lalu mengubahnya, keduanya tercatat di audit log', () => {
      insertRow_(SHEETS.USERS, Object.assign({ email: 'uji.tahap6.' + tag.toLowerCase() + '@example.invalid', created_at: now.waktu }, g1));
      const created = correctAttendance_(adminUser, validateCorrection_({ userId: g1.user_id, tanggal: '2000-01-18', status: 'Tanpa Keterangan', alasan: 'Tidak hadir tanpa kabar' }, now.tanggal), now);
      assertEq(created.status, 'Tanpa Keterangan', 'dibuat');
      assertEq(created.jenjang, 'SD', 'jenjang dari USERS');
      const fixed = correctAttendance_(adminUser, validateCorrection_({ userId: g1.user_id, tanggal: '2000-01-18', status: 'Hadir', jamMasuk: '07:00', alasan: 'Ternyata hadir, HP rusak' }, now.tanggal), now);
      assertEq(fixed.status, 'Hadir', 'diubah');
      assertEq(fixed.jamMasuk, '07:00:00', 'jam masuk');
      assert(fixed.keterangan.indexOf('Koreksi admin: Ternyata hadir') === 0, 'keterangan koreksi');
      assertEq(findRowsBy_(SHEETS.ABSENSI, 'attendance_id', attendanceId_('2000-01-18', g1.user_id)).length, 1, 'tetap satu baris');
      const logs = readTail_(SHEETS.AUDIT_LOG, 5).filter(l => l.aktivitas === 'KOREKSI_ABSENSI' && l.user_id === adminUser.user_id);
      assertEq(logs.length, 2, 'dua log koreksi');
      const last = JSON.parse(logs[1].detail);
      assertEq(last.sebelum.status, 'Tanpa Keterangan', 'audit: nilai sebelum');
      assertEq(last.sesudah.status, 'Hadir', 'audit: nilai sesudah');
      expectError('NOT_FOUND', () => correctAttendance_(adminUser, validateCorrection_({ userId: 'TIDAK-ADA', tanggal: '2000-01-18', status: 'Izin', alasan: 'Uji tidak ditemukan' }, now.tanggal), now), 'guru tidak ada');
    });

    test('Audit log terbaca terbaru di atas & bisa dicari', () => {
      const logs = apiAdminAuditLog_({ q: 'ternyata hadir' });
      assert(logs.length >= 1 && logs[0].aktivitas === 'KOREKSI_ABSENSI', 'pencarian menemukan koreksi');
      const all = apiAdminAuditLog_({});
      assert(all.length >= 1 && all.length <= 200, 'maksimal 200');
      assert(all[0].waktu >= all[all.length - 1].waktu, 'terbaru di atas');
    });

    test('API dashboard wajib admin', () => {
      assertEq(dispatch_({ action: 'adminDashboard' }, 'POST').error.code, 'SESSION_INVALID', 'tanpa sesi');
      assertEq(dispatch_({ action: 'myHistory' }, 'POST').error.code, 'SESSION_INVALID', 'riwayat tanpa sesi');
      const d = apiAdminDashboard_({});
      assert(d.summary && Array.isArray(d.rows) && d.trend.length === 14, 'struktur dashboard');
      assert(d.rows.every(r => !('latitude_masuk' in r)), 'koordinat mentah tidak dikirim');
    });
  } finally {
    deleteRowsWhere_(SHEETS.ABSENSI, r => String(r.user_id).indexOf('TEST-T6') === 0);
    deleteRowsWhere_(SHEETS.USERS, r => String(r.user_id).indexOf('TEST-T6') === 0);
  }

  finish();
}

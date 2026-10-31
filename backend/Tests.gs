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

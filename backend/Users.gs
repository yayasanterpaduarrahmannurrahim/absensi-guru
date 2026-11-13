/**
 * Users.gs — Manajemen akun guru & admin (khusus admin).
 * Setiap perubahan dicatat di AUDIT_LOG beserta data sebelum dan sesudah.
 */

/**
 * Peran disimpan di kolom "role" sebagai daftar dipisah koma, mis. 'guru' atau 'guru,admin'.
 * Data lama berisi satu peran tetap terbaca apa adanya.
 */
function parseRoles_(role) {
  const all = [ROLES.GURU, ROLES.ADMIN];
  const list = String(role || '').split(',').map(r => r.trim().toLowerCase());
  return all.filter(r => list.indexOf(r) >= 0); // urutan tetap: guru, admin
}

function hasRole_(user, role) {
  return !!user && parseRoles_(user.role).indexOf(role) >= 0;
}

/** Bentuk data pengguna yang boleh dikirim ke frontend. */
function publicUser_(u) {
  return {
    userId: u.user_id,
    nama: u.nama_guru,
    email: u.email,
    nip: u.nip,
    jenjang: u.jenjang,
    sifSabtu: u.sif_sabtu || '',
    roles: parseRoles_(u.role),
    // Peran utama untuk tampilan lama: admin bila memiliki hak admin.
    role: hasRole_(u, ROLES.ADMIN) ? ROLES.ADMIN : ROLES.GURU,
    statusAkun: u.status_akun,
    lastLogin: u.last_login,
    createdAt: u.created_at,
  };
}

/** Validasi daftar peran: "roles" (array) atau "role" (satu peran, format lama). Minimal satu. */
function validateRoles_(p) {
  const raw = Array.isArray(p.roles) ? p.roles : (p.role === undefined || p.role === null || p.role === '' ? [] : [p.role]);
  const roles = raw.map(r => vEnum_(r, 'Peran', [ROLES.ADMIN, ROLES.GURU], { required: true }));
  const clean = parseRoles_(roles.join(','));
  if (!clean.length) throw new AppError('VALIDATION', 'Pilih minimal satu peran (Guru dan/atau Admin).');
  return clean;
}

/** Validasi field profil pengguna dari payload admin. */
function validateUserInput_(p) {
  const roles = validateRoles_(p);
  const isGuru = roles.indexOf(ROLES.GURU) >= 0;
  return {
    nama_guru: vString_(p.nama, 'Nama', { required: true, min: 2, max: 100 }),
    email: vEmail_(p.email, 'Email'),
    nip: vString_(p.nip, 'NIP', { max: 30, pattern: /^[0-9 .\-]+$/, patternMessage: 'NIP hanya boleh berisi angka.' }),
    jenjang: vEnum_(p.jenjang, 'Jenjang', [JENJANG.TK, JENJANG.SD], { required: isGuru }),
    sif_sabtu: vEnum_(p.sifSabtu, 'Sif Sabtu', [SIF_SABTU.A, SIF_SABTU.B, SIF_SABTU.LIBUR], {}),
    role: roles.join(','),
  };
}

/** Melempar error bila tidak ada admin aktif lain selain excludeUserId. */
function ensureAnotherAdmin_(excludeUserId) {
  const others = readAll_(SHEETS.USERS).filter(u =>
    u.user_id !== excludeUserId && hasRole_(u, ROLES.ADMIN) && u.status_akun === STATUS_AKUN.AKTIF);
  if (!others.length) {
    throw new AppError('LAST_ADMIN', 'Harus ada minimal satu admin aktif.');
  }
}

function apiAdminListUsers_() {
  return readAll_(SHEETS.USERS)
    .map(publicUser_)
    .sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
}

function apiAdminCreateUser_(p, ctx) {
  const data = validateUserInput_(p);
  return withLock_(() => {
    if (findOneBy_(SHEETS.USERS, 'email', data.email)) {
      throw new AppError('DUPLICATE', 'Email ' + data.email + ' sudah terdaftar.');
    }
    const now = nowWib_().waktu;
    const rec = insertRow_(SHEETS.USERS, Object.assign({
      user_id: generateId_('USR'),
      status_akun: STATUS_AKUN.AKTIF,
      created_at: now,
      updated_at: now,
      last_login: '',
    }, data));
    logAudit_(ctx.session.user.user_id, 'TAMBAH_PENGGUNA', publicUser_(rec));
    return publicUser_(rec);
  });
}

function apiAdminUpdateUser_(p, ctx) {
  const userId = vString_(p.userId, 'ID pengguna', { required: true, max: 40 });
  const data = validateUserInput_(p);
  const status = vEnum_(p.statusAkun, 'Status akun', [STATUS_AKUN.AKTIF, STATUS_AKUN.NONAKTIF], { required: true });
  const actorId = ctx.session.user.user_id;

  return withLock_(() => {
    const before = findByKey_(SHEETS.USERS, userId);
    if (!before) throw new AppError('NOT_FOUND', 'Pengguna tidak ditemukan.');
    const dup = findOneBy_(SHEETS.USERS, 'email', data.email);
    if (dup && dup.user_id !== userId) {
      throw new AppError('DUPLICATE', 'Email ' + data.email + ' sudah dipakai pengguna lain.');
    }

    const wasActiveAdmin = hasRole_(before, ROLES.ADMIN) && before.status_akun === STATUS_AKUN.AKTIF;
    const staysActiveAdmin = hasRole_(data, ROLES.ADMIN) && status === STATUS_AKUN.AKTIF;
    if (wasActiveAdmin && !staysActiveAdmin) {
      if (userId === actorId) {
        throw new AppError('FORBIDDEN_SELF', 'Anda tidak dapat mencabut hak admin atau menonaktifkan akun Anda sendiri.');
      }
      ensureAnotherAdmin_(userId);
    }

    const after = updateByKey_(SHEETS.USERS, userId,
      Object.assign({}, data, { status_akun: status, updated_at: nowWib_().waktu }));
    if (status !== STATUS_AKUN.AKTIF || before.email !== after.email) deleteSessionsForUser_(userId);

    logAudit_(actorId, 'UBAH_PENGGUNA', {
      user_id: userId,
      sebelum: publicUser_(before),
      sesudah: publicUser_(after),
    });
    return publicUser_(after);
  });
}

function apiAdminDeleteUser_(p, ctx) {
  const userId = vString_(p.userId, 'ID pengguna', { required: true, max: 40 });
  const actorId = ctx.session.user.user_id;
  if (userId === actorId) {
    throw new AppError('FORBIDDEN_SELF', 'Anda tidak dapat menghapus akun Anda sendiri.');
  }
  return withLock_(() => {
    const before = findByKey_(SHEETS.USERS, userId);
    if (!before) throw new AppError('NOT_FOUND', 'Pengguna tidak ditemukan.');
    if (hasRole_(before, ROLES.ADMIN) && before.status_akun === STATUS_AKUN.AKTIF) ensureAnotherAdmin_(userId);
    deleteSessionsForUser_(userId);
    deleteByKey_(SHEETS.USERS, userId);
    logAudit_(actorId, 'HAPUS_PENGGUNA', publicUser_(before));
    return { deleted: true, userId: userId };
  });
}

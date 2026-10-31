/**
 * Setup.gs — Membuat / memperbarui struktur database Google Sheets.
 *
 * Jalankan setup() SEKALI dari editor Apps Script (pilih fungsi `setup` > Run).
 * Aman dijalankan ulang (idempotent):
 * - spreadsheet dibuat hanya jika SPREADSHEET_ID belum ada di Script Properties;
 * - sheet/kolom yang hilang ditambahkan, data lama tidak dihapus;
 * - pengaturan default hanya ditambahkan bila key belum ada;
 * - admin pertama (akun Google yang menjalankan setup) dibuat bila belum ada admin aktif.
 */

function setup() {
  withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    const existingId = props.getProperty(APP.PROP_SPREADSHEET_ID);
    let ss;
    let created = false;

    if (existingId) {
      ss = SpreadsheetApp.openById(existingId);
    } else {
      ss = SpreadsheetApp.create('Database Absensi Guru');
      props.setProperty(APP.PROP_SPREADSHEET_ID, ss.getId());
      created = true;
    }
    ss.setSpreadsheetTimeZone(APP.TIMEZONE);
    resetDbCache_();

    Object.keys(SCHEMA).forEach(name => ensureSheet_(ss, name, SCHEMA[name]));

    if (created) {
      // Hapus sheet bawaan kosong ("Sheet1"/"Lembar1").
      ss.getSheets()
        .filter(sh => !SCHEMA[sh.getName()] && sh.getLastRow() === 0)
        .forEach(sh => ss.deleteSheet(sh));
    }

    resetDbCache_();
    const addedSettings = seedSettings_();
    invalidateSettingsCache_();
    const admin = seedAdmin_();

    logAudit_('SYSTEM', 'SETUP', {
      spreadsheet_baru: created,
      settings_ditambahkan: addedSettings,
      admin_dibuat: admin ? admin.email : null,
    });

    console.log('Setup selesai.');
    console.log('Spreadsheet: ' + ss.getUrl());
    if (admin) console.log('Admin pertama dibuat: ' + admin.email);
  });
}

/**
 * Meminta ulang SEMUA izin yang tercantum di appsscript.json.
 * Jalankan dari editor bila ada izin yang terlewat (Google memakai izin per item,
 * sehingga script bisa berjalan walau sebagian izin tidak dicentang).
 * Web App berjalan atas nama pemilik, jadi tanpa izin lengkap login guru akan gagal.
 */
function authorize() {
  if (typeof ScriptApp.requireAllScopes === 'function') {
    ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  }
  // Pemanggilan langsung (tanpa try/catch) agar editor memunculkan dialog izin bila belum diberikan.
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=cek-izin', { muteHttpExceptions: true });
  SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(APP.PROP_SPREADSHEET_ID));
  DriveApp.getRootFolder();
  ScriptApp.getProjectTriggers();
  console.log('Semua izin sudah diberikan: ' + Session.getEffectiveUser().getEmail());
}

/** Memastikan sheet ada, header lengkap, format kolom benar, dan header bergaya. */
function ensureSheet_(ss, name, schema) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);

  const lastCol = sh.getLastColumn();
  const existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = schema.columns.filter(c => existing.indexOf(c) < 0);
  const headers = existing.concat(missing);

  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  if (missing.length) {
    sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  if (sh.getMaxColumns() > headers.length) {
    sh.deleteColumns(headers.length + 1, sh.getMaxColumns() - headers.length);
  }

  const dataRows = sh.getMaxRows() - 1;
  if (dataRows > 0) {
    headers.forEach((h, i) => {
      const fmt = (schema.formats && schema.formats[h]) || '@';
      sh.getRange(2, i + 1, dataRows, 1).setNumberFormat(fmt);
    });
  }

  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#15803d');
  sh.setFrozenRows(1);
  return sh;
}

/** Menambahkan pengaturan default yang belum ada. Mengembalikan daftar key yang ditambahkan. */
function seedSettings_() {
  const existing = readAll_(SHEETS.SETTINGS).map(r => String(r.key));
  const added = [];
  DEFAULT_SETTINGS.forEach(([key, value, keterangan]) => {
    if (existing.indexOf(key) < 0) {
      insertRow_(SHEETS.SETTINGS, { key: key, value: value, keterangan: keterangan });
      added.push(key);
    }
  });
  return added;
}

/**
 * Membuat admin pertama dari akun Google yang menjalankan setup(),
 * hanya bila belum ada admin aktif. Mengembalikan record admin baru atau null.
 */
function seedAdmin_() {
  const hasAdmin = readAll_(SHEETS.USERS)
    .some(u => u.role === ROLES.ADMIN && u.status_akun === STATUS_AKUN.AKTIF);
  if (hasAdmin) return null;

  const email = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) throw new Error('Email akun Google pemilik tidak terbaca. Jalankan setup() dari editor Apps Script.');

  const now = nowWib_().waktu;
  return insertRow_(SHEETS.USERS, {
    user_id: generateId_('USR'),
    nama_guru: 'Administrator',
    email: email,
    nip: '',
    jenjang: '',
    role: ROLES.ADMIN,
    status_akun: STATUS_AKUN.AKTIF,
    created_at: now,
    updated_at: now,
    last_login: '',
  });
}

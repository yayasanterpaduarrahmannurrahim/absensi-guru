/**
 * Db.gs — Lapisan akses data Google Sheets.
 *
 * Setiap sheet diperlakukan sebagai tabel: baris 1 = header, baris 2 dst = data.
 * Kolom dipetakan berdasarkan header aktual, sehingga menambah kolom baru tidak
 * merusak data lama. Setiap objek hasil baca memiliki properti `_row` (nomor baris).
 */

let dbCache_ = null; // cache per eksekusi: { ss, sheets: {}, headers: {} }

function getSpreadsheet_() {
  if (dbCache_) return dbCache_.ss;
  const id = PropertiesService.getScriptProperties().getProperty(APP.PROP_SPREADSHEET_ID);
  if (!id) throw new Error('SPREADSHEET_ID belum dikonfigurasi. Jalankan setup() terlebih dahulu.');
  dbCache_ = { ss: SpreadsheetApp.openById(id), sheets: {}, headers: {} };
  return dbCache_.ss;
}

/** Dipanggil setelah struktur sheet berubah (setup/test). */
function resetDbCache_() {
  dbCache_ = null;
}

function getSheet_(name) {
  const ss = getSpreadsheet_();
  if (!dbCache_.sheets[name]) {
    const sh = ss.getSheetByName(name);
    if (!sh) throw new Error('Sheet ' + name + ' tidak ditemukan. Jalankan setup().');
    dbCache_.sheets[name] = sh;
  }
  return dbCache_.sheets[name];
}

function getHeaders_(name) {
  const sh = getSheet_(name);
  if (!dbCache_.headers[name]) {
    dbCache_.headers[name] = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  }
  return dbCache_.headers[name];
}

function rowToObject_(headers, values, rowNumber) {
  const obj = { _row: rowNumber };
  headers.forEach((h, i) => { if (h) obj[h] = values[i]; });
  return obj;
}

/**
 * Mengubah nilai JS menjadi nilai sel yang aman:
 * - kolom angka: Number atau '' bila kosong/tidak valid;
 * - kolom teks : String, dengan awalan apostrof bila diawali = + - @
 *   agar tidak dieksekusi sebagai rumus (formula injection).
 */
function toCell_(value, isNumeric) {
  if (value === undefined || value === null) return '';
  if (isNumeric) {
    if (value === '') return '';
    const n = Number(value);
    return isFinite(n) ? n : '';
  }
  const s = value instanceof Date ? fmtWib_(value, 'yyyy-MM-dd HH:mm:ss') : String(value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function columnFormat_(name, header) {
  const schema = SCHEMA[name];
  return (schema && schema.formats && schema.formats[header]) || '@';
}

function keyColumn_(name) {
  const schema = SCHEMA[name];
  if (!schema || !schema.key) throw new Error('Skema/key untuk sheet ' + name + ' tidak ada.');
  return schema.key;
}

/** Membaca seluruh baris data sebagai array objek. */
function readAll_(name) {
  const sh = getSheet_(name);
  const headers = getHeaders_(name);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  return sh.getRange(2, 1, lastRow - 1, headers.length).getValues()
    .map((v, i) => rowToObject_(headers, v, i + 2));
}

/** Membaca `n` baris data terakhir (baris terbaru di akhir array). */
function readTail_(name, n) {
  const sh = getSheet_(name);
  const headers = getHeaders_(name);
  const lastRow = sh.getLastRow();
  if (lastRow < 2 || n <= 0) return [];
  const count = Math.min(n, lastRow - 1);
  const first = lastRow - count + 1;
  return sh.getRange(first, 1, count, headers.length).getValues()
    .map((v, i) => rowToObject_(headers, v, first + i));
}

/**
 * Mencari baris dengan nilai persis pada satu kolom. Memakai TextFinder
 * sehingga tetap cepat ketika sheet ABSENSI sudah berisi puluhan ribu baris.
 */
function findRowsBy_(name, column, value) {
  const sh = getSheet_(name);
  const headers = getHeaders_(name);
  const col = headers.indexOf(column);
  if (col < 0) throw new Error('Kolom ' + column + ' tidak ada di sheet ' + name);
  const lastRow = sh.getLastRow();
  if (lastRow < 2 || value === '' || value === null || value === undefined) return [];
  const rowNumbers = sh.getRange(2, col + 1, lastRow - 1, 1)
    .createTextFinder(String(value))
    .matchEntireCell(true)
    .matchCase(true)
    .findAll()
    .map(c => c.getRow());
  // Sedikit hasil: baca per baris. Banyak hasil (mis. riwayat satu guru): baca sekali lalu saring.
  if (rowNumbers.length <= 10) {
    return rowNumbers.map(r => rowToObject_(headers, sh.getRange(r, 1, 1, headers.length).getValues()[0], r));
  }
  const first = rowNumbers[0];
  const last = rowNumbers[rowNumbers.length - 1];
  const block = sh.getRange(first, 1, last - first + 1, headers.length).getValues();
  return rowNumbers.map(r => rowToObject_(headers, block[r - first], r));
}

function findOneBy_(name, column, value) {
  const rows = findRowsBy_(name, column, value);
  return rows.length ? rows[0] : null;
}

function findByKey_(name, keyValue) {
  return findOneBy_(name, keyColumn_(name), keyValue);
}

/**
 * Menambahkan satu baris. Mengembalikan record beserta `_row`.
 * Memakai appendRow (atomik di server) agar tidak pernah menimpa baris yang baru saja
 * ditulis eksekusi lain; posisi baris lalu dicari ulang dengan TextFinder (selalu data terbaru)
 * dan isinya ditulis ulang dengan format kolom yang benar (tanggal/jam tetap teks).
 */
function insertRow_(name, record) {
  return withLock_(() => {
    const sh = getSheet_(name);
    const headers = getHeaders_(name);
    const key = keyColumn_(name);
    const keyCol = headers.indexOf(key);
    const formats = headers.map(h => columnFormat_(name, h));
    const values = headers.map((h, i) => toCell_(record[h], formats[i] !== '@'));
    sh.appendRow(values);
    const hits = sh.getRange(1, keyCol + 1, sh.getMaxRows(), 1)
      .createTextFinder(String(record[key])).matchEntireCell(true).matchCase(true).findAll();
    const row = hits.length ? hits[hits.length - 1].getRow() : sh.getLastRow();
    const range = sh.getRange(row, 1, 1, headers.length);
    range.setNumberFormats([formats]);
    range.setValues([values]);
    return Object.assign({}, record, { _row: row });
  });
}

/**
 * Memperbarui kolom-kolom pada baris dengan key tertentu. Hanya sel yang ada di `patch`
 * yang ditulis, sehingga nilai lama hasil cache tidak pernah menimpa kolom lain.
 * Pencarian dan penulisan berada dalam lock yang sama. Melempar NOT_FOUND bila key tidak ada.
 */
function updateByKey_(name, keyValue, patch) {
  return withLock_(() => {
    const current = findByKey_(name, keyValue);
    if (!current) throw new AppError('NOT_FOUND', 'Data tidak ditemukan.');
    if (name === SHEETS.USERS) invalidateUserCache_(keyValue);
    const sh = getSheet_(name);
    const headers = getHeaders_(name);
    const key = keyColumn_(name);
    Object.keys(patch).forEach(h => {
      const c = headers.indexOf(h);
      if (h === key || c < 0) return;
      const fmt = columnFormat_(name, h);
      sh.getRange(current._row, c + 1).setNumberFormat(fmt).setValue(toCell_(patch[h], fmt !== '@'));
    });
    if (name === SHEETS.USERS) {
      SpreadsheetApp.flush();
      invalidateUserCache_(keyValue); // sekali lagi setelah tertulis, menutup celah balapan
    }
    return Object.assign({}, current, patch, { [key]: current[key] });
  });
}

/** Menghapus semua baris yang memenuhi predicate. Mengembalikan record yang dihapus. */
function deleteRowsWhere_(name, predicate) {
  return withLock_(() => {
    const rows = readAll_(name).filter(predicate);
    if (name === SHEETS.USERS) rows.forEach(r => invalidateUserCache_(r.user_id));
    const sh = getSheet_(name);
    // Hapus dari bawah agar nomor baris di atasnya tidak bergeser; baris berurutan dihapus sekaligus.
    const nums = rows.map(r => r._row).sort((a, b) => b - a);
    for (let i = 0; i < nums.length;) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] - 1) j++;
      sh.deleteRows(nums[j], j - i + 1);
      i = j + 1;
    }
    return rows;
  });
}

/** Menghapus baris dengan key tertentu. Mengembalikan record yang dihapus. */
function deleteByKey_(name, keyValue) {
  return withLock_(() => {
    const current = findByKey_(name, keyValue);
    if (!current) throw new AppError('NOT_FOUND', 'Data tidak ditemukan.');
    getSheet_(name).deleteRow(current._row);
    if (name === SHEETS.USERS) invalidateUserCache_(keyValue);
    return current;
  });
}

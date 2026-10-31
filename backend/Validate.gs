/**
 * Validate.gs — Validasi input dari frontend.
 * Semua input dianggap tidak tepercaya dan diperiksa ulang di sini.
 */

/**
 * Validasi string. opts: { required, min, max, pattern, patternMessage }.
 * Mengembalikan string yang sudah di-trim ('' bila kosong dan tidak wajib).
 */
function vString_(value, label, opts) {
  const o = opts || {};
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (!s) {
    if (o.required) throw new AppError('VALIDATION', label + ' wajib diisi.');
    return '';
  }
  if (o.min && s.length < o.min) throw new AppError('VALIDATION', label + ' minimal ' + o.min + ' karakter.');
  if (o.max && s.length > o.max) throw new AppError('VALIDATION', label + ' maksimal ' + o.max + ' karakter.');
  if (o.pattern && !o.pattern.test(s)) throw new AppError('VALIDATION', o.patternMessage || label + ' tidak valid.');
  return s;
}

/** Validasi nilai yang harus salah satu dari `allowed`. */
function vEnum_(value, label, allowed, opts) {
  const s = vString_(value, label, opts);
  if (s && allowed.indexOf(s) < 0) throw new AppError('VALIDATION', label + ' tidak valid.');
  return s;
}

/** Validasi email; hasil selalu huruf kecil. */
function vEmail_(value, label) {
  return vString_(value, label, {
    required: true,
    max: 254,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    patternMessage: 'Format email tidak valid.',
  }).toLowerCase();
}

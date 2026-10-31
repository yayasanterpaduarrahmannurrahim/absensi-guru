/**
 * Settings.gs — Membaca pengaturan sekolah dari sheet SETTINGS (key-value).
 * Hasil dicache 5 menit di CacheService agar tidak membaca sheet setiap request.
 */

const SETTINGS_CACHE_KEY = 'settings_v1';
const SETTINGS_CACHE_SECONDS = 300;

/** Semua pengaturan sebagai objek { key: value(string) }. */
function getSettings_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(SETTINGS_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const map = {};
  readAll_(SHEETS.SETTINGS).forEach(r => {
    if (r.key) map[String(r.key)] = String(r.value);
  });
  cache.put(SETTINGS_CACHE_KEY, JSON.stringify(map), SETTINGS_CACHE_SECONDS);
  return map;
}

function invalidateSettingsCache_() {
  CacheService.getScriptCache().remove(SETTINGS_CACHE_KEY);
}

/**
 * Menyimpan beberapa pengaturan sekaligus ({ key: value }). Key baru ditambahkan.
 * Mengembalikan nilai sebelum perubahan (untuk audit log).
 */
function setSettings_(values) {
  return withLock_(() => {
    const before = {};
    Object.keys(values).forEach(key => {
      const row = findByKey_(SHEETS.SETTINGS, key);
      before[key] = row ? String(row.value) : null;
      if (row) updateByKey_(SHEETS.SETTINGS, key, { value: String(values[key]) });
      else insertRow_(SHEETS.SETTINGS, { key: key, value: String(values[key]), keterangan: '' });
    });
    invalidateSettingsCache_();
    return before;
  });
}

/** Nilai pengaturan bertipe angka; null bila kosong atau tidak valid. */
function getSettingNumber_(key) {
  const raw = getSettings_()[key];
  if (raw === undefined || String(raw).trim() === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  return isFinite(n) ? n : null;
}

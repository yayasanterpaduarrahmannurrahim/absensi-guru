/**
 * geo.js — Pembacaan GPS di browser (Geolocation API) dan perhitungan jarak.
 *
 * Perhitungan di sini HANYA untuk tampilan real-time. Server selalu menghitung
 * ulang jarak dan memutuskan sah/tidaknya lokasi sebelum absensi disimpan.
 */
const Geo = (() => {
  const EARTH_RADIUS_M = 6371008.8;
  const OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
  const ERROR_STATUS = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };

  /** Jarak dua koordinat dalam meter (Haversine), sama dengan rumus di backend. */
  function distance(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function supported() {
    return 'geolocation' in navigator && window.isSecureContext;
  }

  /**
   * Memantau lokasi terus-menerus.
   * onUpdate menerima { status, coords?, samples? } dengan status:
   * 'locating' | 'ok' | 'denied' | 'unavailable' | 'timeout' | 'unsupported'.
   * `samples` = hingga 10 pembacaan terakhir; `t` memakai waktu relatif (performance.now),
   * sehingga tidak terpengaruh jam HP yang diubah. Mengembalikan fungsi untuk berhenti.
   */
  function watch(onUpdate) {
    if (!supported()) {
      onUpdate({ status: 'unsupported' });
      return () => {};
    }
    const samples = [];
    const t0 = performance.now();
    onUpdate({ status: 'locating' });
    const id = navigator.geolocation.watchPosition(pos => {
      const c = pos.coords;
      samples.push({ lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, t: Math.round(performance.now() - t0) });
      if (samples.length > 10) samples.shift();
      onUpdate({
        status: 'ok',
        coords: { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy },
        samples: samples.slice(),
      });
    }, err => {
      // Setelah sempat mendapat lokasi, timeout sesaat tidak mengubah tampilan.
      if (err.code === 3 && samples.length) return;
      onUpdate({ status: ERROR_STATUS[err.code] || 'unavailable' });
    }, OPTIONS);
    return () => navigator.geolocation.clearWatch(id);
  }

  /**
   * Mengambil lokasi terbaik dalam `durationMs` (berhenti lebih awal bila akurasi
   * sudah ≤ targetAccuracy). Dipakai admin saat menentukan titik sekolah.
   */
  function bestPosition(durationMs, targetAccuracy) {
    return new Promise((resolve, reject) => {
      if (!supported()) return reject(Object.assign(new Error('unsupported'), { status: 'unsupported' }));
      let best = null;
      const done = () => {
        navigator.geolocation.clearWatch(id);
        clearTimeout(timer);
        if (best) resolve(best);
        else reject(Object.assign(new Error('timeout'), { status: 'timeout' }));
      };
      const id = navigator.geolocation.watchPosition(pos => {
        const c = pos.coords;
        if (!best || c.accuracy < best.accuracy) best = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy };
        if (best.accuracy <= targetAccuracy) done();
      }, err => {
        if (err.code === 3) return; // tunggu sampai batas waktu
        navigator.geolocation.clearWatch(id);
        clearTimeout(timer);
        reject(Object.assign(new Error(err.message), { status: ERROR_STATUS[err.code] || 'unavailable' }));
      }, OPTIONS);
      const timer = setTimeout(done, durationMs);
    });
  }

  return { distance, watch, bestPosition, supported };
})();

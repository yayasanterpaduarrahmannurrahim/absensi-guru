/**
 * Geo.gs — Validasi lokasi GPS di sisi server.
 *
 * Frontend menghitung jarak hanya untuk tampilan real-time. Keputusan sah/tidaknya
 * lokasi selalu dihitung ulang di sini sebelum data absensi disimpan.
 *
 * Catatan jujur: GPS browser TIDAK kebal terhadap aplikasi pemalsu lokasi (fake GPS).
 * detectLocationAnomalies_() hanya mendeteksi pola yang mencurigakan dan mencatatnya
 * untuk ditinjau admin; tidak ada jaminan 100%.
 */

const EARTH_RADIUS_M = 6371008.8;

/** Jarak dua koordinat dalam meter (rumus Haversine). */
function haversineMeters_(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.pow(Math.sin(dLat / 2), 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.pow(Math.sin(dLon / 2), 2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function round1_(n) {
  return Math.round(n * 10) / 10;
}

/** Jumlah digit desimal sebuah angka (untuk mendeteksi koordinat yang diketik manual). */
function decimalPlaces_(n) {
  const s = String(n);
  if (/e/i.test(s)) return 10;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** Konfigurasi lokasi sekolah. Melempar LOCATION_NOT_CONFIGURED bila koordinat belum diisi. */
function getSchoolLocation_() {
  const lat = getSettingNumber_('school_latitude');
  const lng = getSettingNumber_('school_longitude');
  if (lat === null || lng === null) {
    throw new AppError('LOCATION_NOT_CONFIGURED', 'Titik lokasi sekolah belum diatur oleh admin.');
  }
  return {
    lat: lat,
    lng: lng,
    radius: getSettingNumber_('radius_meter') || 50,
    maxAccuracy: getSettingNumber_('max_accuracy_meter') || 30,
  };
}

/**
 * Validasi payload lokasi dari frontend:
 * { latitude, longitude, accuracy, samples: [{ lat, lng, accuracy, t }] }
 * `samples` = beberapa pembacaan GPS terakhir; `t` = milidetik sejak pemantauan dimulai
 * (waktu relatif, sehingga tidak terpengaruh jam HP yang diubah).
 */
function readLocationInput_(p) {
  const input = {
    lat: vNumber_(p.latitude, 'Latitude', -90, 90),
    lng: vNumber_(p.longitude, 'Longitude', -180, 180),
    accuracy: vNumber_(p.accuracy, 'Akurasi GPS', 0, 100000),
    samples: [],
  };
  if (Array.isArray(p.samples)) {
    input.samples = p.samples.slice(-10).map(s => ({
      lat: vNumber_(s && s.lat, 'Latitude sampel', -90, 90),
      lng: vNumber_(s && s.lng, 'Longitude sampel', -180, 180),
      accuracy: vNumber_(s && s.accuracy, 'Akurasi sampel', 0, 100000),
      t: vNumber_(s && s.t, 'Waktu sampel', 0, 24 * 3600 * 1000),
    }));
  }
  return input;
}

/**
 * Mendeteksi pola lokasi yang mencurigakan. Hasil berupa daftar keterangan singkat
 * yang dicatat di kolom `anomali`; tidak memblokir absensi.
 */
function detectLocationAnomalies_(input) {
  const anomalies = [];

  if (input.accuracy <= 1) {
    anomalies.push('Akurasi GPS tidak wajar (' + input.accuracy + ' m)');
  }
  if (decimalPlaces_(input.lat) < 5 || decimalPlaces_(input.lng) < 5) {
    anomalies.push('Koordinat berpresisi rendah (kemungkinan diisi manual)');
  }

  const s = input.samples;
  if (s.length >= 3 && s.every(x => x.lat === s[0].lat && x.lng === s[0].lng && x.accuracy === s[0].accuracy)) {
    anomalies.push('Beberapa pembacaan GPS identik sempurna (pola lokasi palsu)');
  }
  for (let i = 1; i < s.length; i++) {
    const dist = haversineMeters_(s[i - 1].lat, s[i - 1].lng, s[i].lat, s[i].lng);
    const dtSec = Math.max((s[i].t - s[i - 1].t) / 1000, 0.5);
    const tolerance = s[i - 1].accuracy + s[i].accuracy + 50;
    // Lebih dari 180 km/jam di luar batas ketidakpastian GPS = lompatan mustahil.
    if (dist > tolerance && dist / dtSec > 50) {
      anomalies.push('Lompatan lokasi tidak wajar (' + Math.round(dist) + ' m dalam ' + dtSec.toFixed(1) + ' detik)');
      break;
    }
  }
  if (s.length) {
    const last = s[s.length - 1];
    if (haversineMeters_(last.lat, last.lng, input.lat, input.lng) > last.accuracy + input.accuracy + 50) {
      anomalies.push('Lokasi yang dikirim berbeda jauh dari pembacaan GPS terakhir');
    }
  }
  return anomalies;
}

/** Menilai lokasi terhadap titik sekolah. */
function analyzeLocation_(input, school) {
  const distance = haversineMeters_(school.lat, school.lng, input.lat, input.lng);
  const accuracyOk = input.accuracy <= school.maxAccuracy;
  const withinRadius = distance <= school.radius;
  const d = Math.round(distance);

  let message;
  if (!accuracyOk) {
    message = 'Akurasi GPS ±' + Math.round(input.accuracy) + ' m terlalu rendah (maksimal ' + school.maxAccuracy +
      ' m). Pindah ke area terbuka, tunggu beberapa detik, lalu perbarui lokasi.';
  } else if (!withinRadius) {
    message = 'Anda berada ' + d + ' m dari sekolah. Absensi hanya dapat dilakukan dalam radius ' + school.radius + ' m.';
  } else {
    message = 'Lokasi valid. Anda berada ' + d + ' m dari titik sekolah.';
  }

  return {
    valid: accuracyOk && withinRadius,
    withinRadius: withinRadius,
    accuracyOk: accuracyOk,
    distance: round1_(distance),
    accuracy: round1_(input.accuracy),
    radius: school.radius,
    maxAccuracy: school.maxAccuracy,
    message: message,
    anomalies: detectLocationAnomalies_(input),
  };
}

/** Validasi pengaturan lokasi dari admin. */
function validateLocationSettings_(p) {
  const lat = vNumber_(p.latitude, 'Latitude', -90, 90);
  const lng = vNumber_(p.longitude, 'Longitude', -180, 180);
  if (decimalPlaces_(lat) < 5 || decimalPlaces_(lng) < 5) {
    throw new AppError('VALIDATION', 'Koordinat minimal 5 angka di belakang titik agar akurat (contoh -6.2088123).');
  }
  return {
    school_latitude: lat.toFixed(7),
    school_longitude: lng.toFixed(7),
    radius_meter: String(Math.round(vNumber_(p.radius, 'Radius', 10, 200))),
    max_accuracy_meter: String(Math.round(vNumber_(p.maxAccuracy, 'Batas akurasi GPS', 5, 200))),
  };
}

/* ---------- Handler API ---------- */

/** Konfigurasi lokasi untuk pengguna yang sudah login (dipakai tampilan jarak real-time). */
function apiGetLocationConfig_() {
  try {
    return Object.assign({ configured: true }, getSchoolLocation_());
  } catch (err) {
    if (err.code !== 'LOCATION_NOT_CONFIGURED') throw err;
    return {
      configured: false,
      radius: getSettingNumber_('radius_meter') || 50,
      maxAccuracy: getSettingNumber_('max_accuracy_meter') || 30,
    };
  }
}

/**
 * Verifikasi lokasi oleh server tanpa menyimpan absensi.
 * Daftar anomali tidak dikirim ke pengguna (hanya dicatat saat absensi disimpan).
 */
function apiCheckLocation_(payload) {
  const result = analyzeLocation_(readLocationInput_(payload), getSchoolLocation_());
  delete result.anomalies;
  return result;
}

function apiAdminUpdateLocation_(payload, ctx) {
  const values = validateLocationSettings_(payload);
  const before = setSettings_(values);
  logAudit_(ctx.session.user.user_id, 'UBAH_LOKASI_SEKOLAH', { sebelum: before, sesudah: values });
  return apiGetLocationConfig_();
}

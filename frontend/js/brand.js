/**
 * brand.js — Identitas visual: logo aplikasi dan ilustrasi (SVG inline, tanpa unduhan gambar).
 */
const Brand = (() => {
  let uid = 0;

  /** Logo: pin lokasi dengan tanda centang di atas kotak hijau membulat. */
  function logo(size) {
    const id = 'lg' + (++uid);
    return `
      <svg class="brand-logo" width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="Logo Absensi Guru">
        <defs>
          <linearGradient id="${id}" x1="6" y1="4" x2="42" y2="46" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#1a9e66"/><stop offset="1" stop-color="#065238"/>
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="13" fill="url(#${id})"/>
        <path d="M24 9.5c-6.4 0-11.5 5-11.5 11.3 0 7.9 9.6 16.3 10.6 17.1.5.4 1.3.4 1.8 0 1-.8 10.6-9.2 10.6-17.1 0-6.3-5.1-11.3-11.5-11.3z" fill="#fff"/>
        <path d="M18.8 20.9l3.6 3.6 7-7" fill="none" stroke="#0a7a4f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <ellipse cx="24" cy="40.6" rx="7" ry="1.6" fill="#fff" opacity=".35"/>
      </svg>`;
  }

  /** Ilustrasi halaman login: gedung sekolah, pepohonan, dan pin lokasi dengan radius absensi. */
  function schoolScene() {
    return `
      <svg class="scene" viewBox="0 0 360 230" role="img" aria-label="Ilustrasi sekolah dengan titik lokasi absensi">
        <ellipse cx="180" cy="206" rx="170" ry="20" fill="#cfe9dc"/>
        <ellipse cx="180" cy="204" rx="118" ry="13" fill="none" stroke="#0f7d53" stroke-width="1.6" stroke-dasharray="5 6" opacity=".55"/>
        <!-- pohon kiri -->
        <rect x="46" y="150" width="6" height="48" rx="3" fill="#7a5a3a"/>
        <circle cx="49" cy="140" r="22" fill="#2f9e6c"/>
        <circle cx="37" cy="152" r="14" fill="#23885b"/>
        <!-- pohon kanan -->
        <rect x="306" y="156" width="6" height="42" rx="3" fill="#7a5a3a"/>
        <circle cx="309" cy="146" r="19" fill="#2f9e6c"/>
        <circle cx="321" cy="157" r="12" fill="#23885b"/>
        <!-- gedung -->
        <rect x="88" y="120" width="184" height="80" rx="4" fill="#ffffff"/>
        <rect x="88" y="120" width="184" height="9" fill="#e7f4ed"/>
        <path d="M80 122 L180 82 L280 122 Z" fill="#0a6b47"/>
        <rect x="150" y="96" width="60" height="104" rx="3" fill="#f7fbf9"/>
        <path d="M144 99 L180 74 L216 99 Z" fill="#075c3d"/>
        <circle cx="180" cy="114" r="9" fill="#ffffff" stroke="#0a6b47" stroke-width="2"/>
        <path d="M180 108v6l4 2" fill="none" stroke="#0a6b47" stroke-width="1.8" stroke-linecap="round"/>
        <rect x="168" y="158" width="24" height="42" rx="12" fill="#0f7d53"/>
        <g fill="#cdebdc">
          <rect x="102" y="138" width="18" height="16" rx="2"/><rect x="126" y="138" width="18" height="16" rx="2"/>
          <rect x="102" y="166" width="18" height="16" rx="2"/><rect x="126" y="166" width="18" height="16" rx="2"/>
          <rect x="216" y="138" width="18" height="16" rx="2"/><rect x="240" y="138" width="18" height="16" rx="2"/>
          <rect x="216" y="166" width="18" height="16" rx="2"/><rect x="240" y="166" width="18" height="16" rx="2"/>
          <rect x="158" y="132" width="16" height="16" rx="2"/><rect x="186" y="132" width="16" height="16" rx="2"/>
        </g>
        <!-- tiang bendera -->
        <rect x="179" y="48" width="2" height="28" fill="#5d6b64"/>
        <rect x="181" y="49" width="16" height="6" fill="#d93a3a"/><rect x="181" y="55" width="16" height="6" fill="#ffffff"/>
        <!-- pin lokasi -->
        <g transform="translate(250 40)">
          <ellipse cx="18" cy="56" rx="9" ry="2.6" fill="#0f7d53" opacity=".25"/>
          <path d="M18 0C8.6 0 1 7.4 1 16.6 1 28.2 15.1 40.6 16.6 41.8c.8.6 2 .6 2.8 0C20.9 40.6 35 28.2 35 16.6 35 7.4 27.4 0 18 0z" fill="#0f7d53"/>
          <circle cx="18" cy="16.5" r="10" fill="#ffffff"/>
          <path d="M13.2 16.8l3.3 3.3 6.4-6.4" fill="none" stroke="#0f7d53" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </svg>`;
  }

  /** Ilustrasi kecil untuk keadaan kosong (kalender dengan centang). */
  function emptyCalendar() {
    return `
      <svg class="empty-art" viewBox="0 0 96 80" aria-hidden="true">
        <rect x="14" y="14" width="68" height="56" rx="10" fill="#eef7f2" stroke="#cfe5d9" stroke-width="2"/>
        <rect x="14" y="14" width="68" height="16" rx="8" fill="#cfe9dc"/>
        <rect x="30" y="8" width="5" height="14" rx="2.5" fill="#0f7d53"/><rect x="61" y="8" width="5" height="14" rx="2.5" fill="#0f7d53"/>
        <path d="M37 50l7 7 15-15" fill="none" stroke="#0f7d53" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
  }

  return { logo, schoolScene, emptyCalendar };
})();

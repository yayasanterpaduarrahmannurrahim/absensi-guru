/**
 * Audit.gs — Pencatatan aktivitas ke sheet AUDIT_LOG.
 * Dipanggil untuk setiap perubahan administratif dan kejadian keamanan.
 * Jika pencatatan gagal, operasi pemanggil ikut gagal (perubahan tanpa jejak tidak diizinkan).
 */

/**
 * @param {string} userId    pelaku (user_id) atau 'SYSTEM'
 * @param {string} aktivitas kode aktivitas, contoh 'SETUP', 'LOGIN', 'KOREKSI_ABSENSI'
 * @param {Object|string} detail data pendukung (disimpan sebagai JSON)
 */
function logAudit_(userId, aktivitas, detail) {
  return insertRow_(SHEETS.AUDIT_LOG, {
    log_id: generateId_('LOG'),
    waktu: nowWib_().waktu,
    user_id: userId || '',
    aktivitas: aktivitas,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail || {}),
  });
}

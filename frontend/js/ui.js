/**
 * ui.js — Komponen tampilan umum: escape HTML, ikon, notifikasi (toast),
 * dialog konfirmasi, modal formulir, dan status loading tombol.
 */
const UI = (() => {
  /** Escape teks sebelum disisipkan ke HTML (mencegah XSS dari data sheet). */
  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function icons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function toast(message, type) {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.classList.add('hide'), 4000);
    setTimeout(() => el.remove(), 4400);
  }

  /** Menjalankan aksi async sambil menonaktifkan tombol dan menampilkan spinner. */
  async function withLoading(button, fn) {
    const label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span>';
    try {
      return await fn();
    } finally {
      button.disabled = false;
      button.innerHTML = label;
      icons();
    }
  }

  /**
   * Membuka modal. `render(body, close)` mengisi isi modal; `onClose` dipanggil saat
   * modal ditutup lewat tombol X atau klik di luar. Mengembalikan fungsi close.
   */
  function openModal(title, render, onClose) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="modal-head">
            <h2 id="modal-title">${esc(title)}</h2>
            <button class="icon-btn" data-close aria-label="Tutup"><i data-lucide="x"></i></button>
          </div>
          <div class="modal-body"></div>
        </div>
      </div>`;
    const close = () => { root.innerHTML = ''; };
    const dismiss = () => { close(); if (onClose) onClose(); };
    root.querySelector('[data-close]').onclick = dismiss;
    root.querySelector('.modal-backdrop').addEventListener('click', e => {
      if (e.target.classList.contains('modal-backdrop')) dismiss();
    });
    render(root.querySelector('.modal-body'), close);
    icons();
    return close;
  }

  /** Dialog konfirmasi. Mengembalikan Promise<boolean>. */
  function confirm(title, message, confirmLabel, danger) {
    return new Promise(resolve => {
      openModal(title, (body, closeModal) => {
        body.innerHTML = `
          <p class="confirm-text">${esc(message)}</p>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-no>Batal</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirmLabel)}</button>
          </div>`;
        body.querySelector('[data-no]').onclick = () => { closeModal(); resolve(false); };
        body.querySelector('[data-yes]').onclick = () => { closeModal(); resolve(true); };
      }, () => resolve(false));
    });
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  return { esc, icons, toast, withLoading, openModal, confirm, initials };
})();

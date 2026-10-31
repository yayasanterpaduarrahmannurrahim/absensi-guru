/**
 * pwa.js — Pendaftaran Service Worker, ajakan "Pasang aplikasi", petunjuk iPhone,
 * dan pemberitahuan versi baru.
 */
const Pwa = (() => {
  const DISMISS_KEY = 'absensi_install_dismissed';
  const DISMISS_DAYS = 14;
  let deferredPrompt = null;
  const listeners = [];

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function notify() {
    listeners.forEach(fn => { try { fn(); } catch (e) { /* abaikan */ } });
  }

  function init() {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(reg => {
          if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
          reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(worker);
            });
          });
          // Periksa pembaruan setiap kali aplikasi kembali dibuka.
          document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
        }).catch(() => { /* tanpa SW aplikasi tetap berjalan normal */ });
      });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });
    }
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      notify();
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      notify();
      UI.toast('Aplikasi terpasang di layar utama.', 'success');
    });
  }

  function dismissed() {
    try {
      const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return t && Date.now() - t < DISMISS_DAYS * 86400000;
    } catch (e) { return false; }
  }

  function canInstall() {
    return !isStandalone() && (!!deferredPrompt || isIos());
  }

  async function install() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) { /* abaikan */ }
      deferredPrompt = null;
      notify();
      return;
    }
    if (isIos()) showIosHelp();
  }

  function showIosHelp() {
    UI.openModal('Pasang di iPhone', body => {
      body.innerHTML = `
        <ol class="ios-steps">
          <li><span class="step-n">1</span><div>Buka aplikasi ini di <b>Safari</b> (bukan Chrome atau aplikasi lain).</div></li>
          <li><span class="step-n">2</span><div>Ketuk tombol <b>Bagikan</b> <i data-lucide="share"></i> di bagian bawah layar.</div></li>
          <li><span class="step-n">3</span><div>Gulir lalu pilih <b>Tambah ke Layar Utama</b> <i data-lucide="square-plus"></i>.</div></li>
          <li><span class="step-n">4</span><div>Ketuk <b>Tambah</b>. Ikon <b>Absensi Guru</b> muncul di layar utama.</div></li>
        </ol>
        <p class="muted small-note">Setelah terpasang, buka aplikasi dari ikon tersebut. Bila login Google tidak kembali ke aplikasi, gunakan <b>masuk dengan kode email</b>.</p>`;
    });
  }

  /**
   * Menampilkan kartu ajakan pasang di `container` (bila relevan) dan memperbaruinya
   * saat status berubah. Mengembalikan fungsi pelepas.
   */
  function mountInstallCard(container) {
    const render = () => {
      if (!container.isConnected) return;
      if (!canInstall() || dismissed()) { container.innerHTML = ''; return; }
      container.innerHTML = `
        <section class="card install-card">
          <div class="install-icon"><img src="icons/icon-192.png" alt="" width="44" height="44"></div>
          <div class="install-text"><strong>Pasang Absensi Guru</strong><span>Buka lebih cepat langsung dari layar utama HP.</span></div>
          <div class="install-actions">
            <button class="btn btn-primary btn-sm" data-install>Pasang</button>
            <button class="icon-btn" data-dismiss aria-label="Tutup" title="Nanti saja"><i data-lucide="x"></i></button>
          </div>
        </section>`;
      container.querySelector('[data-install]').onclick = install;
      container.querySelector('[data-dismiss]').onclick = () => {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { /* abaikan */ }
        render();
      };
      UI.icons();
    };
    listeners.push(render);
    render();
    return () => { const i = listeners.indexOf(render); if (i >= 0) listeners.splice(i, 1); };
  }

  function showUpdate(worker) {
    if (document.getElementById('update-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.className = 'update-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span>Versi baru aplikasi tersedia.</span><button class="btn btn-sm btn-primary">Muat ulang</button>';
    bar.querySelector('button').onclick = () => worker.postMessage('SKIP_WAITING');
    document.body.appendChild(bar);
  }

  return { init, canInstall, install, isStandalone, mountInstallCard };
})();

Pwa.init();

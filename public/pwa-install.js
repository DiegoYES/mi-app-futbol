/**
 * Data-Fut PWA Controller
 * Gestiona el registro del Service Worker y la interfaz de instalación automática
 * en Android, iOS (Safari) y navegadores de escritorio.
 */
(function () {
  const CLAVE_DISMISS = 'datafut_pwa_dismissed_at';
  const DIAS_GRACIA_MS = 3 * 24 * 60 * 60 * 1000; // 3 días si el usuario lo cierra

  let deferredPrompt = null;
  let bannerElement = null;

  // 1. Registro de Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        reg.update();
      }).catch(() => {});
    });
  }

  function fueDescartadoRecientemente() {
    const guardado = localStorage.getItem(CLAVE_DISMISS);
    if (!guardado) return false;
    const tiempo = Number(guardado);
    return Date.now() - tiempo < DIAS_GRACIA_MS;
  }

  function marcarDescartado() {
    localStorage.setItem(CLAVE_DISMISS, String(Date.now()));
    cerrarBanner();
  }

  function cerrarBanner() {
    if (bannerElement) {
      bannerElement.classList.remove('visible');
      setTimeout(() => bannerElement?.remove(), 300);
      bannerElement = null;
    }
  }

  // 2. Banner de instalación para Android / Chrome / Edge
  function mostrarBannerAndroid() {
    if (document.getElementById('pwa-install-banner') || fueDescartadoRecientemente()) return;

    bannerElement = document.createElement('aside');
    bannerElement.id = 'pwa-install-banner';
    bannerElement.className = 'pwa-install-banner';
    bannerElement.setAttribute('role', 'dialog');
    bannerElement.setAttribute('aria-label', 'Instalar aplicación');

    bannerElement.innerHTML = `
      <div class="pwa-banner-content">
        <img src="/brand-social-avatar.png" alt="Logo Data-Fut" class="pwa-banner-icon">
        <div class="pwa-banner-info">
          <strong>Instalar App Data-Fut</strong>
          <span>Acceso directo, pantalla completa y carga ultrarrápida.</span>
        </div>
      </div>
      <div class="pwa-banner-actions">
        <button type="button" class="pwa-btn-install" id="pwa-btn-action">Instalar</button>
        <button type="button" class="pwa-btn-close" id="pwa-btn-dismiss" aria-label="Cerrar aviso">✕</button>
      </div>
    `;

    document.body.appendChild(bannerElement);

    // Animación de entrada
    requestAnimationFrame(() => bannerElement.classList.add('visible'));

    document.getElementById('pwa-btn-action')?.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          cerrarBanner();
        }
        deferredPrompt = null;
      }
    });

    document.getElementById('pwa-btn-dismiss')?.addEventListener('click', marcarDescartado);
  }

  // 3. Banner de instalación para iOS Safari
  function esIosSafari() {
    const ua = window.navigator.userAgent;
    const esIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const esSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|mercury/i.test(ua);
    const esStandalone = window.navigator.standalone === true;
    return esIos && esSafari && !esStandalone;
  }

  function mostrarBannerIos() {
    if (document.getElementById('pwa-install-banner') || fueDescartadoRecientemente()) return;

    bannerElement = document.createElement('aside');
    bannerElement.id = 'pwa-install-banner';
    bannerElement.className = 'pwa-install-banner pwa-ios-banner';
    bannerElement.setAttribute('role', 'dialog');
    bannerElement.setAttribute('aria-label', 'Instalar aplicación en iPhone');

    bannerElement.innerHTML = `
      <div class="pwa-banner-content">
        <img src="/brand-social-avatar.png" alt="Logo Data-Fut" class="pwa-banner-icon">
        <div class="pwa-banner-info">
          <strong>Agrega Data-Fut a tu iPhone</strong>
          <span>Toca el botón <b>Compartir</b> <svg class="pwa-share-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> y luego <b>“Agregar a inicio” ➕</b></span>
        </div>
      </div>
      <div class="pwa-banner-actions">
        <button type="button" class="pwa-btn-close" id="pwa-btn-dismiss" aria-label="Cerrar aviso">✕</button>
      </div>
    `;

    document.body.appendChild(bannerElement);
    requestAnimationFrame(() => bannerElement.classList.add('visible'));

    document.getElementById('pwa-btn-dismiss')?.addEventListener('click', marcarDescartado);
  }

  // 4. Capturar evento de instalación nativo
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    mostrarBannerAndroid();
  });

  window.addEventListener('appinstalled', () => {
    cerrarBanner();
    deferredPrompt = null;
  });

  // Inicializar en DOMReady si es iOS
  document.addEventListener('DOMContentLoaded', () => {
    if (esIosSafari()) {
      // Breve retardo para no interferir con la carga inicial
      setTimeout(mostrarBannerIos, 1500);
    }
  });

  // Exportar helper para botones con data-pwa-install
  window.mostrarInstaladorPWA = function () {
    localStorage.removeItem(CLAVE_DISMISS);
    if (deferredPrompt) {
      mostrarBannerAndroid();
    } else if (esIosSafari()) {
      mostrarBannerIos();
    } else {
      alert('Para instalar la aplicación, abre el menú de opciones de tu navegador (⋮ o ⎋) y selecciona "Instalar aplicación" o "Agregar a pantalla de inicio".');
    }
  };

  document.addEventListener('click', e => {
    if (e.target.closest('[data-pwa-install]')) {
      e.preventDefault();
      window.mostrarInstaladorPWA();
    }
  });
})();

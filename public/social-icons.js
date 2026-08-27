(function (root) {
  const trazos = {
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
    x: '<path d="M4 4l16 16M20 4L4 20"/>', facebook: '<path d="M14 8h4V3h-4c-4 0-6 2-6 6v3H4v5h4v4h5v-4h4l1-5h-5V9c0-1 .4-1 1-1z"/>',
    tiktok: '<path d="M14 3v11a4 4 0 1 1-4-4M14 3c1 3 3 5 6 5"/>', youtube: '<path d="M3 7c0-2 1-3 3-3h12c2 0 3 1 3 3v10c0 2-1 3-3 3H6c-2 0-3-1-3-3z"/><path d="M10 9l5 3-5 3z"/>',
    linkedin: '<rect x="4" y="9" width="4" height="11"/><path d="M6 4v.1M12 20V9h4v2c1-2 5-3 5 3v6"/>', whatsapp: '<path d="M5 19l-2 2 1-5a9 9 0 1 1 4 4z"/><path d="M8 8c1 5 3 7 8 8"/>',
    telegram: '<path d="M3 11l18-8-5 18-5-7zM11 14l10-11"/>', discord: '<path d="M7 7c4-2 6-2 10 0 2 3 3 7 2 11-2 1-3 2-5 2l-1-2M17 17c-4 2-6 2-10 0l-1 3c-2 0-3-1-5-2 0-4 0-8 2-11 4-2 6-2 10 0"/><circle cx="8" cy="13" r="1"/><circle cx="16" cy="13" r="1"/>',
    twitch: '<path d="M4 3h17v12l-5 5h-4l-3 3v-3H4zM9 8v6M15 8v6"/>', web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', link: '<path d="M10 14l4-4M8 17H6a4 4 0 0 1 0-8h3M16 7h2a4 4 0 0 1 0 8h-3"/>'
  };
  function icono(nombre) { return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${trazos[nombre] || trazos.link}</svg>`; }
  function pintar(contenedor, enlaces) {
    if (!contenedor) return;
    contenedor.innerHTML = (enlaces || []).map(e => `<a class="social-link" href="${String(e.url).replaceAll('&','&amp;').replaceAll('"','&quot;')}" target="_blank" rel="noopener noreferrer" aria-label="${String(e.nombre).replaceAll('&','&amp;').replaceAll('"','&quot;')}">${icono(e.icono)}</a>`).join('');
    contenedor.hidden = !enlaces?.length;
  }
  async function cargar(selector = '[data-social-links]') { try { const r = await fetch('/api/social-links'); if (!r.ok) return; const d = await r.json(); document.querySelectorAll(selector).forEach(n => pintar(n, d.enlaces)); } catch {} }
  root.FutbolSocial = { icono, pintar, cargar, iconos: Object.keys(trazos) };
})(globalThis);

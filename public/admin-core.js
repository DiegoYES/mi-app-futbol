let temporizador;
const PANELES_ADMIN = new Set(['resumen', 'picks', 'usuarios', 'tickets', 'calidad', 'redes', 'seguridad']);

function mostrarPanelAdmin(nombre, actualizarUrl = true) {
  const panel = PANELES_ADMIN.has(nombre) ? nombre : 'resumen';
  document.querySelectorAll('[data-admin-panel-content]').forEach(seccion => {
    seccion.hidden = seccion.dataset.adminPanelContent !== panel;
  });
  document.querySelectorAll('[data-admin-panel]').forEach(boton => {
    const activo = boton.dataset.adminPanel === panel;
    boton.classList.toggle('active', activo);
    if (activo) boton.setAttribute('aria-current', 'page');
    else boton.removeAttribute('aria-current');
  });
  if (actualizarUrl && location.hash !== `#${panel}`) {
    history.replaceState(null, '', `${location.pathname}${location.search}#${panel}`);
  }
  if (panel === 'calidad') cargarCalidadDatos();
}

function escaparHtml(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fecha(valor) {
  if (!valor) return '—';
  return new Date(valor).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fechaLocalInput(valor) {
  if (!valor) return '';
  const fechaValor = new Date(valor);
  const local = new Date(fechaValor.getTime() - fechaValor.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}


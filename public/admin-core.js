let temporizador;
let rolUsuarioAdmin = 'admin';
const PANELES_ADMIN = new Set(['resumen', 'picks', 'usuarios', 'tickets', 'calidad', 'redes', 'seguridad']);
const PANELES_MARKETING = new Set(['picks', 'redes', 'resumen']);

function configurarVistasPorRol(usuario) {
  if (!usuario) return;
  rolUsuarioAdmin = usuario.rol;
  if (rolUsuarioAdmin === 'marketing') {
    document.querySelectorAll('[data-admin-panel]').forEach(boton => {
      const panel = boton.dataset.adminPanel;
      if (!PANELES_MARKETING.has(panel)) {
        boton.hidden = true;
      }
    });
    document.querySelectorAll('[data-admin-panel-content]').forEach(seccion => {
      const panel = seccion.dataset.adminPanelContent;
      if (!PANELES_MARKETING.has(panel)) {
        seccion.hidden = true;
      }
    });
    const encabezado = document.querySelector('.admin-heading p');
    if (encabezado) {
      encabezado.textContent = 'Gestión editorial de picks y parlays para la plataforma.';
    }
  }
}

function mostrarPanelAdmin(nombre, actualizarUrl = true) {
  const permitidos = rolUsuarioAdmin === 'marketing' ? PANELES_MARKETING : PANELES_ADMIN;
  const panel = permitidos.has(nombre) ? nombre : (rolUsuarioAdmin === 'marketing' ? 'picks' : 'resumen');
  document.querySelectorAll('[data-admin-panel-content]').forEach(seccion => {
    if (rolUsuarioAdmin === 'marketing' && !PANELES_MARKETING.has(seccion.dataset.adminPanelContent)) {
      seccion.hidden = true;
    } else {
      seccion.hidden = seccion.dataset.adminPanelContent !== panel;
    }
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
  if (panel === 'calidad' && typeof cargarCalidadDatos === 'function') cargarCalidadDatos();
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


/**
 * Guard de sesión del lado del cliente.
 * Se incluye en las páginas privadas antes que cualquier otro script.
 * La sesión vive en una cookie HttpOnly; este cliente solo reacciona a 401 / 403.
 */
(function () {
  const fetchOriginal = window.fetch.bind(window);

  function escaparHtml(valor) {
    return String(valor ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function cerrarSesion() {
    // Limpia tokens de versiones anteriores de la aplicación.
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    fetchOriginal('/api/auth/logout', { method: 'POST' }).finally(() => {
      window.location.replace('/login.html');
    });
  }

  // Las cookies same-origin viajan automáticamente con fetch.
  window.fetch = async function (recurso, opciones = {}) {
    const url = typeof recurso === 'string' ? recurso : recurso.url;
    const esApi = url && url.startsWith('/api/');

    const respuesta = await fetchOriginal(recurso, opciones);

    if (esApi && (respuesta.status === 401 || respuesta.status === 403)) {
      const datos = await respuesta.clone().json().catch(() => ({}));
      if (respuesta.status === 401) {
        cerrarSesion();
      } else if (datos.codigo === 'ACCESO_EXPIRADO') {
        mostrarPaywall();
      }
    }

    return respuesta;
  };

  function mostrarPaywall() {
    if (document.getElementById('paywall')) return;
    const capa = document.createElement('div');
    capa.id = 'paywall';
    capa.style.cssText = 'position:fixed;inset:0;background:rgba(10,37,64,.94);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,sans-serif';
    capa.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:420px;padding:32px;text-align:center">
        <h2 style="color:#0a2540;margin:0 0 12px">Tu acceso terminó</h2>
        <p style="color:#475569;line-height:1.6;margin:0 0 22px">
          Tu prueba gratuita de 7 días ha finalizado. Continúa con acceso completo
          a todas las ligas y estadísticas por <strong>$50 MXN al mes</strong>.
        </p>
        <button id="btnSalirPaywall" style="padding:11px 22px;border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;cursor:pointer">Cerrar sesión</button>
      </div>`;
    document.body.appendChild(capa);
    document.getElementById('btnSalirPaywall').onclick = cerrarSesion;
  }

  function pintarBarra(usuario) {
    const barra = document.createElement('div');
    const etiqueta = usuario.rol === 'admin'
      ? 'Administrador'
      : usuario.motivo === 'prueba_activa'
        ? `Prueba · ${usuario.diasRestantes} día(s) restantes`
        : usuario.motivo === 'suscripcion_activa'
          ? `Premium · ${usuario.diasRestantes} día(s) restantes`
          : 'Acceso expirado';

    barra.style.cssText = 'background:#0a2540;color:#fff;padding:9px 18px;display:flex;justify-content:space-between;align-items:center;gap:14px;font-family:system-ui,sans-serif;font-size:.85rem;flex-wrap:wrap';
    barra.innerHTML = `
      <span>👤 ${escaparHtml(usuario.nombre || usuario.email)}
        <span style="background:rgba(84,227,142,.14);color:#54e38e;padding:2px 9px;border-radius:11px;margin-left:8px">${escaparHtml(etiqueta)}</span>
      </span>
      <span>
        <a href="/" style="color:#fff;margin-right:14px">Inicio</a>
        <a href="/comparador.html" style="color:#fff;margin-right:14px">Comparador</a>
        <a href="/boletas.html" style="color:#f5be5b;margin-right:14px">Mis boletas</a>
        <a href="/picks.html" style="color:#54e38e;margin-right:14px">Mis picks</a>
        ${usuario.rol === 'admin' ? '<a href="/admin.html" style="color:#00d4ff;margin-right:14px">Panel admin</a>' : ''}
        <button id="btnCerrarSesion" style="background:transparent;border:1px solid rgba(255,255,255,.4);color:#fff;padding:5px 13px;border-radius:6px;cursor:pointer">Salir</button>
      </span>`;
    document.body.prepend(barra);
    document.getElementById('btnCerrarSesion').onclick = cerrarSesion;
  }

  function pintarAvisoLegal() {
    if (document.getElementById('site-legal-footer')) return;
    const pie = document.createElement('footer');
    pie.id = 'site-legal-footer';
    pie.className = 'site-legal-footer';
    pie.innerHTML = `<p><strong>Sitio independiente.</strong> No está afiliado, patrocinado ni respaldado por las ligas, clubes, jugadores o casas mostradas. Nombres, marcas, escudos y fotografías pertenecen a sus respectivos titulares y se usan únicamente para identificación e información estadística.</p><p>Las estimaciones son frecuencias históricas, no garantizan resultados ni constituyen asesoría financiera. Verifica mercados y juega responsablemente. Sólo para mayores de 18 años. <a href="/legal.html">Aviso legal y fuentes</a>.</p>`;
    document.body.appendChild(pie);
  }

  // Validar la sesión contra el servidor al cargar
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const resp = await fetchOriginal('/api/auth/me');
      if (!resp.ok) return cerrarSesion();

      const { usuario } = await resp.json();
      window.usuarioActual = usuario;

      pintarBarra(usuario);
      pintarAvisoLegal();
      if (!usuario.tieneAcceso) mostrarPaywall();
    } catch (err) {
      console.error('No se pudo validar la sesión:', err);
    }
  });

  window.cerrarSesion = cerrarSesion;
})();

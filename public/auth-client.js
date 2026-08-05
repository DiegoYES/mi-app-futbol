/**
 * Guard de sesión del lado del cliente.
 * Se incluye en las páginas privadas antes que cualquier otro script.
 * La sesión vive en una cookie HttpOnly; este cliente solo reacciona a 401 / 403.
 */
(function () {
  const fetchOriginal = window.fetch.bind(window);
  const esPaginaSuscripcion = window.location.pathname === '/suscripcion.html';

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
    // Una cuenta sin acceso debe poder llegar al formulario de pago. Mostrar el
    // paywall en esta ruta la dejaría atrapada en un enlace hacia la misma página.
    if (esPaginaSuscripcion) return;
    if (document.getElementById('paywall')) return;
    const capa = document.createElement('div');
    capa.id = 'paywall';
    capa.style.cssText = 'position:fixed;inset:0;background:rgba(10,37,64,.94);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,sans-serif';
    capa.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:420px;padding:32px;text-align:center">
        <h2 style="color:#0a2540;margin:0 0 12px">Tu acceso terminó</h2>
        <p style="color:#475569;line-height:1.6;margin:0 0 22px">
          Tu prueba gratuita de 7 días ha finalizado. Continúa con acceso completo
          a todas las ligas y estadísticas por <strong>$70 MXN al mes</strong>.
        </p>
        <a href="/suscripcion.html" style="display:inline-block;padding:11px 22px;background:#54e38e;color:#07100d;border-radius:8px;text-decoration:none;font-weight:800">Suscribirme</a>
        <button id="btnSalirPaywall" style="padding:11px 22px;border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;cursor:pointer;margin-left:8px">Cerrar sesión</button>
      </div>`;
    document.body.appendChild(capa);
    document.getElementById('btnSalirPaywall').onclick = cerrarSesion;
  }

  const ENLACES_NAV = [
    { href: '/', texto: 'Inicio', icono: '🏠' },
    { href: '/calendario.html', texto: 'Calendario', icono: '📅' },
    { href: '/comparador.html', texto: 'Comparador', icono: '⚽' },
    { href: '/picks.html', texto: 'Mis picks', icono: '🎯' },
    { href: '/boletas.html', texto: 'Mis boletas', icono: '🧾' },
    { href: '/guia.html', texto: 'Guía', icono: '📖' },
    { href: '/sugerencias.html', texto: 'Sugerencias', icono: '💡' },
    { href: '/suscripcion.html', texto: 'Mi suscripción', icono: '💳' }
  ];

  function esRutaActiva(href) {
    const actual = location.pathname.replace(/\/index\.html$/, '/');
    return href === '/' ? actual === '/' : actual === href;
  }

  function inyectarEstilosBarra() {
    if (document.getElementById('estilos-barra-sesion')) return;
    const estilos = document.createElement('style');
    estilos.id = 'estilos-barra-sesion';
    estilos.textContent = `
      .barra-sesion { background:rgba(8,19,15,.96);color:#fff;backdrop-filter:blur(16px);
        padding:0 20px; display:flex; justify-content:space-between; align-items:center; gap:16px;
        font-family:system-ui,sans-serif; font-size:.86rem; flex-wrap:wrap;
        border-bottom:1px solid rgba(255,255,255,.09); position:sticky; top:0; z-index:900;
        box-shadow:0 2px 12px rgba(0,0,0,.25); }
      .barra-sesion .usuario { display:flex; align-items:center; gap:9px; padding:11px 0; font-weight:600; }
      .barra-sesion .chip-plan { background:rgba(84,227,142,.14); color:#54e38e; padding:3px 10px;
        border-radius:11px; font-size:.74rem; font-weight:600; white-space:nowrap; }
      .barra-sesion .chip-plan.alerta { background:rgba(245,190,91,.16); color:#f5be5b; }
      .barra-sesion .chip-plan.admin { background:rgba(0,212,255,.14); color:#00d4ff; }
      .barra-sesion nav { display:flex; align-items:center; gap:2px; flex-wrap:wrap; }
      .barra-sesion nav a { color:rgba(255,255,255,.78); text-decoration:none; padding:13px 13px;
        border-bottom:2px solid transparent; transition:color .15s, border-color .15s; white-space:nowrap; }
      .barra-sesion nav a:hover { color:#fff; border-bottom-color:rgba(84,227,142,.5); }
      .barra-sesion nav a.activo { color:#54e38e; border-bottom-color:#54e38e; font-weight:600; }
      .barra-sesion nav a.admin { color:#00d4ff; }
      .barra-sesion nav a.admin.activo { border-bottom-color:#00d4ff; }
      .barra-sesion .btn-salir { background:transparent; border:1px solid rgba(255,255,255,.28);
        color:#fff; padding:6px 14px; border-radius:7px; cursor:pointer; margin-left:10px;
        font-size:.82rem; transition:background .15s, border-color .15s; }
      .barra-sesion .btn-salir:hover { background:rgba(255,255,255,.1); border-color:rgba(255,255,255,.5); }
      @media (max-width: 720px) {
        .barra-sesion { gap:0;padding:0 12px; }
        .barra-sesion .usuario { width:100%;justify-content:space-between;padding:8px 2px;font-size:.76rem; }
        .barra-sesion nav { width:calc(100% + 24px);flex-wrap:nowrap;justify-content:flex-start;overflow-x:auto;margin:0 -12px;padding:0 8px;border-top:1px solid rgba(255,255,255,.07);scrollbar-width:none;scroll-snap-type:x proximity; }
        .barra-sesion nav::-webkit-scrollbar { display:none; }
        .barra-sesion nav a { display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;padding:9px 8px;font-size:.7rem;scroll-snap-align:start; }
        .barra-sesion nav a .ico { font-size:.88rem; }
        .barra-sesion .btn-salir { flex:0 0 auto;min-height:32px;margin:5px 4px;padding:5px 11px;font-size:.7rem; }
      }`;
    document.head.appendChild(estilos);
  }

  function pintarBarra(usuario) {
    inyectarEstilosBarra();

    const esAdmin = usuario.rol === 'admin';
    const diasBajos = usuario.diasRestantes != null && usuario.diasRestantes <= 3;
    const etiqueta = esAdmin
      ? 'Administrador'
      : usuario.motivo === 'prueba_activa'
        ? `Prueba · ${usuario.diasRestantes} día(s)`
        : usuario.motivo === 'suscripcion_activa'
          ? `Premium · ${usuario.diasRestantes} día(s)`
          : 'Acceso expirado';
    const claseChip = esAdmin ? 'admin' : (diasBajos ? 'alerta' : '');

    const enlaces = ENLACES_NAV.map(e =>
      `<a href="${e.href}" class="${esRutaActiva(e.href) ? 'activo' : ''}">
        <span class="ico">${e.icono}</span> <span class="txt">${escaparHtml(e.texto)}</span>
      </a>`).join('');
    const enlaceAdmin = esAdmin
      ? `<a href="/admin.html" class="admin ${esRutaActiva('/admin.html') ? 'activo' : ''}">
          <span class="ico">🛠️</span> <span class="txt">Panel admin</span></a>`
      : '';

    const barra = document.createElement('div');
    barra.className = 'barra-sesion';
    barra.innerHTML = `
      <span class="usuario">👤 ${escaparHtml(usuario.nombre || usuario.email)}
        <span class="chip-plan ${claseChip}">${escaparHtml(etiqueta)}</span>
      </span>
      <nav aria-label="Navegación principal">
        ${enlaces}
        ${enlaceAdmin}
        <button id="btnCerrarSesion" class="btn-salir">Salir</button>
      </nav>`;
    document.body.prepend(barra);
    document.getElementById('btnCerrarSesion').onclick = cerrarSesion;
  }

  const EVENTO_PICKS = 'futbol:picks-actualizados';
  const CLAVE_PICKS = 'futbol-picks-version';
  let widgetPicksCreado = false;

  function fechaPick(valor) {
    return new Date(valor).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
  }

  function notificarCambioPicks() {
    try { localStorage.setItem(CLAVE_PICKS, String(Date.now())); } catch {}
    window.dispatchEvent(new CustomEvent(EVENTO_PICKS));
  }

  function instalarEstilosPicks() {
    if (document.getElementById('global-picks-styles')) return;
    const estilos = document.createElement('style');
    estilos.id = 'global-picks-styles';
    estilos.textContent = `
      .global-picks-widget{position:fixed;right:18px;bottom:18px;z-index:140;font-family:Inter,system-ui,sans-serif;color:#eef8f2}
      .global-picks-trigger{min-height:50px;display:flex;align-items:center;gap:9px;padding:0 15px;border:1px solid rgba(84,227,142,.45);border-radius:999px;background:#14241f;color:#eef8f2;box-shadow:0 16px 42px rgba(0,0,0,.48);font-size:.78rem;font-weight:850;cursor:pointer}
      .global-picks-trigger:hover{border-color:#54e38e;transform:translateY(-1px)}
      .global-picks-trigger>span:first-child{width:27px;height:27px;display:grid;place-items:center;border-radius:50%;background:rgba(84,227,142,.14);color:#54e38e}
      .global-picks-count{min-width:22px;height:22px;display:grid;place-items:center;padding:0 6px;border-radius:999px;background:#54e38e;color:#07100d;font-size:.67rem}
      .global-picks-panel{position:absolute;right:0;bottom:62px;width:min(390px,calc(100vw - 28px));max-height:min(68vh,610px);overflow:hidden;border:1px solid rgba(255,255,255,.13);border-radius:18px;background:#101a17;box-shadow:0 28px 80px rgba(0,0,0,.72)}
      .global-picks-panel[hidden]{display:none}
      .global-picks-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 16px;border-bottom:1px solid rgba(255,255,255,.1);background:#14241f}
      .global-picks-head span{display:block;color:#54e38e;font-size:.57rem;font-weight:900;letter-spacing:.09em;text-transform:uppercase}.global-picks-head strong{display:block;margin-top:2px;font-size:.9rem}
      .global-picks-close{width:31px;min-height:31px;padding:0;border:1px solid rgba(255,255,255,.12);border-radius:9px;background:transparent;color:#9db1a8;cursor:pointer}
      .global-picks-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:11px 12px;border-bottom:1px solid rgba(255,255,255,.08)}
      .global-picks-summary div{padding:8px;border-radius:9px;background:rgba(255,255,255,.035);text-align:center}.global-picks-summary span{display:block;color:#9db1a8;font-size:.55rem;text-transform:uppercase}.global-picks-summary b{display:block;margin-top:2px;font-size:.83rem}
      .global-picks-list{max-height:390px;display:grid;gap:7px;overflow:auto;padding:10px 12px}
      .global-pick-item{position:relative;display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:9px;padding:10px;border:1px solid rgba(255,255,255,.09);border-radius:11px;background:rgba(255,255,255,.025)}
      .global-pick-item img{width:32px;height:32px;object-fit:contain;padding:3px;border-radius:8px;background:#f4f8f5}.global-pick-item a{min-width:0;color:#eef8f2;text-decoration:none}.global-pick-item strong,.global-pick-item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.global-pick-item strong{font-size:.68rem}.global-pick-item small{margin-top:2px;color:#9db1a8;font-size:.58rem}
      .global-pick-meta{text-align:right}.global-pick-meta b{display:block;color:#68d9e7;font-size:.73rem}.global-pick-meta em{font-size:.55rem;font-style:normal;text-transform:uppercase}.global-pick-meta .pendiente{color:#f5be5b}.global-pick-meta .acertado{color:#54e38e}.global-pick-meta .fallado{color:#ff7c78}
      .global-pick-delete{grid-column:2/-1;justify-self:end;min-height:27px;padding:0 8px;border:1px solid rgba(255,255,255,.1);border-radius:7px;background:transparent;color:#9db1a8;font-size:.58rem;cursor:pointer}
      .global-picks-empty{padding:24px 14px;color:#9db1a8;font-size:.7rem;line-height:1.5;text-align:center}
      .global-picks-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 14px;border-top:1px solid rgba(255,255,255,.09);background:#14241f}.global-picks-footer a{color:#54e38e;font-size:.66rem;font-weight:850}.global-picks-footer span{color:#9db1a8;font-size:.57rem}
      body.global-picks-open .bet-slip,body.global-picks-open .pick-shortcut{opacity:.2;pointer-events:none}
      @media(max-width:560px){.global-picks-widget{right:10px;bottom:10px}.global-picks-panel{right:0;bottom:60px;width:calc(100vw - 20px);max-height:72vh}.global-picks-trigger{min-height:46px;padding:0 12px}.global-picks-trigger>span:nth-child(2){display:none}}
    `;
    document.head.appendChild(estilos);
  }

  function pintarContenidoPicks(datos) {
    const panel = document.getElementById('global-picks-panel');
    const lista = document.getElementById('global-picks-list');
    if (!panel || !lista) return;
    const picks = datos.picks || [];
    const resumen = datos.resumen || {};
    const pendientes = picks.filter(item => item.estado === 'pendiente');
    const visibles = [...pendientes, ...picks.filter(item => item.estado !== 'pendiente')].slice(0, 7);
    document.getElementById('global-picks-count').textContent = pendientes.length;
    document.getElementById('global-picks-summary').innerHTML = `
      <div><span>Pendientes</span><b>${pendientes.length}</b></div>
      <div><span>Acertados</span><b>${resumen.acertados || 0}</b></div>
      <div><span>Efectividad</span><b>${resumen.efectividad == null ? '—' : `${resumen.efectividad}%`}</b></div>`;
    lista.innerHTML = visibles.length ? visibles.map(pick => {
      const url = `/partido.html?local=${pick.local.id}&visitante=${pick.visitante.id}&liga=${pick.liga.id}&partido=${pick.partido_api_id}#picks`;
      return `<article class="global-pick-item">
        <img src="/api/equipos/${pick.local.id}/escudo" alt="">
        <a href="${url}"><strong>${escaparHtml(pick.mercado.nombre)}</strong><small>${escaparHtml(pick.local.nombre)} vs ${escaparHtml(pick.visitante.nombre)} · ${fechaPick(pick.fecha_partido)}</small></a>
        <span class="global-pick-meta"><b>${pick.estimacion}%</b><em class="${escaparHtml(pick.estado)}">${escaparHtml(pick.estado)}</em></span>
        ${pick.estado === 'pendiente' ? `<button type="button" class="global-pick-delete" data-global-pick-delete="${escaparHtml(pick._id)}">Quitar</button>` : ''}
      </article>`;
    }).join('') : '<div class="global-picks-empty">Todavía no tienes picks guardados. Abre un partido futuro y guarda un mercado para verlo aquí en cualquier página.</div>';
  }

  async function actualizarPicksFlotantes() {
    if (!widgetPicksCreado) return;
    const lista = document.getElementById('global-picks-list');
    if (lista) lista.innerHTML = '<div class="global-picks-empty">Actualizando picks…</div>';
    try {
      const respuesta = await fetch('/api/picks/seguimiento', { cache: 'no-store' });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      pintarContenidoPicks(await respuesta.json());
    } catch (error) {
      if (lista) lista.innerHTML = '<div class="global-picks-empty">No se pudieron actualizar los picks.</div>';
      console.error('No se pudieron actualizar los picks flotantes:', error);
    }
  }

  function crearWidgetPicks() {
    if (widgetPicksCreado || document.getElementById('global-picks-widget')) return;
    widgetPicksCreado = true;
    instalarEstilosPicks();
    const widget = document.createElement('aside');
    widget.id = 'global-picks-widget';
    widget.className = 'global-picks-widget';
    widget.innerHTML = `
      <section id="global-picks-panel" class="global-picks-panel" aria-label="Mis picks" hidden>
        <header class="global-picks-head"><div><span>Seguimiento personal</span><strong>Mis picks</strong></div><button id="global-picks-close" class="global-picks-close" type="button" aria-label="Cerrar">×</button></header>
        <div id="global-picks-summary" class="global-picks-summary"></div>
        <div id="global-picks-list" class="global-picks-list"></div>
        <footer class="global-picks-footer"><span>Se actualiza en todas las páginas</span><a href="/picks.html">Ver historial completo →</a></footer>
      </section>
      <button id="global-picks-trigger" class="global-picks-trigger" type="button" aria-expanded="false" aria-controls="global-picks-panel"><span>✓</span><span>Mis picks</span><b id="global-picks-count" class="global-picks-count">0</b></button>`;
    document.body.appendChild(widget);
    const panel = document.getElementById('global-picks-panel');
    const trigger = document.getElementById('global-picks-trigger');
    const cerrar = () => { panel.hidden = true;trigger.setAttribute('aria-expanded', 'false');document.body.classList.remove('global-picks-open'); };
    trigger.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      trigger.setAttribute('aria-expanded', String(!panel.hidden));
      document.body.classList.toggle('global-picks-open', !panel.hidden);
      if (!panel.hidden) actualizarPicksFlotantes();
    });
    document.getElementById('global-picks-close').addEventListener('click', cerrar);
    document.getElementById('global-picks-list').addEventListener('click', async event => {
      const boton = event.target.closest('[data-global-pick-delete]');
      if (!boton) return;
      boton.disabled = true;
      const respuesta = await fetch(`/api/picks/seguimiento/${boton.dataset.globalPickDelete}`, { method: 'DELETE', cache: 'no-store' });
      if (respuesta.ok) notificarCambioPicks();
      else boton.disabled = false;
    });
    actualizarPicksFlotantes();
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
      crearWidgetPicks();
      if (!usuario.tieneAcceso) mostrarPaywall();
    } catch (err) {
      console.error('No se pudo validar la sesión:', err);
    }
  });

  window.addEventListener(EVENTO_PICKS, actualizarPicksFlotantes);
  window.addEventListener('storage', event => { if (event.key === CLAVE_PICKS) actualizarPicksFlotantes(); });
  window.addEventListener('pageshow', event => { if (event.persisted) actualizarPicksFlotantes(); });

  window.cerrarSesion = cerrarSesion;
  window.FutbolPicks = { actualizar: actualizarPicksFlotantes, notificarCambio: notificarCambioPicks };
})();

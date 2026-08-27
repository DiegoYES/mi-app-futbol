/**
 * Guard de sesión del lado del cliente.
 * Se incluye en las páginas privadas antes que cualquier otro script.
 * La sesión vive en una cookie HttpOnly; este cliente solo reacciona a 401 / 403.
 */
(function () {
  const fetchOriginal = window.fetch.bind(window);
  const esPaginaSuscripcion = window.location.pathname === '/suscripcion.html';
  const esPaginaSoporte = window.location.pathname === '/sugerencias.html';
  const esPaginaConfiguracion = window.location.pathname === '/configuracion.html';
  const esPaginaAdmin = window.location.pathname === '/admin.html';
  const CLAVE_FORMATO_MOMIO = 'datafut:formato-momio';

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
        mostrarPaywall(datos.motivo);
      }
    }

    return respuesta;
  };

  function mostrarPaywall(motivo) {
    // Una cuenta sin acceso debe poder llegar al formulario de pago. Mostrar el
    // paywall en esta ruta la dejaría atrapada en un enlace hacia la misma página.
    if (esPaginaSuscripcion || esPaginaSoporte || esPaginaConfiguracion) return;
    if (document.getElementById('paywall')) return;
    const bloqueoIP = motivo === 'ip_duplicada';
    const titulo = bloqueoIP ? 'Prueba gratuita no habilitada' : 'Tu acceso terminó';
    const explicacion = bloqueoIP
      ? `Esta cuenta se registró desde una red que ya fue utilizada para otra prueba gratuita. Por eso no se habilitaron automáticamente los 7 días. Si se trata de otra persona o de una cuenta autorizada, solicita una revisión al administrador.`
      : `Tu prueba gratuita de 7 días ha finalizado. Continúa con acceso completo a todas las ligas y estadísticas por <strong>$70 MXN al mes</strong>.`;
    const accionPrincipal = bloqueoIP
      ? `<a href="/sugerencias.html?tipo=otro&asunto=Revisi%C3%B3n%20de%20prueba%20gratuita" style="display:inline-block;padding:11px 22px;background:#54e38e;color:#07100d;border-radius:8px;text-decoration:none;font-weight:800">Solicitar revisión</a>`
      : `<a href="/suscripcion.html" style="display:inline-block;padding:11px 22px;background:#54e38e;color:#07100d;border-radius:8px;text-decoration:none;font-weight:800">Suscribirme</a>`;
    const capa = document.createElement('div');
    capa.id = 'paywall';
    capa.style.cssText = 'position:fixed;inset:0;background:rgba(10,37,64,.94);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,sans-serif';
    capa.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:420px;padding:32px;text-align:center">
        <h2 style="color:#0a2540;margin:0 0 12px">${titulo}</h2>
        <p style="color:#475569;line-height:1.6;margin:0 0 22px">
          ${explicacion}
        </p>
        ${accionPrincipal}
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
    { href: '/suscripcion.html', texto: 'Mi suscripción', icono: '💳' }
  ];
  const ENLACES_CUENTA = [
    { href: '/configuracion.html', texto: 'Configuración', icono: '⚙️' },
    { href: '/guia.html', texto: 'Guía', icono: '📖' },
    { href: '/sugerencias.html', texto: 'Sugerencias', icono: '💡' }
  ];

  function esRutaActiva(href) {
    const actual = location.pathname.replace(/\/index\.html$/, '/');
    return href === '/' ? actual === '/' : actual === href;
  }

  function inyectarEstilosBarra() {
    if (document.getElementById('estilos-barra-sesion')) return;
    const estilos = document.createElement('style');
    estilos.nonce = document.querySelector('meta[name="csp-nonce"]')?.content || '';
    estilos.id = 'estilos-barra-sesion';
    estilos.textContent = `
      .barra-sesion { background:rgba(8,19,15,.96);color:#fff;backdrop-filter:blur(16px);
        padding:0 20px; display:flex; justify-content:space-between; align-items:center; gap:16px;
        font-family:system-ui,sans-serif; font-size:.86rem; flex-wrap:wrap;
        border-bottom:1px solid rgba(255,255,255,.09); position:sticky; top:0; z-index:900;
        box-shadow:0 2px 12px rgba(0,0,0,.25); }
      .barra-sesion .cuenta-menu { position:relative;align-self:stretch;display:flex;align-items:center; }
      .barra-sesion .usuario { min-height:100%;display:flex;align-items:center;gap:9px;padding:10px 7px 10px 0;border:0;background:transparent;color:#fff;font:inherit;font-weight:650;cursor:pointer; }
      .barra-sesion .usuario:hover,.barra-sesion .usuario[aria-expanded="true"] { color:#54e38e; }
      .barra-sesion .usuario.activo { color:#54e38e; }
      .barra-sesion .usuario-nombre { max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .barra-sesion .usuario-flecha { color:rgba(255,255,255,.55);font-size:.66rem;transition:transform .15s; }
      .barra-sesion .usuario[aria-expanded="true"] .usuario-flecha { transform:rotate(180deg); }
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
      .barra-sesion .cuenta-panel { position:absolute;top:calc(100% + 8px);left:0;z-index:950;width:245px;padding:7px;border:1px solid rgba(255,255,255,.13);border-radius:13px;background:#101a17;box-shadow:0 22px 55px rgba(0,0,0,.58); }
      .barra-sesion .cuenta-panel[hidden] { display:none; }
      .barra-sesion .cuenta-panel a,.barra-sesion .cuenta-panel button { width:100%;min-height:40px;display:flex;align-items:center;gap:10px;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:rgba(255,255,255,.82);font:inherit;font-size:.78rem;text-align:left;text-decoration:none;cursor:pointer; }
      .barra-sesion .cuenta-panel a:hover,.barra-sesion .cuenta-panel button:hover,.barra-sesion .cuenta-panel a.activo { background:rgba(84,227,142,.1);color:#54e38e; }
      .barra-sesion .cuenta-separador { height:1px;margin:6px 5px;background:rgba(255,255,255,.1); }
      .barra-sesion .cuenta-panel .btn-salir { color:#ffaaa6; }
      .barra-sesion .cuenta-panel .btn-salir:hover { background:rgba(255,124,120,.1);color:#ff7c78; }
      .barra-sesion .btn-spotlight-nav { display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid rgba(84,227,142,.25);border-radius:9px;background:rgba(84,227,142,.08);color:#54e38e;font:inherit;font-size:.74rem;font-weight:750;cursor:pointer;margin-left:6px;transition:all .15s ease; }
      .barra-sesion .btn-spotlight-nav:hover { background:rgba(84,227,142,.18);border-color:rgba(84,227,142,.5); }
      .barra-sesion .btn-spotlight-nav .spotlight-badge-key { padding:1px 5px;border-radius:5px;background:rgba(0,0,0,.35);font-size:.62rem;color:rgba(255,255,255,.85); }
      .barra-sesion .btn-spotlight-nav .spotlight-mobile-label { display:none; }
      @media (max-width: 720px) {
        .barra-sesion { gap:0;padding:0 12px; }
        .barra-sesion .cuenta-menu { width:100%;min-width:0; }
        .barra-sesion .usuario { width:100%;padding:8px 2px;font-size:.76rem; }
        .barra-sesion .usuario-nombre { max-width:44vw; }
        .barra-sesion .chip-plan { margin-left:auto; }
        .barra-sesion .cuenta-panel { top:calc(100% + 5px);left:0;width:min(280px,calc(100vw - 24px)); }
        .barra-sesion nav { width:calc(100% + 24px);flex-wrap:nowrap;justify-content:flex-start;overflow-x:auto;margin:0 -12px;padding:0 8px;border-top:1px solid rgba(255,255,255,.07);scrollbar-width:none;scroll-snap-type:x proximity; }
        .barra-sesion nav::-webkit-scrollbar { display:none; }
        .barra-sesion nav a { display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;padding:9px 8px;font-size:.7rem;scroll-snap-align:start; }
        .barra-sesion nav a .ico { font-size:.88rem; }
        .barra-sesion .btn-spotlight-nav { margin:4px 4px 4px 0;padding:6px 10px;font-size:.72rem;min-height:36px; }
        .barra-sesion .btn-spotlight-nav .spotlight-badge-key { display:none; }
        .barra-sesion .btn-spotlight-nav .spotlight-mobile-label { display:inline;font-size:.72rem;font-weight:750; }
      }`;
    document.head.appendChild(estilos);
  }

  function pintarBarra(usuario) {
    inyectarEstilosBarra();
    document.querySelector('.barra-sesion')?.remove();

    const esAdmin = usuario.rol === 'admin';
    const diasBajos = usuario.diasRestantes != null && usuario.diasRestantes <= 3;
    const etiqueta = esAdmin
      ? 'Administrador'
      : usuario.motivo === 'prueba_activa'
        ? `Prueba · ${usuario.diasRestantes} día(s)`
        : usuario.motivo === 'suscripcion_activa'
          ? `Premium · ${usuario.diasRestantes} día(s)`
          : usuario.motivo === 'ip_duplicada'
            ? 'Prueba limitada'
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
    const enlacesCuenta = ENLACES_CUENTA.map(e =>
      `<a href="${e.href}" class="${esRutaActiva(e.href) ? 'activo' : ''}">
        <span aria-hidden="true">${e.icono}</span> <span>${escaparHtml(e.texto)}</span>
      </a>`).join('');
    const cuentaActiva = ENLACES_CUENTA.some(e => esRutaActiva(e.href));

    const isMac = typeof navigator !== 'undefined' && navigator.platform?.toUpperCase().indexOf('MAC') >= 0;
    const shortcutText = isMac ? '⌘K' : 'Ctrl+K';

    const barra = document.createElement('div');
    barra.className = 'barra-sesion';
    barra.innerHTML = `
      <div class="cuenta-menu">
        <button id="cuenta-menu-trigger" class="usuario ${cuentaActiva ? 'activo' : ''}" type="button" aria-expanded="false" aria-controls="cuenta-menu-panel">
          <span aria-hidden="true">👤</span><span class="usuario-nombre">${escaparHtml(usuario.nombre || usuario.email)}</span>
          <span class="chip-plan ${claseChip}">${escaparHtml(etiqueta)}</span><span class="usuario-flecha" aria-hidden="true">▼</span>
        </button>
        <div id="cuenta-menu-panel" class="cuenta-panel" aria-label="Menú de cuenta" hidden>
          ${enlacesCuenta}
          <div class="cuenta-separador" aria-hidden="true"></div>
          <button id="btnCerrarSesion" class="btn-salir" type="button"><span aria-hidden="true">↪</span><span>Cerrar sesión</span></button>
        </div>
      </div>
      <nav aria-label="Navegación principal">
        ${enlaces}
        ${enlaceAdmin}
        <button type="button" class="btn-spotlight-nav" id="btn-spotlight-nav" aria-label="Abrir buscador global" title="Buscar (${shortcutText})">
          <span>🔍</span><span class="spotlight-badge-key">${shortcutText}</span><span class="spotlight-mobile-label">Buscar</span>
        </button>
      </nav>`;
    document.body.prepend(barra);
    const triggerCuenta = document.getElementById('cuenta-menu-trigger');
    const panelCuenta = document.getElementById('cuenta-menu-panel');
    triggerCuenta.addEventListener('click', () => {
      panelCuenta.hidden = !panelCuenta.hidden;
      triggerCuenta.setAttribute('aria-expanded', String(!panelCuenta.hidden));
    });
    document.getElementById('btnCerrarSesion').onclick = cerrarSesion;
    document.getElementById('btn-spotlight-nav')?.addEventListener('click', () => {
      if (window.abrirBuscadorSpotlight) window.abrirBuscadorSpotlight();
    });
  }

  function cerrarMenuCuenta({ devolverFoco = false } = {}) {
    const trigger = document.getElementById('cuenta-menu-trigger');
    const panel = document.getElementById('cuenta-menu-panel');
    if (!trigger || !panel || panel.hidden) return;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (devolverFoco) trigger.focus();
  }

  function actualizarUsuarioInterfaz(usuario) {
    window.usuarioActual = usuario;
    const formato = ['ambos', 'decimal', 'americano'].includes(usuario?.preferencias?.formato_momio)
      ? usuario.preferencias.formato_momio : 'ambos';
    try { localStorage.setItem(CLAVE_FORMATO_MOMIO, formato); } catch {}
    pintarBarra(usuario);
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
    estilos.nonce = document.querySelector('meta[name="csp-nonce"]')?.content || '';
    estilos.id = 'global-picks-styles';
    estilos.textContent = `
      .global-picks-widget{position:fixed;right:18px;bottom:18px;z-index:140;font-family:Inter,system-ui,sans-serif;color:#eef8f2}
      .global-picks-trigger{min-height:50px;display:flex;align-items:center;gap:9px;padding:0 15px;border:1px solid rgba(84,227,142,.45);border-radius:999px;background:#14241f;color:#eef8f2;box-shadow:0 16px 42px rgba(0,0,0,.48);font-size:.78rem;font-weight:850;cursor:pointer}
      .global-picks-trigger:hover{border-color:#54e38e;transform:translateY(-1px)}
      .global-picks-trigger>span:first-child{width:27px;height:27px;display:grid;place-items:center;border-radius:50%;background:rgba(84,227,142,.14);color:#54e38e}
      .global-picks-count{min-width:22px;height:22px;display:grid;place-items:center;padding:0 6px;border-radius:999px;background:#54e38e;color:#07100d;font-size:.67rem}
      .global-picks-panel{position:absolute;right:0;bottom:62px;width:min(390px,calc(100vw - 24px));max-height:min(78vh,580px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,.13);border-radius:18px;background:#101a17;box-shadow:0 28px 80px rgba(0,0,0,.72)}
      .global-picks-head{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1);background:#14241f}
      .global-picks-head span{display:block;color:#54e38e;font-size:.57rem;font-weight:900;letter-spacing:.09em;text-transform:uppercase}.global-picks-head strong{display:block;margin-top:2px;font-size:.9rem}
      .global-picks-summary{flex-shrink:0;display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08)}
      .global-picks-summary div{padding:7px;border-radius:9px;background:rgba(255,255,255,.035);text-align:center}.global-picks-summary span{display:block;color:#9db1a8;font-size:.55rem;text-transform:uppercase}.global-picks-summary b{display:block;margin-top:2px;font-size:.83rem}
      .global-picks-list{flex:1 1 auto;min-height:70px;max-height:270px;display:grid;gap:7px;overflow-y:auto;padding:10px 12px}
      .global-pick-item{position:relative;display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:9px;padding:10px;border:1px solid rgba(255,255,255,.09);border-radius:11px;background:rgba(255,255,255,.025)}
      .global-pick-item img{width:32px;height:32px;object-fit:contain;padding:3px;border-radius:8px;background:#f4f8f5}.global-pick-item a{min-width:0;color:#eef8f2;text-decoration:none}.global-pick-item strong,.global-pick-item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.global-pick-item strong{font-size:.68rem}.global-pick-item small{margin-top:2px;color:#9db1a8;font-size:.58rem}
      .global-picks-actions{flex-shrink:0;padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);background:#14241f}
      .btn-create-boleta{width:100%;min-height:42px;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid rgba(84,227,142,.45);border-radius:10px;background:rgba(84,227,142,.15);color:#54e38e;font-size:.78rem;font-weight:850;cursor:pointer;transition:all .15s ease}
      .btn-create-boleta:hover{background:#54e38e;color:#07100d;border-color:#54e38e}
      .global-picks-footer{flex-shrink:0;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.09);background:#14241f}.global-picks-footer a{color:#54e38e;font-size:.66rem;font-weight:850}.global-picks-footer span{color:#9db1a8;font-size:.57rem}
      body.global-picks-open .bet-slip,body.global-picks-open .pick-shortcut{opacity:.2;pointer-events:none}
      
      .global-boleta-dialog{border:0;padding:0;background:transparent;max-width:440px;width:calc(100vw - 32px);margin:auto;border-radius:20px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.8)}
      .global-boleta-dialog::backdrop{background:rgba(4,9,7,.82);backdrop-filter:blur(8px)}
      .global-boleta-card{padding:22px 24px;border:1px solid rgba(84,227,142,.35);border-radius:20px;background:#0f1d18;color:#eef8f2}
      .global-boleta-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
      .global-boleta-header span{display:block;color:#54e38e;font-size:.62rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
      .global-boleta-header h3{margin:3px 0 0;font-size:1.2rem}
      .global-boleta-modal-close{width:32px;height:32px;padding:0;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:transparent;color:#9db1a8;font-size:1.1rem;cursor:pointer}
      .global-boleta-modal-close:hover{border-color:#54e38e;color:#54e38e}
      .global-boleta-info{margin:0 0 14px;color:#9db1a8;font-size:.78rem;line-height:1.45}
      .global-boleta-info b{color:#54e38e}
      .global-boleta-field{display:grid;gap:6px;margin-bottom:18px}
      .global-boleta-field span{color:#9db1a8;font-size:.7rem;font-weight:750}
      .global-boleta-field input{width:100%;min-height:44px;padding:0 13px;border:1px solid rgba(84,227,142,.3);border-radius:11px;background:#14241f;color:#eef8f2;font:inherit;font-size:.88rem;outline:none}
      .global-boleta-field input:focus{border-color:#54e38e;box-shadow:0 0 0 3px rgba(84,227,142,.2)}
      .global-boleta-actions-btns{display:grid;grid-template-columns:1fr 1.3fr;gap:10px}
      .btn-boleta-sec{min-height:42px;padding:0 14px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:transparent;color:#9db1a8;font:inherit;font-size:.8rem;font-weight:750;cursor:pointer}
      .btn-boleta-sec:hover{border-color:#9db1a8;color:#fff}
      .btn-boleta-pri{min-height:42px;padding:0 16px;border:1px solid #54e38e;border-radius:10px;background:#54e38e;color:#07100d;font:inherit;font-size:.82rem;font-weight:900;cursor:pointer;transition:transform .15s ease}
      .btn-boleta-pri:hover{transform:translateY(-1px)}

      @media(max-width:560px){
        .global-picks-widget{right:10px;bottom:max(10px,env(safe-area-inset-bottom))}
        .global-picks-panel{right:0;bottom:58px;width:calc(100vw - 20px);max-height:calc(85vh - env(safe-area-inset-bottom))}
        .global-picks-trigger{min-height:46px;padding:0 12px}
        .global-picks-trigger>span:nth-child(2){display:none}
        .global-picks-list{max-height:230px}
      }
    `;
    document.head.appendChild(estilos);
  }

  let ultimosPicksCargados = [];

  function pintarContenidoPicks(datos) {
    const panel = document.getElementById('global-picks-panel');
    const lista = document.getElementById('global-picks-list');
    const acciones = document.getElementById('global-picks-actions');
    if (!panel || !lista) return;
    const picks = datos?.picks || [];
    ultimosPicksCargados = picks;
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

    if (acciones) {
      if (pendientes.length > 0) {
        acciones.innerHTML = `<button id="global-picks-to-boleta" class="btn-create-boleta" type="button">📋 Guardar como Boleta (${pendientes.length})</button>`;
        acciones.hidden = false;
      } else {
        acciones.innerHTML = '';
        acciones.hidden = true;
      }
    }
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
        <div id="global-picks-actions" class="global-picks-actions" hidden></div>
        <footer class="global-picks-footer"><span>Se actualiza en todas las páginas</span><a href="/picks.html">Ver historial completo →</a></footer>
      </section>
      <button id="global-picks-trigger" class="global-picks-trigger" type="button" aria-expanded="false" aria-controls="global-picks-panel"><span>✓</span><span>Mis picks</span><b id="global-picks-count" class="global-picks-count">0</b></button>
      
      <dialog id="global-boleta-modal" class="global-boleta-dialog">
        <div class="global-boleta-card">
          <div class="global-boleta-header">
            <div><span>Crear Boleta / Parlay</span><h3>Nombrar boleta</h3></div>
            <button id="global-boleta-modal-close" class="global-boleta-modal-close" type="button" aria-label="Cerrar">×</button>
          </div>
          <p class="global-boleta-info">Empaqueta tus <b id="global-boleta-modal-count">0</b> selecciones pendientes en un ticket combinable.</p>
          <label class="global-boleta-field">
            <span>Nombre del ticket</span>
            <input id="global-boleta-modal-input" type="text" maxlength="60" placeholder="Ej. Parlay Fin de Semana" autocomplete="off">
          </label>
          <div class="global-boleta-actions-btns">
            <button id="global-boleta-modal-cancel" class="btn-boleta-sec" type="button">Cancelar</button>
            <button id="global-boleta-modal-confirm" class="btn-boleta-pri" type="button">Guardar Boleta ✓</button>
          </div>
        </div>
      </dialog>`;
    document.body.appendChild(widget);
    const panel = document.getElementById('global-picks-panel');
    const trigger = document.getElementById('global-picks-trigger');
    const modal = document.getElementById('global-boleta-modal');
    const inputNombre = document.getElementById('global-boleta-modal-input');
    const countSpan = document.getElementById('global-boleta-modal-count');

    const cerrar = () => { panel.hidden = true;trigger.setAttribute('aria-expanded', 'false');document.body.classList.remove('global-picks-open'); };
    trigger.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      trigger.setAttribute('aria-expanded', String(!panel.hidden));
      document.body.classList.toggle('global-picks-open', !panel.hidden);
      if (!panel.hidden) actualizarPicksFlotantes();
    });
    document.getElementById('global-picks-close').addEventListener('click', cerrar);

    const cerrarModal = () => { modal.close(); };
    document.getElementById('global-boleta-modal-close')?.addEventListener('click', cerrarModal);
    document.getElementById('global-boleta-modal-cancel')?.addEventListener('click', cerrarModal);

    document.getElementById('global-boleta-modal-confirm')?.addEventListener('click', async () => {
      const confirmBtn = document.getElementById('global-boleta-modal-confirm');
      const pendientes = ultimosPicksCargados.filter(item => item.estado === 'pendiente');
      if (!pendientes.length) return cerrarModal();
      const nombrePorDefecto = `Boleta ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`;
      const nombre = (inputNombre.value || '').trim() || nombrePorDefecto;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Guardando...';
      try {
        const payload = {
          nombre,
          selecciones: pendientes.map(pick => ({
            team_local: pick.local.id,
            team_visitante: pick.visitante.id,
            league_local: pick.liga.id,
            league_visitante: pick.liga.id,
            temporada_local: pick.liga.temporada,
            temporada_visitante: pick.liga.temporada,
            condicion_local: 'local',
            condicion_visitante: 'visitante',
            limite_local: 10,
            limite_visitante: 10,
            periodo_local: pick.mercado?.periodo || 0,
            periodo_visitante: pick.mercado?.periodo || 0,
            mercado_id: pick.mercado?.base_id || pick.mercado?.id
          }))
        };
        const resp = await fetch('/api/boletas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const resData = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(resData.error || 'No se pudo crear la boleta');
        window.location.href = '/boletas.html';
      } catch (err) {
        alert('Error: ' + err.message);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Guardar Boleta ✓';
      }
    });

    document.getElementById('global-picks-panel').addEventListener('click', async event => {
      const botonBoleta = event.target.closest('#global-picks-to-boleta');
      if (botonBoleta) {
        const pendientes = ultimosPicksCargados.filter(item => item.estado === 'pendiente');
        if (!pendientes.length) return;
        const nombrePorDefecto = `Boleta ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`;
        inputNombre.value = nombrePorDefecto;
        countSpan.textContent = pendientes.length;
        modal.showModal();
        inputNombre.focus();
        inputNombre.select();
        return;
      }
      const boton = event.target.closest('[data-global-pick-delete]');
      if (!boton) return;
      boton.disabled = true;
      const respuesta = await fetch(`/api/picks/seguimiento/${boton.dataset.globalPickDelete}`, { method: 'DELETE', cache: 'no-store' });
      if (respuesta.ok) notificarCambioPicks();
      else boton.disabled = false;
    });
    actualizarPicksFlotantes();
  }

  function cargarRedesSociales() {
    const iniciar = () => window.FutbolSocial?.cargar("[data-social-links]");
    if (window.FutbolSocial) return iniciar();
    if (document.querySelector("script[data-social-icons]")) return;
    const script = document.createElement("script");
    script.src = "/social-icons.js?v=20260824-social"; script.dataset.socialIcons = "true"; script.onload = iniciar;
    document.head.appendChild(script);
  }

  function pintarAvisoLegal() {
    if (document.getElementById('site-legal-footer')) return;
    const pie = document.createElement('footer');
    pie.id = 'site-legal-footer';
    pie.className = 'site-legal-footer';
    pie.innerHTML = `<div class="site-social-links" data-social-links hidden></div><p><strong>Sitio independiente.</strong> No está afiliado, patrocinado ni respaldado por las ligas, clubes, jugadores o casas mostradas. Nombres, marcas, escudos y fotografías pertenecen a sus respectivos titulares y se usan únicamente para identificación e información estadística.</p><p>Las estimaciones son frecuencias históricas, no garantizan resultados ni constituyen asesoría financiera. Verifica mercados y juega responsablemente. Sólo para mayores de 18 años. <a href="/legal.html">Aviso legal y fuentes</a>.</p>`;
    document.body.appendChild(pie);
    cargarRedesSociales();
  }

  function cargarPwaInstall() {
    if (document.querySelector('script[src*="pwa-install.js"]')) return;
    const script = document.createElement('script');
    script.src = '/pwa-install.js?v=20260826-pwa';
    script.defer = true;
    document.head.appendChild(script);
  }

  function cargarSpotlightSearch() {
    if (document.querySelector('script[src*="spotlight-search.js"]')) return;
    const script = document.createElement('script');
    script.src = '/spotlight-search.js?v=20260824-spotlight';
    script.defer = true;
    document.head.appendChild(script);
  }
  // Validar la sesión contra el servidor al cargar
  document.addEventListener('DOMContentLoaded', async () => {
    cargarPwaInstall();
    cargarSpotlightSearch();
    try {
      const resp = await fetchOriginal('/api/auth/me');
      if (!resp.ok) return cerrarSesion();

      const { usuario } = await resp.json();
      actualizarUsuarioInterfaz(usuario);
      window.dispatchEvent(new CustomEvent('futbol:usuario-cargado', { detail: usuario }));
      if (!esPaginaAdmin) pintarAvisoLegal();
      if (!esPaginaConfiguracion) crearWidgetPicks();
      const parametros = new URLSearchParams(window.location.search);
      const registroLimitado = parametros.get('registro') === 'ip_duplicada';
      if (!usuario.tieneAcceso || registroLimitado) mostrarPaywall(registroLimitado ? 'ip_duplicada' : usuario.motivo);
      if (registroLimitado) {
        parametros.delete('registro');
        const consulta = parametros.toString();
        history.replaceState(null, '', `${window.location.pathname}${consulta ? `?${consulta}` : ''}${window.location.hash}`);
      }
    } catch (err) {
      console.error('No se pudo validar la sesión:', err);
    }
  });

  window.addEventListener(EVENTO_PICKS, actualizarPicksFlotantes);
  window.addEventListener('futbol:usuario-actualizado', evento => {
    if (evento.detail) actualizarUsuarioInterfaz(evento.detail);
  });
  document.addEventListener('click', evento => {
    if (!evento.target.closest('.cuenta-menu')) cerrarMenuCuenta();
  });
  document.addEventListener('keydown', evento => {
    if (evento.key === 'Escape') cerrarMenuCuenta({ devolverFoco: true });
  });
  window.addEventListener('storage', event => { if (event.key === CLAVE_PICKS) actualizarPicksFlotantes(); });
  window.addEventListener('pageshow', event => { if (event.persisted) actualizarPicksFlotantes(); });

  window.cerrarSesion = cerrarSesion;
  window.FutbolPicks = { actualizar: actualizarPicksFlotantes, notificarCambio: notificarCambioPicks };
})();

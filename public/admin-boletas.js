let datosBoletasUsuarios = null;
const boletasAdminPorId = new Map();
let busquedaBoletasTimer = null;

async function cargarBoletasUsuariosAdmin() {
  const contenedor = document.getElementById('lista-boletas-usuarios');
  if (!contenedor) return;

  const q = document.getElementById('buscar-boleta-admin')?.value.trim() || '';
  const estado = document.getElementById('filtro-boleta-estado')?.value || '';

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (estado) params.set('estado', estado);

  try {
    const resp = await fetch('/api/admin/boletas-usuarios?' + params.toString(), { cache: 'no-store' });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'No se pudieron cargar las boletas de usuarios.');
    }
    const data = await resp.json();
    datosBoletasUsuarios = data;
    renderizarKpisBoletas(data.resumen);
    renderizarListaBoletasUsuarios(data.usuarios);
  } catch (error) {
    contenedor.innerHTML = '<div class="ticket-empty" style="color:#ef4444">' + escaparHtml(error.message) + '</div>';
  }
}

function renderizarKpisBoletas(resumen = {}) {
  const kpis = document.getElementById('kpis-boletas-admin');
  if (!kpis) return;
  const efectividadTexto = resumen.efectividad !== null ? resumen.efectividad + '%' : '—';
  kpis.innerHTML = [
    '<div class="kpi"><div class="label">Usuarios con boletas</div><div class="value">' + (resumen.totalUsuarios || 0) + '</div></div>',
    '<div class="kpi"><div class="label">Total de boletas</div><div class="value">' + (resumen.totalBoletas || 0) + '</div></div>',
    '<div class="kpi"><div class="label">Pendientes / En juego</div><div class="value" style="color:#f59e0b">' + (resumen.pendientes || 0) + '</div></div>',
    '<div class="kpi"><div class="label">Acertadas</div><div class="value" style="color:#10b981">' + (resumen.acertadas || 0) + '</div></div>',
    '<div class="kpi"><div class="label">Efectividad global</div><div class="value" style="color:#00d4ff">' + efectividadTexto + '</div></div>'
  ].join('');
}

function renderizarListaBoletasUsuarios(usuarios = []) {
  const contenedor = document.getElementById('lista-boletas-usuarios');
  if (!contenedor) return;
  boletasAdminPorId.clear();

  if (!usuarios.length) {
    contenedor.innerHTML = '<div class="ticket-empty">No se encontraron boletas con los filtros seleccionados.</div>';
    return;
  }

  const html = usuarios.map((grupo, idx) => {
    const u = grupo.usuario;
    const inicial = (u.nombre || u.email || 'U').trim().charAt(0).toUpperCase();
    const efectividad = grupo.efectividad !== null ? grupo.efectividad + '% efectividad' : 'Sin resolver';
    const planClass = 'badge ' + (u.plan || 'prueba');
    const rolBadge = u.rol && u.rol !== 'usuario' ? '<span class="badge ' + escaparHtml(u.rol) + '">' + escaparHtml(u.rol) + '</span>' : '';

    // Guardar boletas en Map para acción de publicar
    (grupo.boletas || []).forEach(b => boletasAdminPorId.set(String(b._id), b));

    const boletasHtml = (grupo.boletas || []).map(b => {
      let estadoBadge = '<span class="badge badge-pendiente">⏳ Pendiente</span>';
      if (b.estado_evaluacion === 'acertada') estadoBadge = '<span class="badge badge-acertada">✓ Acertada</span>';
      else if (b.estado_evaluacion === 'fallada') estadoBadge = '<span class="badge badge-fallada">✗ Fallada</span>';

      const fechaStr = b.creada_en ? new Date(b.creada_en).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

      const seleccionesHtml = (b.selecciones || []).map((s, sIdx) => {
        const local = s.local?.nombre || 'Local';
        const visitante = s.visitante?.nombre || 'Visitante';
        const liga = s.liga?.nombre || 'Competición';
        const mercado = s.mercado?.nombre || 'Mercado';
        const estimacion = Number(s.estimacion) || 0;
        const cuota = estimacion > 0 ? (100 / estimacion).toFixed(2) : '—';
        
        let selBadge = '<span class="sel-status-badge sel-pendiente">Pendiente</span>';
        if (s.estado_seleccion === 'acertado') selBadge = '<span class="sel-status-badge sel-acertado">✓ Acertado</span>';
        else if (s.estado_seleccion === 'fallado') selBadge = '<span class="sel-status-badge sel-fallado">✗ Fallado</span>';

        let marcadorInfo = '';
        if (s.partido_info && s.partido_info.estado) {
          const est = s.partido_info.estado;
          const gL = s.partido_info.goles_local ?? '';
          const gV = s.partido_info.goles_visitante ?? '';
          marcadorInfo = '<span class="sel-score">' + escaparHtml(est) + (gL !== '' ? ' ' + gL + '-' + gV : '') + '</span>';
        }

        return [
          '<div class="boleta-admin-sel-row">',
            '<div class="sel-num">' + (sIdx + 1) + '.</div>',
            '<div class="sel-info">',
              '<div class="sel-partido">' + escaparHtml(local) + ' vs ' + escaparHtml(visitante) + ' <span class="sel-liga">(' + escaparHtml(liga) + ')</span> ' + marcadorInfo + '</div>',
              '<div class="sel-mercado"><strong>' + escaparHtml(mercado) + '</strong> · ' + estimacion + '% prob. (~' + cuota + ')</div>',
            '</div>',
            '<div class="sel-result">' + selBadge + '</div>',
          '</div>'
        ].join('');
      }).join('');

      return [
        '<div class="boleta-admin-card">',
          '<div class="boleta-admin-card-head">',
            '<div>',
              '<h4 class="boleta-admin-title">' + escaparHtml(b.nombre || 'Boleta') + '</h4>',
              '<span class="boleta-admin-meta">Creada: ' + escaparHtml(fechaStr) + ' · ' + (b.selecciones?.length || 0) + ' picks</span>',
            '</div>',
            '<div class="boleta-admin-actions">',
              estadoBadge,
              '<button type="button" class="rec-primary btn-recomendar-boleta" data-recommend-boleta="' + escaparHtml(String(b._id)) + '">🌟 Publicar como Recomendación</button>',
            '</div>',
          '</div>',
          '<div class="boleta-admin-selections">' + seleccionesHtml + '</div>',
        '</div>'
      ].join('');
    }).join('');

    return [
      '<div class="user-boletas-group" data-user-group="' + escaparHtml(u.id) + '">',
        '<div class="user-boletas-head" onclick="alternarGrupoUsuario(this)">',
          '<div class="user-avatar">' + escaparHtml(inicial) + '</div>',
          '<div class="user-head-main">',
            '<div class="user-name-row">',
              '<strong>' + escaparHtml(u.nombre) + '</strong>',
              '<span class="user-email">(' + escaparHtml(u.email) + ')</span>',
              '<span class="' + planClass + '">' + escaparHtml(u.plan) + '</span>',
              rolBadge,
            '</div>',
            '<div class="user-stats-row">',
              '<span>' + grupo.totalBoletas + ' boleta' + (grupo.totalBoletas !== 1 ? 's' : '') + '</span>',
              '<span>· ' + grupo.acertadas + ' acertadas, ' + grupo.pendientes + ' pendientes</span>',
              '<span class="user-rate-badge">🎯 ' + efectividad + '</span>',
            '</div>',
          '</div>',
          '<div class="user-head-toggle"><span class="toggle-arrow">▼</span></div>',
        '</div>',
        '<div class="user-boletas-body">' + boletasHtml + '</div>',
      '</div>'
    ].join('');
  }).join('');

  contenedor.innerHTML = html;
}

function alternarGrupoUsuario(headerElem) {
  const grupo = headerElem.closest('.user-boletas-group');
  if (grupo) {
    grupo.classList.toggle('collapsed');
  }
}

function configurarModalRecomendarBoleta() {
  const modal = document.getElementById('modal-recomendar-boleta-admin');
  const form = document.getElementById('form-recomendar-boleta-admin');
  if (!modal || !form) return;

  const cerrarModal = () => { if (modal.open) modal.close(); };
  document.getElementById('btn-cerrar-modal-boleta-admin')?.addEventListener('click', cerrarModal);
  document.getElementById('btn-cancelar-modal-boleta-admin')?.addEventListener('click', cerrarModal);
  modal.addEventListener('click', e => { if (e.target === modal) cerrarModal(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const boletaId = document.getElementById('rec-admin-modal-boleta-id').value;
    const btn = document.getElementById('btn-confirmar-modal-boleta-admin');
    btn.disabled = true;
    btn.textContent = 'Publicando...';

    try {
      const rawFecha = document.getElementById('rec-admin-modal-cierra-en').value;
      let fechaIso = null;
      if (rawFecha) {
        const parsed = new Date(rawFecha);
        if (!isNaN(parsed.getTime())) fechaIso = parsed.toISOString();
      }

      const payload = {
        titulo: document.getElementById('rec-admin-modal-titulo').value,
        visibilidad: document.getElementById('rec-admin-modal-visibilidad').value,
        estado_publicacion: document.getElementById('rec-admin-modal-estado').value,
        momio_total: document.getElementById('rec-admin-modal-momio').value,
        destacada: document.getElementById('rec-admin-modal-destacada').checked,
        cierra_en: fechaIso,
        descripcion: document.getElementById('rec-admin-modal-descripcion').value
      };

      const resp = await fetch('/api/admin/recomendaciones/desde-boleta/' + boletaId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const datos = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(datos.error || 'No se pudo publicar la recomendación.');

      cerrarModal();
      alert('🎉 ¡Recomendación publicada con éxito en Picks del Día!');
      refrescar();
      if (typeof mostrarPanelAdmin === 'function') {
        mostrarPanelAdmin('picks');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Publicar Pick del Día ✓';
    }
  });

  // Delegación de clic para botones de recomendar
  document.getElementById('lista-boletas-usuarios')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-recommend-boleta]');
    if (!btn) return;
    const boletaId = btn.dataset.recommendBoleta;
    const boleta = boletasAdminPorId.get(boletaId);
    if (!boleta) return;

    document.getElementById('rec-admin-modal-boleta-id').value = boletaId;
    document.getElementById('rec-admin-modal-titulo').value = boleta.nombre || 'Pick del Día';

    const selecciones = boleta.selecciones || [];
    const cuotaSugerida = selecciones.reduce((acc, s) => {
      const est = Math.min(Math.max(Number(s.estimacion) || 50, 5), 98);
      return acc * (100 / est);
    }, 1);

    document.getElementById('rec-admin-modal-momio').value = cuotaSugerida.toFixed(2);
    document.getElementById('rec-admin-modal-descripcion').value = '';
    document.getElementById('rec-admin-modal-destacada').checked = false;

    const defaultFecha = new Date(Date.now() + 24 * 3600 * 1000);
    const localISO = new Date(defaultFecha.getTime() - (defaultFecha.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    document.getElementById('rec-admin-modal-cierra-en').value = localISO;

    modal.showModal();
  });
}

function inicializarEventosBoletasAdmin() {
  document.getElementById('btn-refrescar-boletas-admin')?.addEventListener('click', cargarBoletasUsuariosAdmin);
  document.getElementById('filtro-boleta-estado')?.addEventListener('change', cargarBoletasUsuariosAdmin);
  document.getElementById('buscar-boleta-admin')?.addEventListener('input', () => {
    clearTimeout(busquedaBoletasTimer);
    busquedaBoletasTimer = setTimeout(cargarBoletasUsuariosAdmin, 300);
  });
  configurarModalRecomendarBoleta();
}

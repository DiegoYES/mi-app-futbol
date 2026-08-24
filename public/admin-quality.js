function estadoCalidad(valor) { return valor ? 'quality-bad' : 'quality-ok'; }

async function cargarCalidadDatos() {
  const resumen = document.getElementById('quality-summary');
  const detalle = document.getElementById('quality-detail');
  resumen.innerHTML = '<div class="ticket-empty">Calculando calidad…</div>';
  const respuesta = await fetch('/api/admin/calidad-datos', { cache: 'no-store' });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) { resumen.innerHTML = `<div class="ticket-empty">${escaparHtml(datos.error || 'No se pudo cargar el diagnóstico.')}</div>`; return; }
  const p = datos.problemas;
  resumen.innerHTML = [
    ['NS atrasados', p.partidos_ns_atrasados], ['Finales sin stats', p.finalizados_sin_estadisticas],
    ['Estados sin actualizar', p.estados_sin_actualizar], ['Calendarios por revisar', p.ligas_atrasadas]
  ].map(([nombre, valor]) => `<article class="quality-card ${estadoCalidad(valor)}"><span>${nombre}</span><strong>${valor}</strong></article>`).join('');
  const instancias = datos.version.instancias.map(item => `<li>Puerto ${item.puerto}: <b>${item.disponible ? escaparHtml(item.commit?.slice(0, 8)) : 'no disponible'}</b></li>`).join('');
  const ligas = datos.ligas_atrasadas.length ? datos.ligas_atrasadas.map(item => `<li><b>${escaparHtml(item.nombre || item._id?.id || item._id)}</b><br>Próximo: ${fechaHora(item.proximo_partido)} · Último dato: ${fechaHora(item.ultima_actualizacion)} · ${item.partidos_proximos || 0} programados</li>`).join('') : '<li>Ningún calendario próximo requiere revisión</li>';
  const alertas = datos.alertas?.length ? `<article class="quality-alerts"><h3>Alertas activas</h3><ul>${datos.alertas.map(a => `<li><b>${escaparHtml(a.codigo)}</b> · ${escaparHtml(typeof a.detalle === 'object' ? JSON.stringify(a.detalle) : a.detalle)}</li>`).join('')}</ul></article>` : '';
  detalle.innerHTML = `<article><h3>Cron</h3><p>Estado: <b>${escaparHtml(datos.cron.estado)}</b><br>Último éxito: ${datos.cron.ultima_ejecucion_exitosa ? fechaHora(datos.cron.ultima_ejecucion_exitosa) : 'sin registro'}</p></article><article><h3>Proveedor y Redis</h3><p>Cuota: <b>${datos.cuota.restantes} restantes</b><br>Redis: ${escaparHtml(datos.redis)}</p></article><article><h3>Pool</h3><ul>${instancias}</ul></article><article><h3>Calendarios por revisar</h3><p>Incluye sólo ligas con partidos en los próximos 30 días cuyo calendario lleva demasiado tiempo sin cambiar.</p><ul>${ligas}</ul></article>${alertas}`;
}

async function revalidarDesdeCalidad(evento) {
  evento.preventDefault();
  const apiId = Number(document.getElementById('quality-api-id').value);
  if (prompt(`Para consultar al proveedor y actualizar sólo el partido ${apiId}, escribe REVALIDAR`) !== 'REVALIDAR') return;
  const estado = document.getElementById('quality-action-status');
  estado.textContent = 'Revalidando…';
  const respuesta = await fetch(`/api/admin/calidad-datos/revalidar/${apiId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmacion: 'REVALIDAR' }) });
  const datos = await respuesta.json().catch(() => ({}));
  estado.textContent = datos.mensaje || datos.error || 'Acción terminada.';
  if (respuesta.ok) cargarCalidadDatos();
}

async function cargarResumen() {
  const resp = await fetch('/api/admin/resumen');
  if (!resp.ok) return;
  const d = await resp.json();
  const cortesias = d.diasCortesia || 0;
  const ingresoReal = Math.max(0, d.premium - (d.mesesCortesia || 0)) * 50;
  document.getElementById('kpis').innerHTML = `
    <div class="kpi"><div class="label">Usuarios</div><div class="value">${d.total}</div></div>
    <div class="kpi"><div class="label">Premium</div><div class="value">${d.premium}</div></div>
    <div class="kpi"><div class="label">En prueba</div><div class="value">${d.enPrueba}</div></div>
    <div class="kpi"><div class="label">Expirados</div><div class="value">${d.expirados}</div></div>
    <div class="kpi"><div class="label">Ingreso mensual real</div><div class="value">$${ingresoReal}</div></div>
    <div class="kpi"><div class="label">Días de cortesía otorgados</div><div class="value">${cortesias}</div></div>
    <div class="kpi"><div class="label">API hoy</div><div class="value">${d.cuotaApi.usadas}/${d.cuotaApi.disponibles_para_uso}</div></div>
    <div class="kpi"><div class="label">Tickets abiertos</div><div class="value">${d.ticketsAbiertos || 0}</div></div>`;
}


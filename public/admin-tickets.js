const ESTADOS_TICKET = {
  nueva:'Nueva', en_revision:'En revisión', planeada:'Planeada', resuelta:'Resuelta', descartada:'Descartada'
};
const TIPOS_TICKET = { idea:'Idea', mejora:'Mejora', error:'Error', pago:'Problema con pago', otro:'Otro' };
const PRIORIDADES_TICKET = { baja:'Baja', media:'Media', alta:'Alta', urgente:'Urgente' };

function opcionesTicket(opciones, actual) {
  return Object.entries(opciones).map(([valor, etiqueta]) =>
    `<option value="${valor}" ${valor === actual ? 'selected' : ''}>${etiqueta}</option>`).join('');
}

async function cargarTickets() {
  const estado = document.getElementById('filtro-ticket-estado').value;
  const tipo = document.getElementById('filtro-ticket-tipo').value;
  const params = new URLSearchParams({ limite: '100' });
  if (estado) params.set('estado', estado);
  if (tipo) params.set('tipo', tipo);
  const contenedor = document.getElementById('admin-tickets');
  const resp = await fetch('/api/admin/sugerencias?' + params);
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    contenedor.innerHTML = `<div class="ticket-empty">${escaparHtml(datos.error || 'No se pudieron cargar los tickets.')}</div>`;
    return;
  }
  if (!datos.tickets.length) {
    contenedor.innerHTML = '<div class="ticket-empty">No hay tickets con estos filtros.</div>';
    return;
  }
  contenedor.innerHTML = datos.tickets.map(ticket => `
    <article class="admin-ticket" data-ticket="${ticket._id}">
      <div class="admin-ticket-head">
        <div>
          <span class="admin-ticket-meta">${escaparHtml(TIPOS_TICKET[ticket.tipo] || ticket.tipo)} · ${fecha(ticket.creada_en)}</span>
          ${ticket.tipo === 'pago' ? '<span class="badge" style="margin-left:6px;background:rgba(245,190,91,0.18);color:var(--amber);border:1px solid rgba(245,190,91,0.4)">PAGO</span>' : ''}
          <h3>${escaparHtml(ticket.asunto)}</h3>
          <span class="admin-ticket-meta">${escaparHtml(ticket.usuario?.nombre || 'Usuario eliminado')} · ${escaparHtml(ticket.usuario?.email || 'sin email')}</span>
        </div>
        <span class="badge ${ticket.estado === 'resuelta' ? 'premium' : ticket.estado === 'descartada' ? 'expirado' : 'prueba'}">${escaparHtml(ESTADOS_TICKET[ticket.estado])}</span>
      </div>
      ${(ticket.referencia_pago || ticket.evidencia_url) ? `
        <div style="margin:10px 0;padding:10px 14px;border-radius:9px;background:rgba(245,190,91,0.08);border:1px solid rgba(245,190,91,0.3);font-size:0.78rem;line-height:1.55">
          ${ticket.referencia_pago ? `<div><span style="color:var(--muted)">Número de operación:</span> <b style="color:var(--amber);letter-spacing:0.02em">${escaparHtml(ticket.referencia_pago)}</b></div>` : ''}
          ${ticket.evidencia_url ? `<div><span style="color:var(--muted)">Comprobante adjunto:</span> <a href="${escaparHtml(ticket.evidencia_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--cyan);text-decoration:underline;font-weight:750">Abrir comprobante ↗</a></div>` : ''}
        </div>
      ` : ''}
      <p class="admin-ticket-desc">${escaparHtml(ticket.descripcion)}</p>
      <div class="ticket-edit">
        <div><label>Estado</label><select data-campo="estado">${opcionesTicket(ESTADOS_TICKET, ticket.estado)}</select></div>
        <div><label>Prioridad</label><select data-campo="prioridad">${opcionesTicket(PRIORIDADES_TICKET, ticket.prioridad)}</select></div>
        <div><label>Respuesta al usuario</label><textarea maxlength="2000" data-campo="respuesta">${escaparHtml(ticket.respuesta_admin || '')}</textarea></div>
        <button class="btn-ticket" type="button" data-accion="guardar-ticket">Guardar</button>
      </div>
    </article>`).join('');
}

async function actualizarTicket(id, boton) {
  const tarjeta = document.querySelector(`[data-ticket="${id}"]`);
  boton.disabled = true;
  boton.textContent = 'Guardando…';
  try {
    const resp = await fetch(`/api/admin/sugerencias/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estado: tarjeta.querySelector('[data-campo="estado"]').value,
        prioridad: tarjeta.querySelector('[data-campo="prioridad"]').value,
        respuesta_admin: tarjeta.querySelector('[data-campo="respuesta"]').value
      })
    });
    const datos = await resp.json();
    if (!resp.ok) throw new Error(datos.error || 'No se pudo guardar.');
    boton.textContent = 'Guardado ✓';
    await cargarResumen();
    setTimeout(() => cargarTickets(), 500);
  } catch (error) {
    alert(error.message);
    boton.disabled = false;
    boton.textContent = 'Guardar';
  }
}


(function () {
  let enlaces = [];
  const $ = id => document.getElementById(id);
  const esc = valor => String(valor ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

  function limpiar() {
    $('social-form').reset(); $('social-id').value = ''; $('social-orden').value = 0; $('social-activo').checked = true;
    $('social-guardar').textContent = 'Añadir enlace'; $('social-cancelar').hidden = true;
  }

  function pintar() {
    $('social-lista').innerHTML = enlaces.map(e => `<article class="social-admin-card" data-social-id="${e._id}"><span class="social-admin-icon">${FutbolSocial.icono(e.icono)}</span><div><strong>${esc(e.nombre)}${e.activo ? '' : ' · Oculto'}</strong><small>${esc(e.url)}</small></div><div class="social-admin-actions"><button type="button" data-social-edit>Editar</button><button type="button" data-social-delete class="rec-danger">Eliminar</button></div></article>`).join('') || '<div class="ticket-empty">No hay enlaces sociales.</div>';
  }

  async function cargar() {
    const r = await fetch('/api/admin/redes-sociales'); const d = await r.json().catch(() => ({}));
    if (!r.ok) return $('social-lista').innerHTML = `<div class="ticket-empty">${esc(d.error || 'No se pudieron cargar.')}</div>`;
    enlaces = d.enlaces || [];
    $('social-icono').innerHTML = (d.iconos || FutbolSocial.iconos).map(i => `<option value="${i}">${i[0].toUpperCase() + i.slice(1)}</option>`).join('');
    pintar();
  }

  async function guardar(evento) {
    evento.preventDefault(); const id = $('social-id').value;
    const r = await fetch(id ? `/api/admin/redes-sociales/${id}` : '/api/admin/redes-sociales', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: $('social-nombre').value, url: $('social-url').value, icono: $('social-icono').value, orden: $('social-orden').value, activo: $('social-activo').checked }) });
    const d = await r.json().catch(() => ({})); if (!r.ok) return alert(d.error || 'No se pudo guardar.');
    limpiar(); await cargar();
  }

  function editar(id) {
    const e = enlaces.find(item => item._id === id); if (!e) return;
    $('social-id').value = e._id; $('social-nombre').value = e.nombre; $('social-url').value = e.url; $('social-icono').value = e.icono; $('social-orden').value = e.orden; $('social-activo').checked = e.activo;
    $('social-guardar').textContent = 'Guardar cambios'; $('social-cancelar').hidden = false; $('social-form').scrollIntoView({ behavior: 'smooth' });
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este enlace social?')) return;
    const r = await fetch(`/api/admin/redes-sociales/${id}`, { method: 'DELETE' }); const d = await r.json().catch(() => ({}));
    if (!r.ok) return alert(d.error || 'No se pudo eliminar.');
    if ($('social-id').value === id) limpiar(); await cargar();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('social-form').addEventListener('submit', guardar); $('social-cancelar').addEventListener('click', limpiar);
    $('social-lista').addEventListener('click', evento => { const card = evento.target.closest('[data-social-id]'); if (!card) return; if (evento.target.closest('[data-social-edit]')) editar(card.dataset.socialId); if (evento.target.closest('[data-social-delete]')) eliminar(card.dataset.socialId); });
    cargar();
  });
})();

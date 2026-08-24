function buscarConRetraso() {
  clearTimeout(temporizador);
  temporizador = setTimeout(cargarUsuarios, 350);
}

async function cargarUsuarios() {
  const q = document.getElementById('busqueda').value.trim();
  const estado = document.getElementById('filtro-usuario-estado').value;
  const parametros = new URLSearchParams({ limite: '200', q, estado });
  const resp = await fetch('/api/admin/usuarios?' + parametros.toString());
  if (!resp.ok) return;

  const { usuarios, puedeGestionarAdmins } = await resp.json();
  const tbody = document.getElementById('tbody');

  if (!usuarios.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="vacio">Sin resultados</td></tr>';
    return;
  }

  tbody.innerHTML = usuarios.map(u => {
    const clase = u.rol === 'admin' ? 'admin' : u.plan;
    const etiqueta = u.rol === 'admin' ? 'admin' : u.plan;
    const esSuspendido = u.suspendido_hasta && new Date(u.suspendido_hasta) > new Date();
    const esBloqIP = u.bloqueado_ip_duplicada;
    const estadoBadges = [
      !u.activo ? '<span class="badge expirado">desactivado</span>' : '',
      esSuspendido ? `<span class="badge suspendido">suspendido</span>` : '',
      esBloqIP ? '<span class="badge bloq-ip">bloq. IP</span>' : ''
    ].filter(Boolean).join(' ');
    return `<tr>
      <td><strong>${escaparHtml(u.nombre || '—')}</strong><br><span style="color:#64748b">${escaparHtml(u.email)}</span>
        ${estadoBadges ? '<br>' + estadoBadges : ''}</td>
      <td class="ip-text">${escaparHtml(u.ip_registro || '—')}</td>
      <td><span class="badge ${clase}">${etiqueta}</span>
        ${u.diasRestantes != null ? `<br><small>${u.diasRestantes} día(s)</small>` : ''}</td>
      <td>${fecha(u.suscripcion_termina || u.prueba_termina)}</td>
      <td>${fecha(u.fecha_registro)}</td>
      <td>${fecha(u.ultimo_acceso)}</td>
      <td class="acciones">
        <button type="button" class="btn-mes" data-accion="extender" data-usuario="${u.id}" data-meses="1">+1 mes</button>
        <button type="button" class="btn-mes" data-accion="extender" data-usuario="${u.id}" data-meses="3">+3 meses</button>
        <button type="button" class="btn-cortesia" data-accion="cortesia" data-usuario="${u.id}">🎁 Cortesía</button>
        ${esSuspendido
          ? `<button type="button" class="btn-levantar" data-accion="levantar" data-usuario="${u.id}">✅ Levantar</button>`
          : `<button type="button" class="btn-suspender" data-accion="suspender" data-usuario="${u.id}">⏸ Suspender</button>`}
        ${puedeGestionarAdmins && !u.esAdministradorPrincipal && u.rol !== 'admin' ? `<button type="button" class="btn-rol" data-accion="rol" data-usuario="${u.id}" data-rol="admin">Dar admin</button>` : ''}
        ${puedeGestionarAdmins && !u.esAdministradorPrincipal && u.rol === 'admin' ? `<button type="button" class="btn-rol" data-accion="rol" data-usuario="${u.id}" data-rol="usuario">Quitar admin</button>` : ''}
        ${esBloqIP ? `<button type="button" class="btn-desbloquear-ip" data-accion="desbloquear-ip" data-usuario="${u.id}">🔓 Desbloquear IP</button>` : ''}
        <button type="button" class="${u.activo ? 'btn-off' : 'btn-on'}" data-accion="alternar" data-usuario="${u.id}" data-activo="${!u.activo}">${u.activo ? 'Desactivar' : 'Activar'}</button>
      </td>
    </tr>`;
  }).join('');
}

async function extender(id, meses) {
  const resp = await fetch(`/api/admin/usuarios/${id}/suscripcion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meses })
  });
  const d = await resp.json();
  if (!resp.ok) return alert(d.error);
  refrescar();
}

async function cortesia(id) {
  const entrada = prompt('¿Cuántos días de cortesía quieres otorgar? (1-3650)');
  if (entrada === null || !entrada.trim()) return;
  const dias = Number(entrada);
  if (!Number.isInteger(dias) || dias < 1 || dias > 3650) return alert('Ingresa un número entero entre 1 y 3650.');
  if (!confirm(`¿Otorgar ${dias} día(s) de cortesía? No se contará como ingreso.`)) return;
  const resp = await fetch(`/api/admin/usuarios/${id}/cortesia`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dias })
  });
  const d = await resp.json();
  if (!resp.ok) return alert(d.error);
  refrescar();
}

async function cambiarRol(id, rol) {
  const accion = rol === 'admin' ? 'dar permisos de administrador' : 'quitar los permisos de administrador';
  if (!confirm(`¿Seguro que quieres ${accion} a este usuario?`)) return;
  const resp = await fetch(`/api/admin/usuarios/${id}/rol`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol }) });
  const d = await resp.json();
  if (!resp.ok) return alert(d.error);
  refrescar();
}

async function suspender(id) {
  const dias = prompt('¿Cuántos días suspender? (1-365)');
  if (!dias) return;
  const resp = await fetch(`/api/admin/usuarios/${id}/suspender`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dias: parseInt(dias) })
  });
  const d = await resp.json();
  if (!resp.ok) return alert(d.error);
  refrescar();
}

async function levantarSuspension(id) {
  const resp = await fetch(`/api/admin/usuarios/${id}/suspension`, { method: 'DELETE' });
  const d = await resp.json();
  if (!resp.ok) return alert(d.error);
  refrescar();
}

async function desbloquearIP(id) {
  if (!confirm('¿Desbloquear esta cuenta? (solo cuando el usuario pague)')) return;
  const resp = await fetch(`/api/admin/usuarios/${id}/bloqueo-ip`, { method: 'DELETE' });
  const d = await resp.json();
  if (!resp.ok) return alert(d.error);
  refrescar();
}

async function cargarIPsDuplicadas() {
  const resp = await fetch('/api/admin/ips-duplicadas');
  if (!resp.ok) return;
  const { duplicadas } = await resp.json();
  const cont = document.getElementById('ips-duplicadas');
  if (!duplicadas.length) {
    cont.innerHTML = '<p style="color:#94a3b8">No hay IPs duplicadas.</p>';
    return;
  }
  cont.innerHTML = duplicadas.map(d => `
    <div style="background:#fff;border-radius:8px;padding:14px;margin-bottom:10px;box-shadow:0 2px 8px rgba(0,0,0,.07)">
      <strong class="ip-text">${escaparHtml(d._id)}</strong> — <span style="color:#991b1b">${d.cuentas} cuentas</span>
      <ul style="margin:6px 0 0;padding-left:20px">
        ${d.usuarios.map(u => `<li>${escaparHtml(u.nombre || u.email)} <span class="badge ${u.bloqueado ? 'bloq-ip' : u.plan}">${u.bloqueado ? 'bloqueado' : u.plan}</span></li>`).join('')}
      </ul>
    </div>`).join('');
}

async function alternar(id, activo) {
  const resp = await fetch(`/api/admin/usuarios/${id}/activo`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activo })
  });
  const d = await resp.json();
  if (!resp.ok) return alert(d.error);
  refrescar();
}


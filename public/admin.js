function refrescar() {
  cargarResumen();
  cargarUsuarios();
  cargarIPsDuplicadas();
  cargarTickets();
  cargarRecomendacionesAdmin();
}

function instalarEventos() {
  document.getElementById('admin-menu').addEventListener('click', evento => {
    const boton = evento.target.closest('[data-admin-panel]');
    if (!boton) return;
    mostrarPanelAdmin(boton.dataset.adminPanel);
  });
  window.addEventListener('hashchange', () => mostrarPanelAdmin(location.hash.slice(1), false));
  document.getElementById('rec-form').addEventListener('submit', guardarRecomendacion);
  document.getElementById('rec-tipo').addEventListener('change', () => { ajustarSelecciones(); actualizarMomioTotal(); });
  document.getElementById('rec-cierra').addEventListener('change', cargarPartidosRecomendacion);
  document.getElementById('rec-agregar').addEventListener('click', () => {
    const tipo = document.getElementById('rec-tipo');
    if (tipo.value === 'pick') tipo.value = 'parlay';
    agregarSeleccion();
    ajustarSelecciones();
    actualizarMomioTotal();
  });
  document.getElementById('rec-cancelar').addEventListener('click', limpiarRecomendacion);
  document.getElementById('rec-selecciones').addEventListener('click', evento => {
    const boton = evento.target.closest('[data-rec-quitar]');
    if (!boton) return;
    boton.closest('.rec-selection').remove();
    ajustarSelecciones();
    actualizarMomioTotal();
  });
  document.getElementById('rec-selecciones').addEventListener('change', evento => {
    const fila = evento.target.closest('.rec-selection');
    if (!fila) return;
    if (evento.target.matches('[data-rec="partido"], [data-rec="periodo"]')) cargarMercadosFila(fila);
    if (evento.target.matches('[data-rec="categoria"], [data-rec="alcance"], [data-rec="direccion"], [data-rec="linea"]')) pintarMercadosFila(fila);
    if (evento.target.matches('[data-rec="formato"]')) {
      normalizarCienAmericano(fila.querySelector('[data-rec="momio"]'), evento.target.value);
      actualizarMomioTotal();
    }
  });
  document.getElementById('rec-selecciones').addEventListener('input', evento => {
    if (evento.target.matches('[data-rec="momio"]')) {
      const fila = evento.target.closest('.rec-selection');
      normalizarCienAmericano(evento.target, fila.querySelector('[data-rec="formato"]').value);
      actualizarMomioTotal();
    }
    if (evento.target.matches('[data-rec="buscar-partido"]')) {
      const fila = evento.target.closest('.rec-selection');
      poblarPartidosFila(fila, fila.querySelector('[data-rec="partido"]').value);
    }
  });
  document.getElementById('rec-momio-total').addEventListener('input', evento => {
    normalizarCienAmericano(evento.target, document.getElementById('rec-formato-total').value);
    momioTotalManual = Boolean(evento.target.value.trim());
  });
  document.getElementById('rec-formato-total').addEventListener('change', () => {
    momioTotalManual = false;
    actualizarMomioTotal(true);
  });
  document.getElementById('rec-lista').addEventListener('click', evento => {
    const editar = evento.target.closest('[data-rec-editar]');
    const eliminar = evento.target.closest('[data-rec-eliminar]');
    if (editar) editarRecomendacion(editar.dataset.recEditar);
    if (eliminar) eliminarRecomendacion(eliminar.dataset.recEliminar);
  });
  document.getElementById('quality-refresh').addEventListener('click', cargarCalidadDatos);
  document.getElementById('quality-revalidate-form').addEventListener('submit', revalidarDesdeCalidad);
  document.getElementById('quality-detail').addEventListener('click', manejarAccionCalidad);
  document.getElementById('filtro-ticket-estado').addEventListener('change', cargarTickets);
  document.getElementById('filtro-ticket-tipo').addEventListener('change', cargarTickets);
  document.getElementById('busqueda').addEventListener('input', buscarConRetraso);
  document.getElementById('filtro-usuario-estado').addEventListener('change', cargarUsuarios);

  document.getElementById('admin-tickets').addEventListener('click', evento => {
    const boton = evento.target.closest('[data-accion="guardar-ticket"]');
    if (!boton) return;
    const tarjeta = boton.closest('[data-ticket]');
    if (tarjeta) actualizarTicket(tarjeta.dataset.ticket, boton);
  });

  document.getElementById('tbody').addEventListener('click', evento => {
    const boton = evento.target.closest('button[data-accion][data-usuario]');
    if (!boton) return;
    const id = boton.dataset.usuario;
    switch (boton.dataset.accion) {
      case 'extender': extender(id, Number(boton.dataset.meses)); break;
      case 'cortesia': cortesia(id); break;
      case 'rol': cambiarRol(id, boton.dataset.rol); break;
      case 'suspender': suspender(id); break;
      case 'levantar': levantarSuspension(id); break;
      case 'desbloquear-ip': desbloquearIP(id); break;
      case 'alternar': alternar(id, boton.dataset.activo === 'true'); break;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  mostrarPanelAdmin(location.hash.slice(1) || 'resumen');
  limpiarRecomendacion();
  instalarEventos();
  refrescar();
});

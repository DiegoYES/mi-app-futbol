(function () {
  const VERSION_TERMINOS = '2026-08-08';
  const consentimiento = document.getElementById('billing-consent');
  const suscribir = document.getElementById('billing-subscribe');
  const cancelar = document.getElementById('billing-cancel');
  const estado = document.getElementById('billing-status');

  function mensaje(texto, error = false) {
    estado.textContent = texto;
    estado.classList.toggle('billing-error', error);
  }

  function fechaLocal(valor) {
    return valor ? new Date(valor).toLocaleDateString('es-MX') : 'la fecha indicada';
  }

  function mostrarCancelada(accesoHasta) {
    cancelar.hidden = true;
    consentimiento.parentElement.hidden = false;
    suscribir.hidden = false;
    suscribir.textContent = 'Suscribirme de nuevo';
    suscribir.disabled = !consentimiento.checked;
    mensaje(`Renovación cancelada. Conservarás tu acceso Premium hasta ${fechaLocal(accesoHasta)}.`);
  }

  consentimiento.addEventListener('change', () => {
    suscribir.disabled = !consentimiento.checked;
  });

  suscribir.addEventListener('click', async () => {
    if (!consentimiento.checked) return;
    suscribir.disabled = true;
    mensaje('Preparando el checkout seguro…');
    try {
      const respuesta = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acepta_terminos: true, version_terminos: VERSION_TERMINOS })
      });
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.checkout_url) throw new Error(datos.error || 'No se pudo iniciar el pago.');
      window.location.assign(datos.checkout_url);
    } catch (error) {
      mensaje(error.message, true);
      suscribir.disabled = false;
    }
  });

  cancelar.addEventListener('click', async () => {
    if (!window.confirm('¿Quieres cancelar las próximas renovaciones? Conservarás el acceso ya pagado hasta su vencimiento.')) return;
    cancelar.disabled = true;
    mensaje('Cancelando la renovación…');
    try {
      const respuesta = await fetch('/api/billing/cancel', { method: 'POST' });
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error || 'No se pudo cancelar.');
      mostrarCancelada(datos.acceso_hasta);
    } catch (error) {
      mensaje(error.message, true);
      cancelar.disabled = false;
    }
  });

  async function cargar() {
    try {
      const respuesta = await fetch('/api/billing/status');
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error || 'No se pudo consultar la membresía.');
      const actual = datos.suscripcion;
      if (!actual) return mensaje('No tienes una suscripción activa.');
      if (actual.estado === 'autorizada') {
        suscribir.hidden = true;
        consentimiento.parentElement.hidden = true;
        cancelar.hidden = false;
        const proximo = actual.proximo_cobro ? new Date(actual.proximo_cobro).toLocaleDateString('es-MX') : 'por confirmar';
        return mensaje(`Membresía activa. Próxima renovación: ${proximo}.`);
      }
      if (actual.estado === 'pendiente') return mensaje('Tienes un checkout pendiente; puedes continuar cuando estés listo.');
      if (actual.estado === 'cancelada') return mostrarCancelada(actual.periodo_fin);
      mensaje(`Estado actual: ${actual.estado}.`);
    } catch (error) {
      mensaje(error.message, true);
    }
  }

  cargar();
})();

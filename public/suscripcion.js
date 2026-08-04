(function () {
  const consentimiento = document.getElementById('billing-consent');
  const suscribir = document.getElementById('billing-subscribe');
  const cancelar = document.getElementById('billing-cancel');
  const estado = document.getElementById('billing-status');

  function mensaje(texto, error = false) {
    estado.textContent = texto;
    estado.classList.toggle('billing-error', error);
  }

  consentimiento.addEventListener('change', () => {
    suscribir.disabled = !consentimiento.checked;
  });

  suscribir.addEventListener('click', async () => {
    if (!consentimiento.checked) return;
    suscribir.disabled = true;
    mensaje('Preparando el checkout seguro…');
    try {
      const respuesta = await fetch('/api/billing/subscribe', { method: 'POST' });
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
      mensaje(datos.mensaje);
      cancelar.hidden = true;
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
      mensaje(`Estado actual: ${actual.estado}.`);
    } catch (error) {
      mensaje(error.message, true);
    }
  }

  cargar();
})();

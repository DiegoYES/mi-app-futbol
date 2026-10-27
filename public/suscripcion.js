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

  // Gestión del modal para reportar problemas de pago
  const modalPago = document.getElementById('modal-ticket-pago');
  const btnAbrirPago = document.getElementById('btn-problema-pago');
  const btnCerrarPago = document.getElementById('cerrar-modal-pago');
  const btnCancelarPago = document.getElementById('btn-cancelar-modal-pago');
  const formPago = document.getElementById('form-ticket-pago');
  const msgPago = document.getElementById('msg-ticket-pago');
  const btnEnviarPago = document.getElementById('btn-enviar-ticket-pago');

  function abrirModalPago() {
    if (!modalPago) return;
    if (msgPago) {
      msgPago.textContent = '';
      msgPago.className = 'billing-msg-feedback';
    }
    if (typeof modalPago.showModal === 'function') {
      modalPago.showModal();
    } else {
      modalPago.setAttribute('open', '');
    }
  }

  function cerrarModalPago() {
    if (!modalPago) return;
    if (typeof modalPago.close === 'function') {
      modalPago.close();
    } else {
      modalPago.removeAttribute('open');
    }
  }

  if (btnAbrirPago) btnAbrirPago.addEventListener('click', abrirModalPago);
  if (btnCerrarPago) btnCerrarPago.addEventListener('click', cerrarModalPago);
  if (btnCancelarPago) btnCancelarPago.addEventListener('click', cerrarModalPago);

  if (modalPago) {
    modalPago.addEventListener('click', (e) => {
      const rect = modalPago.getBoundingClientRect();
      const clickEnDialog = (
        rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width
      );
      if (!clickEnDialog) cerrarModalPago();
    });
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('problema') === '1' || urlParams.get('reportar') === '1' || urlParams.get('tipo') === 'pago') {
    abrirModalPago();
  }

  if (formPago) {
    formPago.addEventListener('submit', async (e) => {
      e.preventDefault();
      const asunto = document.getElementById('pago-asunto').value.trim();
      const referencia_pago = document.getElementById('pago-referencia').value.trim();
      const evidencia_url = document.getElementById('pago-evidencia').value.trim();
      const descripcion = document.getElementById('pago-descripcion').value.trim();

      if (btnEnviarPago) btnEnviarPago.disabled = true;
      if (msgPago) {
        msgPago.className = 'billing-msg-feedback';
        msgPago.textContent = 'Enviando reporte…';
      }

      try {
        const resp = await fetch('/api/sugerencias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tipo: 'pago',
            asunto,
            referencia_pago,
            evidencia_url,
            descripcion
          })
        });
        const datos = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(datos.error || 'No se pudo enviar el reporte.');

        if (msgPago) {
          msgPago.className = 'billing-msg-feedback ok';
          msgPago.innerHTML = (datos.mensaje || 'Reporte recibido.') + ' Puedes dar seguimiento en <a href="/sugerencias.html" style="color:var(--cyan);text-decoration:underline;font-weight:750">Tus tickets</a>.';
        }
        formPago.reset();
        const inputAsunto = document.getElementById('pago-asunto');
        if (inputAsunto) inputAsunto.value = 'Problema con acreditación de pago Mercado Pago';
        setTimeout(() => {
          if (btnEnviarPago) btnEnviarPago.disabled = false;
        }, 2500);
      } catch (err) {
        if (msgPago) {
          msgPago.className = 'billing-msg-feedback error';
          msgPago.textContent = err.message;
        }
        if (btnEnviarPago) btnEnviarPago.disabled = false;
      }
    });
  }
})();

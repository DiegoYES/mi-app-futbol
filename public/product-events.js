(() => {
  const permitidos = new Set([
    'landing_view', 'trial_cta_click', 'calendar_view', 'comparator_view', 'subscription_view'
  ]);

  function track(evento) {
    if (!permitidos.has(evento)) return false;
    const cuerpo = JSON.stringify({ evento });
    if (navigator.sendBeacon) {
      const enviado = navigator.sendBeacon('/api/eventos-producto', new Blob([cuerpo], { type: 'application/json' }));
      if (enviado) return true;
    }
    fetch('/api/eventos-producto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: cuerpo,
      keepalive: true
    }).catch(() => {});
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.productEvent) track(document.body.dataset.productEvent);
    document.addEventListener('click', evento => {
      const elemento = evento.target.closest('[data-product-event], .landing-cta');
      if (elemento) track(elemento.dataset.productEvent || 'trial_cta_click');
    });
  });

  window.DataFutEvents = { track };
})();

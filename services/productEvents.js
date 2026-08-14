const EVENTOS_PRODUCTO = Object.freeze([
  'landing_view', 'trial_cta_click', 'calendar_view', 'comparator_view',
  'subscription_view', 'registration_active', 'registration_ip_limited', 'checkout_started'
]);
const EVENTOS_PERMITIDOS = new Set(EVENTOS_PRODUCTO);
const EVENTOS_NAVEGADOR = new Set([
  'landing_view', 'trial_cta_click', 'calendar_view', 'comparator_view', 'subscription_view'
]);

function esEventoProducto(evento) {
  return typeof evento === 'string' && EVENTOS_PERMITIDOS.has(evento);
}

function esEventoNavegador(evento) {
  return typeof evento === 'string' && EVENTOS_NAVEGADOR.has(evento);
}

function crearRegistradorEventosProducto({
  escribir = linea => console.log(linea),
  ahora = () => new Date(),
  entorno = process.env.APP_ENVIRONMENT || process.env.NODE_ENV || 'unknown'
} = {}) {
  return evento => {
    if (!esEventoProducto(evento)) return false;
    const registro = { event: evento, at: ahora().toISOString(), environment: entorno };
    escribir(`[product-event] ${JSON.stringify(registro)}`);
    return true;
  };
}

const registrarEventoProducto = crearRegistradorEventosProducto();

module.exports = {
  EVENTOS_PRODUCTO,
  crearRegistradorEventosProducto,
  esEventoNavegador,
  esEventoProducto,
  registrarEventoProducto
};

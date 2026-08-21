const EVENTOS_SEGURIDAD = new Set([
  'account_profile_updated',
  'account_password_changed',
  'account_sessions_revoked'
]);

function crearAuditorSeguridad({
  escribir = linea => console.info(linea),
  ahora = () => new Date(),
  entorno = process.env.APP_ENVIRONMENT || process.env.NODE_ENV || 'unknown'
} = {}) {
  return (evento, req) => {
    if (!EVENTOS_SEGURIDAD.has(evento) || !req?.usuario?._id) return false;
    const registro = {
      event: evento,
      at: ahora().toISOString(),
      environment: entorno,
      user_id: String(req.usuario._id),
      request_id: req.requestId || null
    };
    escribir(`[security-audit] ${JSON.stringify(registro)}`);
    return true;
  };
}

const registrarEventoSeguridad = crearAuditorSeguridad();

module.exports = { EVENTOS_SEGURIDAD, crearAuditorSeguridad, registrarEventoSeguridad };

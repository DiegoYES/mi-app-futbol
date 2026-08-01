const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

function enteroEnRango(valor, fallback, minimo, maximo) {
  const numero = Number.parseInt(valor, 10);
  return Number.isInteger(numero) ? Math.min(Math.max(numero, minimo), maximo) : fallback;
}

function configurarProxy(app, env = process.env) {
  const solicitado = String(env.TRUST_PROXY || '').trim();
  const saltos = solicitado ? enteroEnRango(solicitado, 0, 0, 10) : 0;
  app.set('trust proxy', saltos);
  return saltos;
}

function asignarIdSolicitud(req, res, next) {
  const recibido = String(req.get('x-request-id') || '');
  const requestId = /^[a-zA-Z0-9_.:-]{8,80}$/.test(recibido)
    ? recibido
    : crypto.randomUUID();
  req.requestId = requestId;
  res.set('X-Request-Id', requestId);
  next();
}

function origenesPermitidos(env = process.env) {
  return new Set(String(env.APP_ORIGIN || '')
    .split(',')
    .map(item => normalizarOrigen(item)?.origin)
    .filter(Boolean));
}

function normalizarOrigen(valor) {
  try {
    const url = new URL(String(valor || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch (_error) {
    return null;
  }
}

function validarOrigenNavegador(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();

  const origenNavegador = normalizarOrigen(origin);
  const permitidos = origenesPermitidos();
  const hostSolicitud = String(req.get('host') || '').toLowerCase();

  // Un proxy TLS (por ejemplo Cloudflare Tunnel) puede entregar la petición a
  // Express por HTTP aunque el navegador haya abierto el mismo host por HTTPS.
  // El host debe coincidir exactamente; un sitio externo conserva otro Origin.
  const esMismoHost = origenNavegador?.host.toLowerCase() === hostSolicitud;
  if (esMismoHost || permitidos.has(origenNavegador?.origin)) {
    return next();
  }
  return res.status(403).json({
    error: 'Origen de solicitud no permitido.',
    codigo: 'ORIGEN_NO_PERMITIDO'
  });
}

// Un parámetro repetido (?q=a&q=b) llega como arreglo; nos quedamos con el
// último valor de texto para no romper con un TypeError ni pasar arreglos a Mongo.
function textoDeConsulta(valor, maximo = 80) {
  const bruto = Array.isArray(valor) ? valor[valor.length - 1] : valor;
  if (typeof bruto !== 'string') return '';
  return bruto.trim().slice(0, maximo);
}

// Neutraliza los metacaracteres para que una búsqueda de usuario nunca se
// interprete como expresión regular (inyección de regex y ReDoS).
function escaparRegex(valor) {
  return String(valor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Avisos de arranque: detectan la configuración que deja la sesión sin
// protección aunque la app parezca funcionar con normalidad.
function revisarConfiguracionSegura(env = process.env) {
  const avisos = [];
  const produccion = env.NODE_ENV === 'production';

  if (!produccion) {
    avisos.push('NODE_ENV no es "production": la cookie de sesión sale sin el atributo Secure y no se envía HSTS. No expongas este proceso a Internet así.');
  }
  if (produccion && !String(env.TRUST_PROXY || '').trim()) {
    avisos.push('TRUST_PROXY no está definido. Si hay un proxy o túnel delante (Nginx, Cloudflare), todas las peticiones comparten la misma IP: el límite de intentos de login deja de aislar atacantes y el control de cuentas duplicadas por IP no funciona.');
  }
  if (produccion && !origenesPermitidos(env).size) {
    avisos.push('APP_ORIGIN está vacío: la validación de origen sólo puede comparar contra la cabecera Host. Define tu dominio público para reforzar la protección CSRF.');
  }
  return avisos;
}

// Respuesta 500 uniforme: el detalle real queda en el log del servidor y el
// cliente sólo recibe un mensaje genérico más el id de solicitud para soporte.
function errorServidor(res, error, mensaje = 'Ocurrió un error al procesar la solicitud.') {
  const req = res.req || {};
  console.error(`[${req.requestId || 'sin-id'}] ${req.method || ''} ${req.originalUrl || ''}`, error);
  return res.status(500).json({
    error: mensaje,
    codigo: 'ERROR_INTERNO',
    requestId: req.requestId || null
  });
}

function respuestaLimite(_req, res) {  return res.status(429).json({
    error: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
    codigo: 'RATE_LIMIT'
  });
}

const limiteApi = rateLimit({
  windowMs: 60_000,
  limit: enteroEnRango(process.env.API_RATE_LIMIT_PER_MINUTE, 240, 30, 3000),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: respuestaLimite
});

const limiteUsuario = rateLimit({
  windowMs: 60_000,
  limit: enteroEnRango(process.env.USER_RATE_LIMIT_PER_MINUTE, 120, 20, 2000),
  keyGenerator: req => String(req.usuario?._id || 'sin-usuario'),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: respuestaLimite
});

function manejarJsonInvalido(error, _req, res, next) {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'La solicitud es demasiado grande.', codigo: 'BODY_MUY_GRANDE' });
  }
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'El JSON enviado no es válido.', codigo: 'JSON_INVALIDO' });
  }
  return next(error);
}

module.exports = {
  asignarIdSolicitud,
  configurarProxy,
  errorServidor,
  escaparRegex,
  limiteApi,  limiteUsuario,
  manejarJsonInvalido,
  origenesPermitidos,
  revisarConfiguracionSegura,
  textoDeConsulta,
  validarOrigenNavegador
};

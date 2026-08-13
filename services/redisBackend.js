const { createClient } = require('redis');
const { RedisStore } = require('rate-limit-redis');

let cliente = null;
let conexion = null;
let ultimoAvisoError = 0;

function redisHabilitado(env = process.env) {
  return Boolean(String(env.REDIS_URL || '').trim() || String(env.REDIS_SOCKET || '').trim());
}

function normalizarPrefijoRedis(valor) {
  const limpio = String(valor || 'development')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^:+|:+$/g, '')
    .slice(0, 80) || 'development';
  return limpio.endsWith(':') ? limpio : `${limpio}:`;
}

function obtenerPrefijoRedis(env = process.env) {
  const entorno = env.APP_ENVIRONMENT || env.NODE_ENV || 'development';
  return normalizarPrefijoRedis(env.REDIS_KEY_PREFIX || `datafut:${entorno}`);
}

function crearCliente() {
  const connectTimeout = Math.min(Math.max(Number.parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 10) || 3000, 500), 15_000);
  const maxReintentos = Math.min(Math.max(Number.parseInt(process.env.REDIS_RECONNECT_RETRIES, 10) || 5, 0), 30);
  const redisUrl = String(process.env.REDIS_URL || '').trim();
  const redisSocket = String(process.env.REDIS_SOCKET || '').trim();
  const socket = {
      connectTimeout,
      reconnectStrategy: reintentos => reintentos > maxReintentos
        ? new Error('Redis agotó los reintentos de conexión.')
        : Math.min(100 * (2 ** reintentos), 2000)
  };
  if (!redisUrl) socket.path = redisSocket;
  const nuevo = createClient({ ...(redisUrl ? { url: redisUrl } : {}), socket });
  nuevo.on('error', error => {
    const ahora = Date.now();
    if (ahora - ultimoAvisoError >= 30_000) {
      ultimoAvisoError = ahora;
      console.error(`⚠️ Redis no disponible: ${error.code || error.name || 'error de conexión'}`);
    }
  });
  return nuevo;
}

function obtenerClienteRedis() {
  if (!redisHabilitado()) return null;
  cliente ||= crearCliente();
  return cliente;
}

async function conectarRedis() {
  if (!redisHabilitado()) return null;
  const actual = obtenerClienteRedis();
  if (actual.isReady) return actual;
  if (!conexion) {
    conexion = actual.connect()
      .then(() => {
        console.log('✅ Conectado a Redis');
        return actual;
      })
      .catch(error => {
        conexion = null;
        throw error;
      });
  }
  return conexion;
}

async function cerrarRedis() {
  if (cliente?.isOpen) await cliente.close();
  cliente = null;
  conexion = null;
}

function redisListo() {
  return !redisHabilitado() || Boolean(cliente?.isReady);
}

function estadoRedis() {
  if (!redisHabilitado()) return 'deshabilitado';
  return redisListo() ? 'ok' : 'no_disponible';
}

function claveRedis(espacio, clave = '') {
  return `${obtenerPrefijoRedis()}${espacio}:${clave}`;
}

function crearStoreRateLimit(nombre) {
  if (!redisHabilitado()) return undefined;
  const actual = obtenerClienteRedis();
  return new RedisStore({
    prefix: claveRedis('rate-limit', `${nombre}:`),
    sendCommand: async (...args) => {
      const listo = actual.isReady ? actual : await conectarRedis();
      return listo.sendCommand(args);
    }
  });
}

module.exports = {
  cerrarRedis,
  claveRedis,
  conectarRedis,
  crearStoreRateLimit,
  estadoRedis,
  normalizarPrefijoRedis,
  obtenerClienteRedis,
  obtenerPrefijoRedis,
  redisHabilitado,
  redisListo
};

const NodeCache = require('node-cache');
const {
  claveRedis,
  obtenerClienteRedis,
  redisHabilitado,
  redisListo
} = require('../services/redisBackend');

// TTL por defecto: 1 hora para datos estáticos (estadísticas históricas, equipos, árbitros).
// El h2h y forma reciente usan TTL corto porque se actualizan el día del partido.
const maxKeys = Math.min(Math.max(Number.parseInt(process.env.CACHE_MAX_KEYS, 10) || 5000, 100), 50_000);
const cacheLocal = new NodeCache({ stdTTL: 3600, checkperiod: 600, maxKeys, useClones: false });
const enCurso = new Map();
let solicitudesCoalescidas = 0;
let erroresRedis = 0;

const TTL_CORTO = 600;
const PATRONES_TTL_CORTO = ['/h2h', '/historial', '/estadisticas-detalladas', '/calendario/'];

function clienteRedisListo() {
  const actual = obtenerClienteRedis();
  return actual?.isReady ? actual : null;
}

async function leerCache(key) {
  const redis = clienteRedisListo();
  if (redis) {
    try {
      const serializado = await redis.get(claveRedis('cache', key));
      return serializado === null ? undefined : JSON.parse(serializado);
    } catch (error) {
      erroresRedis += 1;
      console.warn(`⚠️ No se pudo leer la caché Redis: ${error.code || error.name || 'error'}`);
    }
  }
  return cacheLocal.get(key);
}

async function guardarCache(key, body, ttl) {
  const redis = clienteRedisListo();
  if (redis) {
    try {
      await redis.set(claveRedis('cache', key), JSON.stringify(body), { EX: ttl });
      return;
    } catch (error) {
      erroresRedis += 1;
      console.warn(`⚠️ No se pudo guardar la caché Redis: ${error.code || error.name || 'error'}`);
    }
  }
  try {
    cacheLocal.set(key, body, ttl);
  } catch (error) {
    console.warn(`⚠️ No se pudo guardar ${key} en caché local: ${error.code || error.message}`);
  }
}

async function cacheMiddleware(req, res, next) {
  const key = req.originalUrl;
  let cached = await leerCache(key);
  if (cached !== undefined) {
    res.set('X-Cache', 'HIT');
    return res.json(cached);
  }

  if (enCurso.has(key)) {
    solicitudesCoalescidas += 1;
    await enCurso.get(key);
    cached = await leerCache(key);
    if (cached !== undefined) {
      res.set('X-Cache', 'COALESCED');
      return res.json(cached);
    }
  }
  res.set('X-Cache', 'MISS');

  const ttl = PATRONES_TTL_CORTO.some(p => key.includes(p)) ? TTL_CORTO : 3600;
  const originalJson = res.json.bind(res);
  let resolver;
  let escritura = Promise.resolve();
  const pendiente = new Promise(resolve => { resolver = resolve; });
  enCurso.set(key, pendiente);
  const finalizar = () => {
    escritura.finally(() => {
      if (enCurso.get(key) === pendiente) enCurso.delete(key);
      resolver();
    });
  };
  res.once('finish', finalizar);
  res.once('close', finalizar);
  res.json = body => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      escritura = guardarCache(key, body, ttl);
    }
    return originalJson(body);
  };
  return next();
}

async function limpiarCache(patron) {
  if (patron) {
    cacheLocal.keys().filter(k => k.includes(patron)).forEach(k => cacheLocal.del(k));
  } else {
    cacheLocal.flushAll();
  }

  const redis = clienteRedisListo();
  if (!redis) return;
  const prefijo = claveRedis('cache', '');
  for await (const resultado of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
    const claves = (Array.isArray(resultado) ? resultado : [resultado])
      .filter(key => !patron || key.includes(patron));
    if (claves.length) await redis.unlink(claves);
  }
}

function obtenerEstadisticasCache() {
  return {
    ...cacheLocal.getStats(),
    max_keys: maxKeys,
    pendientes: enCurso.size,
    solicitudes_coalescidas: solicitudesCoalescidas,
    errores_redis: erroresRedis,
    backend: redisHabilitado()
      ? (redisListo() ? 'redis-compartido' : 'redis-no-disponible')
      : 'memoria-local'
  };
}

module.exports = { cacheMiddleware, limpiarCache, obtenerEstadisticasCache };

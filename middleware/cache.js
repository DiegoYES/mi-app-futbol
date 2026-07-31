const NodeCache = require('node-cache');

// TTL por defecto: 1 hora para datos estáticos (estadísticas históricas, equipos, árbitros)
// El h2h y forma reciente usan TTL corto porque se actualizan el día del partido
const maxKeys = Math.min(Math.max(Number.parseInt(process.env.CACHE_MAX_KEYS, 10) || 5000, 100), 50_000);
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600, maxKeys, useClones: false });
const enCurso = new Map();
let solicitudesCoalescidas = 0;

// TTL corto (10 min) para endpoints que cambian el día del partido
const TTL_CORTO = 600;
const PATRONES_TTL_CORTO = ['/h2h', '/historial', '/estadisticas-detalladas', '/calendario/'];

async function cacheMiddleware(req, res, next) {
  const key = req.originalUrl;
  let cached = cache.get(key);
  if (cached !== undefined) {
    console.log(`✅ Caché hit: ${key}`);
    res.set('X-Cache', 'HIT');
    return res.json(cached);
  }

  // Si otra solicitud idéntica ya consulta MongoDB, espera su resultado. Esto
  // evita estampidas de caché al vencer un dato popular.
  if (enCurso.has(key)) {
    solicitudesCoalescidas += 1;
    await enCurso.get(key);
    cached = cache.get(key);
    if (cached !== undefined) {
      res.set('X-Cache', 'COALESCED');
      return res.json(cached);
    }
  }
  res.set('X-Cache', 'MISS');

  const ttl = PATRONES_TTL_CORTO.some(p => key.includes(p)) ? TTL_CORTO : 3600;

  const originalJson = res.json.bind(res);
  let resolver;
  const pendiente = new Promise(resolve => { resolver = resolve; });
  enCurso.set(key, pendiente);
  const finalizar = () => {
    if (enCurso.get(key) === pendiente) enCurso.delete(key);
    resolver();
  };
  res.once('finish', finalizar);
  res.once('close', finalizar);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        cache.set(key, body, ttl);
      } catch (error) {
        // Un caché lleno nunca debe tumbar la respuesta principal.
        console.warn(`⚠️ No se pudo guardar ${key} en caché: ${error.code || error.message}`);
      }
    }
    return originalJson(body);
  };
  next();
}

function limpiarCache(patron) {
  if (patron) {
    cache.keys().filter(k => k.includes(patron)).forEach(k => cache.del(k));
  } else {
    cache.flushAll();
  }
}

function obtenerEstadisticasCache() {
  return {
    ...cache.getStats(),
    max_keys: maxKeys,
    pendientes: enCurso.size,
    solicitudes_coalescidas: solicitudesCoalescidas,
    backend: 'memoria-local'
  };
}

module.exports = { cacheMiddleware, limpiarCache, obtenerEstadisticasCache };

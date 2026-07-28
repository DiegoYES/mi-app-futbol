const NodeCache = require('node-cache');

// TTL por defecto: 1 hora para datos estáticos (estadísticas históricas, equipos, árbitros)
// El h2h y forma reciente usan TTL corto porque se actualizan el día del partido
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// TTL corto (10 min) para endpoints que cambian el día del partido
const TTL_CORTO = 600;
const PATRONES_TTL_CORTO = ['/h2h', '/historial', '/estadisticas-detalladas'];

function cacheMiddleware(req, res, next) {
  const key = req.originalUrl;
  const cached = cache.get(key);
  if (cached !== undefined) {
    console.log(`✅ Caché hit: ${key}`);
    return res.json(cached);
  }

  const ttl = PATRONES_TTL_CORTO.some(p => key.includes(p)) ? TTL_CORTO : 3600;

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      cache.set(key, body, ttl);
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

module.exports = { cacheMiddleware, limpiarCache };

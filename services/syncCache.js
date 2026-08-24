const { limpiarCache } = require('../middleware/cache');
const { conectarRedis, cerrarRedis, redisHabilitado } = require('./redisBackend');

const PATRONES_DATOS_PARTIDOS = [
  '/calendario/',
  '/estadisticas-detalladas',
  '/historial',
  '/h2h',
  '/api/partidos/',
  '/api/picks'
];

async function invalidarCacheDatosPartidos() {
  const compartida = redisHabilitado();
  if (compartida) await conectarRedis();
  try {
    for (const patron of PATRONES_DATOS_PARTIDOS) await limpiarCache(patron);
  } finally {
    if (compartida) await cerrarRedis();
  }
}

module.exports = { invalidarCacheDatosPartidos, PATRONES_DATOS_PARTIDOS };

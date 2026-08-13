const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  crearStoreRateLimit,
  estadoRedis,
  normalizarPrefijoRedis,
  redisHabilitado,
  redisListo
} = require('../services/redisBackend');

test('Redis es opcional y conserva el backend local cuando no hay URL', () => {
  assert.equal(redisHabilitado({}), false);
  assert.equal(redisHabilitado({ REDIS_URL: 'redis://127.0.0.1:6379' }), true);
  assert.equal(redisHabilitado({ REDIS_SOCKET: '/run/redis/redis-server.sock' }), true);
  assert.equal(redisListo(), true);
  assert.equal(estadoRedis(), 'deshabilitado');
  assert.equal(crearStoreRateLimit('prueba'), undefined);
});

test('normaliza prefijos Redis separados y acotados por entorno', () => {
  assert.equal(normalizarPrefijoRedis('datafut:staging'), 'datafut:staging:');
  assert.equal(normalizarPrefijoRedis(' Data Fut / Producción '), 'data-fut-producci-n:');
  assert.ok(normalizarPrefijoRedis('x'.repeat(200)).length <= 81);
});

test('todos los limitadores de aplicación usan la factoría compartida', () => {
  const archivos = [
    ['middleware/security.js', ['api', 'usuario', 'escudos']],
    ['routes/auth.js', ['auth']],
    ['routes/billing.js', ['billing']],
    ['routes/sugerencias.js', ['sugerencias']]
  ];
  for (const [archivo, nombres] of archivos) {
    const fuente = fs.readFileSync(path.join(__dirname, '..', archivo), 'utf8');
    assert.doesNotMatch(fuente, /require\(['"]express-rate-limit['"]\)/, archivo);
    for (const nombre of nombres) {
      assert.match(fuente, new RegExp(`crearLimitador\\('${nombre}'`), `${archivo}: ${nombre}`);
    }
  }
});

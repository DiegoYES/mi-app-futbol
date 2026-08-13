const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fuente = fs.readFileSync(path.join(__dirname, '..', 'routes', 'home.js'), 'utf8');

test('cachea catálogos globales sin compartir el resumen personal', () => {
  assert.match(fuente, /router\.get\('\/competiciones', cacheMiddleware,/);
  assert.match(fuente, /router\.get\('\/competiciones\/:id', cacheMiddleware,/);
  assert.doesNotMatch(fuente, /router\.get\('\/resumen', cacheMiddleware,/);
  assert.match(fuente, /obtenerOCrearCache\(CACHE_RESUMEN_GLOBAL,/);
  assert.match(fuente, /PickGuardado\.countDocuments\(\{ usuario: req\.usuario\._id \}\)/);
  assert.match(fuente, /Boleta\.countDocuments\(\{ usuario: req\.usuario\._id \}\)/);
});

test('la caché interna coalesce cálculos globales sin guardar una respuesta HTTP', async () => {
  const { limpiarCache, obtenerOCrearCache } = require('../middleware/cache');
  const key = 'test:resumen-global-coalescido';
  await limpiarCache(key);
  let calculos = 0;
  const calcular = async () => {
    calculos += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return { global: true };
  };

  const [primero, segundo] = await Promise.all([
    obtenerOCrearCache(key, calcular, 60),
    obtenerOCrearCache(key, calcular, 60)
  ]);
  const tercero = await obtenerOCrearCache(key, calcular, 60);

  assert.deepEqual(primero, { global: true });
  assert.deepEqual(segundo, { global: true });
  assert.deepEqual(tercero, { global: true });
  assert.equal(calculos, 1);
  await limpiarCache(key);
});

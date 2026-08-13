const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fuente = fs.readFileSync(path.join(__dirname, '..', 'routes', 'home.js'), 'utf8');

test('cachea catálogos globales sin compartir el resumen personal', () => {
  assert.match(fuente, /router\.get\('\/competiciones', cacheMiddleware,/);
  assert.match(fuente, /router\.get\('\/competiciones\/:id', cacheMiddleware,/);
  assert.doesNotMatch(fuente, /router\.get\('\/resumen', cacheMiddleware,/);
});

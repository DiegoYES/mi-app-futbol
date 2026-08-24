const test = require('node:test');
const assert = require('node:assert/strict');
const EnlaceSocial = require('../models/EnlaceSocial');
const { ICONOS_SOCIALES, normalizarEnlaceSocial } = require('../services/socialLinks');

test('catálogo social contiene las redes principales', () => {
  for (const icono of ['instagram', 'x', 'facebook', 'tiktok', 'youtube', 'link']) assert.ok(ICONOS_SOCIALES.includes(icono));
});

test('normaliza un enlace social y rechaza protocolos o iconos peligrosos', () => {
  assert.deepEqual(normalizarEnlaceSocial({ nombre: ' Instagram ', url: 'https://instagram.com/data_fut26', icono: 'instagram', orden: '10' }).datos, {
    nombre: 'Instagram', url: 'https://instagram.com/data_fut26', icono: 'instagram', activo: true, orden: 10
  });
  assert.match(normalizarEnlaceSocial({ nombre: 'Malo', url: 'javascript:alert(1)', icono: 'link' }).error, /URL/);
  assert.match(normalizarEnlaceSocial({ nombre: 'Malo', url: 'https://example.com', icono: '<svg>' }).error, /icono/);
});

test('modelo social conserva orden y visibilidad administrables', () => {
  const doc = new EnlaceSocial({ nombre: 'X', url: 'https://x.com/DataFut26', icono: 'x', activo: false, orden: 20 });
  const error = doc.validateSync();
  assert.equal(error, undefined);
  assert.equal(doc.activo, false);
  assert.equal(doc.orden, 20);
});

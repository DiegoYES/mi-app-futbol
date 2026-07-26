const test = require('node:test');
const assert = require('node:assert/strict');
const Boleta = require('../models/Boleta');

test('las boletas se indexan por usuario y fecha', () => {
  const indice = Boleta.schema.indexes().find(([, opciones]) => opciones.name === 'boleta_usuario_fecha');
  assert.ok(indice);
  assert.deepEqual(indice[0], { usuario: 1, creada_en: -1 });
});

test('una boleta limita la cantidad de selecciones', () => {
  const ruta = Boleta.schema.path('selecciones');
  const validador = ruta.validators.find(item => item.message.includes('entre 1 y 20'));
  assert.equal(validador.validator([]), false);
  assert.equal(validador.validator(Array(20).fill({})), true);
  assert.equal(validador.validator(Array(21).fill({})), false);
});

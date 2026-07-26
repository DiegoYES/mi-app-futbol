const test = require('node:test');
const assert = require('node:assert/strict');
const { etiquetaTemporada } = require('../services/seasonLabel');

test('muestra campañas cruzadas para Liga MX y ligas europeas', () => {
  assert.equal(etiquetaTemporada(262, 2025), '2025-26');
  assert.equal(etiquetaTemporada(39, 2026), '2026-27');
});

test('mantiene el año calendario para MLS y Brasileirão', () => {
  assert.equal(etiquetaTemporada(253, 2026), '2026');
  assert.equal(etiquetaTemporada(71, 2025), '2025');
});

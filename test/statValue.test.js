const test = require('node:test');
const assert = require('node:assert/strict');
const { valorEstadistica, tieneMetricasBasicas } = require('../services/statValue');

test('distingue cero explícito de una métrica ausente', () => {
  assert.equal(valorEstadistica([{ type: 'Corner Kicks', value: 0 }], 'Corner Kicks'), 0);
  assert.equal(valorEstadistica([{ type: 'Corner Kicks', value: null }], 'Corner Kicks'), null);
  assert.equal(valorEstadistica([], 'Corner Kicks'), null);
});

test('no declara completo un bloque sin corners', () => {
  assert.equal(tieneMetricasBasicas({ statistics: [{ type: 'Total Shots', value: 8 }, { type: 'Shots on Goal', value: 3 }] }), false);
  assert.equal(tieneMetricasBasicas({ statistics: [{ type: 'Total Shots', value: 8 }, { type: 'Shots on Goal', value: 3 }, { type: 'Corner Kicks', value: 0 }] }), true);
});

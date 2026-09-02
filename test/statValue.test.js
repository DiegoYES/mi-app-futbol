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

test('rechaza bloques prematuros donde los tiros son menores a los goles', () => {
  const stats = { statistics: [{ type: 'Total Shots', value: 1 }, { type: 'Shots on Goal', value: 1 }, { type: 'Corner Kicks', value: 2 }] };
  assert.equal(tieneMetricasBasicas(stats, { goles: 3 }), false);
  assert.equal(tieneMetricasBasicas(stats, { goles: 1 }), true);
});

test('rechaza bloques donde hay tarjetas en eventos pero las estadísticas están en blanco', () => {
  const stats = { statistics: [{ type: 'Total Shots', value: 10 }, { type: 'Shots on Goal', value: 4 }, { type: 'Corner Kicks', value: 5 }, { type: 'Yellow Cards', value: 0 }, { type: 'Red Cards', value: 0 }, { type: 'Fouls', value: 0 }] };
  assert.equal(tieneMetricasBasicas(stats, { tarjetasEventos: 3 }), false);
});


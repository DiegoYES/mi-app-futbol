const test = require('node:test');
const assert = require('node:assert/strict');
const { clasificarEvento, resumirEventosPorMinuto } = require('../services/minuteRangeAnalysis');

test('clasifica los formatos históricos de goles y tarjetas', () => {
  assert.equal(clasificarEvento({ tipo_evento: 'Gol' }), 'goles');
  assert.equal(clasificarEvento({ tipo_evento: 'Tarjeta', detalle: 'Yellow Card' }), 'amarillas');
  assert.equal(clasificarEvento({ tipo_evento: 'Tarjeta', detalle: 'Amarilla' }), 'amarillas');
  assert.equal(clasificarEvento({ tipo_evento: 'Tarjeta Amarilla' }), 'amarillas');
  assert.equal(clasificarEvento({ tipo_evento: 'Tarjeta', detalle: 'Red Card' }), 'rojas');
  assert.equal(clasificarEvento({ tipo_evento: 'Tarjeta Roja' }), 'rojas');
  assert.equal(clasificarEvento({ tipo_evento: 'Córner' }), null);
});

test('cuenta únicamente eventos dentro del rango libre inclusivo', () => {
  const eventos = [
    { minuto: 9, tipo_evento: 'Gol' },
    { minuto: 10, tipo_evento: 'Gol' },
    { minuto: 15, tipo_evento: 'Tarjeta', detalle: 'Yellow Card' },
    { minuto: 20, tipo_evento: 'Tarjeta Roja' },
    { minuto: 21, tipo_evento: 'Gol' },
    { minuto: 18, tipo_evento: 'Sustitución' }
  ];

  assert.deepEqual(resumirEventosPorMinuto(eventos, 10, 20), {
    goles: 1,
    amarillas: 1,
    rojas: 1
  });
});

test('no incorpora bloques vecinos cuando el rango comienza en un límite', () => {
  const eventos = [
    { minuto: 14, tipo_evento: 'Gol' },
    { minuto: 15, tipo_evento: 'Gol' },
    { minuto: 16, tipo_evento: 'Gol' },
    { minuto: 30, tipo_evento: 'Gol' },
    { minuto: 31, tipo_evento: 'Gol' }
  ];

  assert.deepEqual(resumirEventosPorMinuto(eventos, 15, 30), {
    goles: 3,
    amarillas: 0,
    rojas: 0
  });
});

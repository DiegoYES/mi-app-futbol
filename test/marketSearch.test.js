const test = require('node:test');
const assert = require('node:assert/strict');
const { filtrar } = require('../public/market-search');

const mercados = [
  { mercado: 'Más de 2.5 tarjetas amarillas totales', categoria: 'tarjetas', tipo: 'over', linea: 2.5, alcance: 'total' },
  { mercado: 'Más de 2.5 tarjetas registradas totales', categoria: 'tarjetas', tipo: 'over', linea: 2.5, alcance: 'total' },
  { mercado: 'Más de 3.5 tarjetas amarillas totales', categoria: 'tarjetas', tipo: 'over', linea: 3.5, alcance: 'total' },
  { mercado: 'Menos de 2.5 tarjetas amarillas totales', categoria: 'tarjetas', tipo: 'under', linea: 2.5, alcance: 'total' }
];

test('over 2.5 devuelve sólo la dirección y línea exactas de la categoría', () => {
  const resultado = filtrar(mercados, { categoria: 'tarjetas', busqueda: 'over 2.5', alcance: 'todos' });
  assert.equal(resultado.length, 2);
  assert.ok(resultado.every(item => item.tipo === 'over' && item.linea === 2.5));
  assert.ok(resultado.some(item => item.mercado.includes('registradas')));
});

test('acepta español, coma decimal y alcance', () => {
  const resultado = filtrar(mercados, { categoria: 'tarjetas', busqueda: 'más de 2,5 amarillas', alcance: 'total' });
  assert.deepEqual(resultado.map(item => item.mercado), ['Más de 2.5 tarjetas amarillas totales']);
});

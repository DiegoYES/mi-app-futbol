const test = require('node:test');
const assert = require('node:assert/strict');
const { familias, filtrar, lineas } = require('../public/market-search');

const mercados = [
  { id: 'amarillas_total_over_2_5', mercado: 'Más de 2.5 tarjetas amarillas totales', categoria: 'tarjetas', tipo: 'over', linea: 2.5, alcance: 'total' },
  { id: 'tarjetas_registradas_total_over_2_5', mercado: 'Más de 2.5 tarjetas registradas totales', categoria: 'tarjetas', tipo: 'over', linea: 2.5, alcance: 'total' },
  { id: 'amarillas_total_over_3_5', mercado: 'Más de 3.5 tarjetas amarillas totales', categoria: 'tarjetas', tipo: 'over', linea: 3.5, alcance: 'total' },
  { id: 'amarillas_total_under_2_5', mercado: 'Menos de 2.5 tarjetas amarillas totales', categoria: 'tarjetas', tipo: 'under', linea: 2.5, alcance: 'total' }
];

test('over 2.5 devuelve la escalera ascendente de la misma métrica', () => {
  const resultado = filtrar(mercados, { categoria: 'tarjetas', familia: 'amarillas', tipo: 'over', linea: 2.5, alcance: 'total' });
  assert.equal(resultado.length, 2);
  assert.deepEqual(resultado.map(item => item.linea), [2.5, 3.5]);
  assert.ok(resultado.every(item => item.tipo === 'over' && item.mercado.includes('amarillas')));
});

test('under 3.5 devuelve la escalera descendente', () => {
  const resultado = filtrar(mercados, { categoria: 'tarjetas', familia: 'amarillas', tipo: 'under', linea: 3.5, alcance: 'total' });
  assert.deepEqual(resultado.map(item => item.linea), [2.5]);
});

test('separa familias y ofrece sólo líneas válidas para cada combinación', () => {
  assert.deepEqual(familias(mercados, 'tarjetas'), ['amarillas', 'registradas']);
  assert.deepEqual(lineas(mercados, { categoria: 'tarjetas', familia: 'registradas', tipo: 'over', alcance: 'total' }), [2.5]);
});

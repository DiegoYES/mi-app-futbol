const test = require('node:test');
const assert = require('node:assert/strict');
const busqueda = require('../public/search-utils');

test('la búsqueda tokenizada no depende del orden de las palabras', () => {
  assert.equal(busqueda.coincide('Real Madrid', 'Madrid Real'), true);
  assert.equal(busqueda.coincide('Real Madrid', 'Re Mad'), true);
});

test('la búsqueda ignora acentos, mayúsculas y separadores', () => {
  assert.equal(busqueda.coincide('Atlético de Madrid', 'atletico mad'), true);
  assert.equal(busqueda.coincide('Paris Saint-Germain', 'GER PAR'), true);
});

test('todos los fragmentos solicitados deben existir', () => {
  assert.equal(busqueda.coincide('Real Sociedad', 'real madrid'), false);
});

test('los resultados exactos y por prefijo aparecen primero', () => {
  const equipos = [{ nombre: 'Real Sociedad' }, { nombre: 'Real Madrid' }, { nombre: 'Madrid CFF' }];
  assert.deepEqual(busqueda.ordenar(equipos, 'real mad', item => item.nombre).map(item => item.nombre), ['Real Madrid']);
});

test('los alias editoriales y los mercados aceptan fragmentos en cualquier orden', () => {
  assert.equal(busqueda.coincide('A. Italiano Audax Italiano', 'Italiano Audax'), true);
  assert.equal(busqueda.coincide('Más de 2.5 tarjetas registradas totales tarjetas', 'registradas tarjetas'), true);
});

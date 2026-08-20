const test = require('node:test');
const assert = require('node:assert/strict');
const { crearBiblioteca } = require('../public/user-library');

function memoria() {
  const datos = new Map();
  return { getItem: clave => datos.get(clave) ?? null, setItem: (clave, valor) => datos.set(clave, valor) };
}

test('favoritos se alternan por equipo y competición', () => {
  const biblioteca = crearBiblioteca(memoria());
  assert.equal(biblioteca.alternarFavorito({ id: 42, league: 39, nombre: 'Arsenal' }), true);
  assert.equal(biblioteca.esFavorito(42, 39), true);
  assert.equal(biblioteca.esFavorito(42, 2), false);
  assert.equal(biblioteca.alternarFavorito({ id: 42, league: 39, nombre: 'Arsenal' }), false);
  assert.equal(biblioteca.favoritos().length, 0);
});

test('partidos favoritos se guardan y alternan por su id', () => {
  const biblioteca = crearBiblioteca(memoria());
  const partido = { api_id: 1234, liga_id: 39, local: { nombre: 'Arsenal' }, visitante: { nombre: 'Chelsea' } };
  assert.equal(biblioteca.alternarPartidoFavorito(partido), true);
  assert.equal(biblioteca.esPartidoFavorito(1234), true);
  assert.equal(biblioteca.partidosFavoritos()[0].liga_id, 39);
  assert.equal(biblioteca.alternarPartidoFavorito({ id: 1234 }), false);
  assert.equal(biblioteca.partidosFavoritos().length, 0);
});

test('una comparación repetida se actualiza sin duplicarse', () => {
  const biblioteca = crearBiblioteca(memoria());
  biblioteca.guardarComparacion({ id: '42:39:50:39', titulo: 'A' });
  biblioteca.guardarComparacion({ id: '42:39:50:39', titulo: 'B' });
  assert.equal(biblioteca.comparaciones().length, 1);
  assert.equal(biblioteca.comparaciones()[0].titulo, 'B');
  biblioteca.quitarComparacion('42:39:50:39');
  assert.equal(biblioteca.comparaciones().length, 0);
});

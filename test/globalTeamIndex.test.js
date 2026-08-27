const test = require('node:test');
const assert = require('node:assert/strict');
const { construirIndiceEquipos } = require('../services/globalTeamIndex');

test('el índice usa sólo la temporada más reciente de cada competición y reúne contextos', () => {
  const filas = [
    { _id: { liga: 1, temporada: 2026, equipo: 10 }, liga_nombre: 'Liga A', nombre: 'Talleres' },
    { _id: { liga: 1, temporada: 2025, equipo: 11 }, liga_nombre: 'Liga A', nombre: 'Equipo viejo' },
    { _id: { liga: 2, temporada: 2026, equipo: 10 }, liga_nombre: 'Copa B', nombre: 'Talleres' }
  ];
  const equipos = construirIndiceEquipos(filas, { 1: { liga_principal: true }, 2: {} }, (_id, season) => String(season));
  assert.equal(equipos.length, 1);
  assert.equal(equipos[0].nombre, 'Talleres');
  assert.equal(equipos[0].league, 1);
  assert.deepEqual(equipos[0].competiciones, ['Liga A 2026', 'Copa B 2026']);
});

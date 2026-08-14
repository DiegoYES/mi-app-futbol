const test = require('node:test');
const assert = require('node:assert/strict');
const Partido = require('../models/partido');
const Equipo = require('../models/Equipo');
const JugadorPartido = require('../models/JugadorPartido');
const { porcentaje } = require('../scripts/auditarDatos');

test('el modelo de partidos declara índices para las consultas principales', () => {
  const nombres = Partido.schema.indexes().map(([, opciones]) => opciones.name);

  assert.ok(nombres.includes('fecha'));
  assert.ok(nombres.includes('liga_fecha'));
  assert.ok(nombres.includes('liga_temporada_estado_fecha'));
  assert.ok(nombres.includes('local_liga_temporada_estado_fecha'));
  assert.ok(nombres.includes('visitante_liga_temporada_estado_fecha'));
});

test('un equipo puede pertenecer a más de una competición', () => {
  const equipo = new Equipo({ api_id: 42, nombre: 'Arsenal', liga: 39, ligas: [39, 2] });
  assert.deepEqual(equipo.ligas, [39, 2]);
});

test('las actuaciones declaran el índice del directorio por competición y equipo', () => {
  const indice = JugadorPartido.schema.indexes()
    .find(([, opciones]) => opciones.name === 'liga_temporada_equipo_fecha');

  assert.deepEqual(indice?.[0], {
    'liga.id': 1,
    'liga.temporada': 1,
    'equipo.id': 1,
    fecha: -1
  });
});

test('la auditoría calcula coberturas sin divisiones inválidas', () => {
  assert.equal(porcentaje(0, 0), 0);
  assert.equal(porcentaje(115, 269), 42.8);
});

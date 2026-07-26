const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcularEstadisticas,
  detallarPartido,
  estadisticasPeriodo
} = require('../services/teamStats');

function equipo(id, nombre, goles, golesPrimerTiempo, stats1 = {}, stats2 = {}) {
  return {
    id,
    nombre,
    goles,
    goles_primer_tiempo: golesPrimerTiempo,
    tiros_total: 10,
    tiros_puerta: 4,
    corners: 5,
    faltas: 8,
    tarjetas_amarillas: 2,
    tarjetas_rojas: 0,
    offsides: 1,
    estadisticas_1t: stats1,
    estadisticas_2t: stats2
  };
}

const partidos = [
  {
    api_id: 1,
    fecha: new Date('2026-01-01'),
    equipo_local: equipo(10, 'Azules', 2, 1, { tiros_total: 4 }, { tiros_total: 6 }),
    equipo_visitante: equipo(20, 'Rojos', 1, 0, { tiros_total: 3 }, { tiros_total: 5 })
  },
  {
    api_id: 2,
    fecha: new Date('2026-01-08'),
    equipo_local: equipo(30, 'Verdes', 3, 2, { tiros_total: 7 }, { tiros_total: 4 }),
    equipo_visitante: equipo(10, 'Azules', 1, 1, { tiros_total: 5 }, { tiros_total: 3 })
  }
];

test('calcula el modo general respetando el rol local y visitante', () => {
  const stats = calcularEstadisticas(partidos, 10);

  assert.equal(stats.jugados, 2);
  assert.equal(stats.ganados, 1);
  assert.equal(stats.perdidos, 1);
  assert.equal(stats.golesFavor, 3);
  assert.equal(stats.golesContra, 4);
  assert.deepEqual(stats.over25, { total: 2, porcentaje: '100.0' });
  assert.deepEqual(stats.equipoOver15, { total: 1, porcentaje: '50.0' });
});

test('calcula resultados y goles del primer tiempo', () => {
  const stats = calcularEstadisticas(partidos, 10, 1);

  assert.equal(stats.ganados, 1);
  assert.equal(stats.empatados, 0);
  assert.equal(stats.perdidos, 1);
  assert.equal(stats.golesFavor, 2);
  assert.equal(stats.golesContra, 2);
});

test('deriva los goles del segundo tiempo desde el marcador y el descanso', () => {
  const periodo = estadisticasPeriodo(partidos[1].equipo_local, 2);
  assert.equal(periodo.goles, 1);
  assert.equal(periodo.tiros, 4);
});

test('detalla ambos goles del periodo y recalcula el resultado', () => {
  const detalle = detallarPartido(partidos[1], 10, 2);

  assert.equal(detalle.ubicacion, 'visitante');
  assert.equal(detalle.periodo, '2T');
  assert.equal(detalle.marcador, '0-1');
  assert.equal(detalle.resultado, 'D');
  assert.equal(detalle.goles, 0);
  assert.equal(detalle.goles_rival, 1);
});

test('una lista vacía devuelve porcentajes numéricamente seguros', () => {
  const stats = calcularEstadisticas([], 10);

  assert.equal(stats.jugados, 0);
  assert.deepEqual(stats.btts, { total: 0, porcentaje: '0.0' });
});

test('no presenta estadísticas avanzadas faltantes como ceros reales', () => {
  const detalle = detallarPartido(partidos[0], 10, 0);

  assert.equal(detalle.goles, 2);
  assert.equal(detalle.estadisticas_disponibles, false);
  assert.equal(detalle.tiros, null);
  assert.equal(detalle.corners, null);
});

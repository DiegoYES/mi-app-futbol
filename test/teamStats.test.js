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
  assert.deepEqual(stats.under35, { total: 1, porcentaje: '50.0' });
  assert.deepEqual(stats.equipoOver15, { total: 1, porcentaje: '50.0' });
});

test('calcula promedios avanzados solo con partidos que tienen cobertura', () => {
  const partidosConCobertura = partidos.map((partido, indice) => ({
    ...partido,
    estadisticas_completas: indice === 0
  }));
  partidosConCobertura[0].equipo_visitante = {
    ...partidosConCobertura[0].equipo_visitante,
    tiros_total: 14,
    tiros_puerta: 6,
    corners: 7,
    faltas: 11,
    tarjetas_amarillas: 3,
    offsides: 2
  };

  const stats = calcularEstadisticas(partidosConCobertura, 10);

  assert.equal(stats.avanzadas.muestra, 1);
  assert.equal(stats.avanzadas.promedios.tirosFavor, 10);
  assert.equal(stats.avanzadas.promedios.tirosContra, 14);
  assert.equal(stats.avanzadas.promedios.tirosTotales, 24);
  assert.equal(stats.avanzadas.promedios.tirosPuertaTotales, 10);
  assert.equal(stats.avanzadas.promedios.cornersFavor, 5);
  assert.equal(stats.avanzadas.promedios.cornersContra, 7);
  assert.equal(stats.avanzadas.promedios.cornersTotales, 12);
  assert.equal(stats.avanzadas.promedios.faltasTotales, 19);
  assert.equal(stats.avanzadas.promedios.offsidesTotales, 3);
  assert.deepEqual(stats.avanzadas.cornersOver95, { total: 1, porcentaje: '100.0' });
});

test('excluye una métrica ausente sin descartar las demás estadísticas del tiempo', () => {
  const conTiempos = [{
    ...partidos[0],
    tiempos_completos: true,
    equipo_local: {
      ...partidos[0].equipo_local,
      estadisticas_1t: { tiros_total: 8, tiros_puerta: 3, corners: 5, faltas: null, tarjetas_amarillas: 1, tarjetas_rojas: 0, offsides: 0 }
    },
    equipo_visitante: {
      ...partidos[0].equipo_visitante,
      estadisticas_1t: { tiros_total: 5, tiros_puerta: 2, corners: 3, faltas: null, tarjetas_amarillas: 2, tarjetas_rojas: 0, offsides: 1 }
    }
  }];

  const stats = calcularEstadisticas(conTiempos, 10, 1);

  assert.equal(stats.avanzadas.muestra, 1);
  assert.equal(stats.avanzadas.promedios.tirosFavor, 8);
  assert.equal(stats.avanzadas.promedios.faltasFavor, null);
  assert.equal(stats.avanzadas.muestras.faltasFavor, 0);
  assert.equal(stats.avanzadas.muestras.cornersFavor, 1);
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
  assert.equal(detalle.rival_estadisticas.tiros, null);
});

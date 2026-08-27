const test = require('node:test');
const assert = require('node:assert/strict');
const { construirUpdatePartido, datosJugador } = require('../services/fixtureDetail');
const { partir } = require('../scripts/completarDetallesLote');

const partido = {
  api_id: 77,
  fecha: new Date('2024-08-10T15:00:00Z'),
  liga: { id: 39, temporada: 2024, nombre: 'Premier League' },
  equipo_local: { id: 1 },
  equipo_visitante: { id: 2 }
};

test('divide fixture ids en lotes de máximo veinte', () => {
  const lotes = partir(Array.from({ length: 45 }, (_, i) => i + 1));
  assert.deepEqual(lotes.map(lote => lote.length), [20, 20, 5]);
});

test('una respuesta de fixtures alimenta estadísticas, eventos y alineaciones', () => {
  const detalle = {
    statistics: [
      { team: { id: 1 }, statistics: [
        { type: 'Total Shots', value: 14 }, { type: 'Shots on Goal', value: 5 },
        { type: 'Corner Kicks', value: 6 }, { type: 'Fouls', value: 11 },
        { type: 'Yellow Cards', value: 2 }, { type: 'Red Cards', value: null },
        { type: 'Offsides', value: 3 }, { type: 'Ball Possession', value: '55%' }
      ] },
      { team: { id: 2 }, statistics: [
        { type: 'Total Shots', value: 9 }, { type: 'Shots on Goal', value: 3 },
        { type: 'Corner Kicks', value: 4 }, { type: 'Fouls', value: 13 },
        { type: 'Yellow Cards', value: 4 }, { type: 'Red Cards', value: 1 },
        { type: 'Offsides', value: 1 }, { type: 'Ball Possession', value: '45%' }
      ] }
    ],
    events: [{
      time: { elapsed: 21 }, team: { id: 1 }, type: 'Goal', detail: 'Normal Goal',
      player: { id: 10, name: 'Delantero' }, assist: { id: 11, name: 'Asistente' }
    }],
    lineups: [
      { team: { id: 1 }, formation: '4-3-3', coach: { name: 'Técnico A' } },
      { team: { id: 2 }, formation: '4-4-2', coach: { name: 'Técnico B' } }
    ]
  };
  const update = construirUpdatePartido(detalle, partido);

  assert.equal(update.estadisticas_completas, true);
  assert.equal(update['equipo_local.tiros_total'], 14);
  assert.equal(update['equipo_visitante.tarjetas_rojas'], 1);
  assert.equal(update.eventos_completos, true);
  assert.equal(update['equipo_local.eventos'][0].jugador_id, 10);
  assert.equal(update['equipo_local.formacion'], '4-3-3');
});

test('no inventa cero ni marca cobertura completa si faltan corners', () => {
  const bloque = id => ({ team: { id }, statistics: [
    { type: 'Total Shots', value: 8 }, { type: 'Shots on Goal', value: 3 }
  ] });
  const update = construirUpdatePartido({ statistics: [bloque(1), bloque(2)] }, partido);
  assert.equal(update.estadisticas_completas, false);
  assert.equal(update['equipo_local.corners'], null);
  assert.equal(update['equipo_visitante.corners'], null);
});

test('normaliza el rendimiento individual incluido en el fixture', () => {
  const resultado = datosJugador({
    player: { id: 10, name: 'Delantero', photo: 'foto' },
    statistics: [{
      games: { position: 'F', number: 9, substitute: false, captain: true, minutes: 90, rating: '8.1' },
      shots: { total: 4, on: 2 }, goals: { total: 1, assists: 1 },
      passes: { total: 31, key: 2, accuracy: '81%' }, cards: { yellow: 1, red: 0 }
    }]
  }, { team: { id: 1, name: 'Local' } }, partido);

  assert.equal(resultado.jugador.id, 10);
  assert.equal(resultado.titular, true);
  assert.equal(resultado.calificacion, 8.1);
  assert.equal(resultado.precision_pases, 81);
});

test('marca un detalle consultado aunque alguna cobertura no esté disponible', async () => {
  let actualizacion;
  const modeloPartido = {
    async updateOne(_, cambios) { actualizacion = cambios.$set; }
  };
  const modeloJugador = { async bulkWrite() { assert.fail('no debe guardar jugadores vacíos'); } };
  const { guardarDetalleFixture } = require('../services/fixtureDetail');
  await guardarDetalleFixture({ statistics: [], events: [], lineups: [], players: [] }, partido, {
    modeloPartido,
    modeloJugador
  });

  assert.equal(actualizacion.detalle_completo, true);
  assert.equal(actualizacion.estadisticas_completas, false);
  assert.equal(actualizacion["equipo_local.corners"], null);
  assert.equal(actualizacion["equipo_visitante.corners"], null);
  assert.equal(actualizacion.cobertura_detalle.jugadores, false);
  assert.equal(actualizacion.cobertura_detalle.eventos, true);
});

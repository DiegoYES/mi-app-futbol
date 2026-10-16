const test = require('node:test');
const assert = require('node:assert/strict');
const Partido = require('../../models/partido');
const JugadorPartido = require('../../models/JugadorPartido');
const {
  probabilidadEquipo, probabilidadJugador, valorEquipo
} = require('../../services/betting/predictionEvaluationService');

function partido(temporada) {
  return {
    api_id: 10,
    fecha: new Date('2026-10-01T20:00:00Z'),
    liga: { id: 1, temporada },
    equipo_local: { id: 1, nombre: 'Local' },
    equipo_visitante: { id: 2, nombre: 'Visitante' }
  };
}

function minimoMuestra(t) {
  const anterior = process.env.MODEL_MIN_SAMPLE;
  process.env.MODEL_MIN_SAMPLE = '5';
  t.after(() => {
    if (anterior === undefined) delete process.env.MODEL_MIN_SAMPLE;
    else process.env.MODEL_MIN_SAMPLE = anterior;
  });
}

test('valorEquipo distingue ausencias y ceros reales antes de sumar totales', () => {
  for (const valor of [null, undefined, '', ' ', false, [], {}, NaN, Infinity]) {
    const item = { equipo_local: { corners: valor }, equipo_visitante: { corners: 2 } };
    assert.equal(valorEquipo(item, 'corners', 'local'), null);
    assert.equal(valorEquipo(item, 'corners', 'total'), null);
    assert.equal(valorEquipo(item, 'corners', 'visitante'), 2);
  }
  assert.equal(valorEquipo({ equipo_local: { corners: 0 }, equipo_visitante: { corners: '0' } }, 'corners', 'total'), 0);
});

for (const temporada of [2025, 2026]) {
  test(`equipos ${temporada}: las ausencias no alcanzan la muestra minima`, async t => {
    minimoMuestra(t);
    const valores = [0, 1, 2, 3, null, '', ' '];
    const historicos = valores.map(corners => ({ equipo_local: { corners }, equipo_visitante: { corners: 0 } }));
    const seleccion = { categoria: 'corners', lado: 'UNDER', linea: 2.5 };
    const resultado = await probabilidadEquipo(seleccion, partido(temporada), {
      historicosEquipo: Promise.resolve([historicos, historicos])
    });
    assert.deepEqual(resultado, { estado: 'MODEL_PROBABILITY_NOT_AVAILABLE', muestra: 4 });
  });

  test(`equipos ${temporada}: conserva ceros reales y filtra por la temporada elegida`, async t => {
    minimoMuestra(t);
    const filtros = [];
    t.mock.method(Partido, 'find', filtro => {
      filtros.push(filtro);
      return {
        sort() { return this; },
        limit() { return this; },
        lean() {
          return Promise.resolve(Array.from({ length: 5 }, () => ({
            equipo_local: { corners: 0 }, equipo_visitante: { corners: 0 }
          })));
        }
      };
    });
    const resultado = await probabilidadEquipo({ categoria: 'corners', lado: 'UNDER', linea: 2.5 }, partido(temporada));
    assert.equal(resultado.estado, 'MATCHED');
    assert.equal(resultado.muestra, 5);
    assert.equal(resultado.probabilidad, 7 / 9);
    assert.equal(filtros.length, 2);
    assert.ok(filtros.every(filtro => filtro['liga.temporada'] === temporada));
  });

  test(`jugadores ${temporada}: cuenta solo estadisticas validas y conserva ceros`, async t => {
    minimoMuestra(t);
    let valores = [0, 1, 2, 3, null, '', ' '];
    t.mock.method(JugadorPartido, 'find', filtro => {
      assert.equal(filtro['liga.temporada'], temporada);
      return {
        sort() { return this; },
        limit() { return this; },
        select() { return this; },
        lean() { return this; },
        exec() { return Promise.resolve(valores.map(amarillas => ({ amarillas }))); }
      };
    });
    const seleccion = { categoria: 'player_cards', jugador: 'Jugador Local', lado: 'UNDER', linea: 0.5 };
    const cache = () => ({
      candidatosJugadores: Promise.resolve([{ _id: 7, nombre: 'Jugador Local', equipo: 1 }])
    });
    const insuficiente = await probabilidadJugador(seleccion, partido(temporada), cache());
    assert.deepEqual(insuficiente, { estado: 'MODEL_PROBABILITY_NOT_AVAILABLE', muestra: 4 });
    valores = [0, 0, 0, 0, 0, null];
    const valido = await probabilidadJugador(seleccion, partido(temporada), cache());
    assert.equal(valido.estado, 'MATCHED');
    assert.equal(valido.muestra, 5);
    assert.equal(valido.victorias, 5);
    assert.equal(valido.probabilidad, 7 / 9);
  });
}

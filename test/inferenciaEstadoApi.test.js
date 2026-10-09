const test = require('node:test');
const assert = require('node:assert/strict');
const { inferirMarcadorYEstado, documentoFixture } = require('../services/fixtureCatalog');

test('inferirMarcadorYEstado deduce FT y goles desde players cuando la cabecera viene congelada en NS', () => {
  const ahora = new Date('2026-09-17T06:00:00.000Z');
  const fixture = {
    fixture: {
      id: 1492311,
      date: '2026-09-16T22:30:00.000Z', // Hace más de 7 horas
      status: { short: 'NS', long: 'Not Started' }
    },
    league: { id: 71, name: 'Brasileirão Serie A', season: 2026, round: 'Regular Season - 21' },
    teams: {
      home: { id: 120, name: 'Botafogo' },
      away: { id: 130, name: 'Gremio' }
    },
    goals: { home: null, away: null },
    score: { fulltime: { home: null, away: null } },
    statistics: [
      {
        team: { id: 120 },
        statistics: [
          { type: 'Total Shots', value: 10 },
          { type: 'Shots on Goal', value: 7 },
          { type: 'Corner Kicks', value: 3 },
          { type: 'Fouls', value: 13 }
        ]
      },
      {
        team: { id: 130 },
        statistics: [
          { type: 'Total Shots', value: 13 },
          { type: 'Shots on Goal', value: 3 },
          { type: 'Corner Kicks', value: 3 },
          { type: 'Fouls', value: 11 }
        ]
      }
    ],
    players: [
      {
        team: { id: 120, name: 'Botafogo' },
        players: [
          { player: { id: 1, name: 'Danilo Santos' }, statistics: [{ games: { minutes: 78 }, goals: { total: 2 } }] },
          { player: { id: 2, name: 'Álvaro Montoro' }, statistics: [{ games: { minutes: 90 }, goals: { total: 1 } }] },
          { player: { id: 3, name: 'Defensa 1' }, statistics: [{ games: { minutes: 90 }, goals: { total: 0 } }] },
          { player: { id: 4, name: 'Defensa 2' }, statistics: [{ games: { minutes: 90 }, goals: { total: 0 } }] },
          { player: { id: 5, name: 'Medio 1' }, statistics: [{ games: { minutes: 90 }, goals: { total: 0 } }] },
          { player: { id: 6, name: 'Medio 2' }, statistics: [{ games: { minutes: 90 }, goals: { total: 0 } }] },
          { player: { id: 7, name: 'Portero' }, statistics: [{ games: { minutes: 90 }, goals: { total: 0 } }] }
        ]
      },
      {
        team: { id: 130, name: 'Gremio' },
        players: [
          { player: { id: 11, name: 'Gustavo Martins' }, statistics: [{ games: { minutes: 90 }, goals: { total: 1 } }] },
          { player: { id: 12, name: 'Jovane Cabral' }, statistics: [{ games: { minutes: 82 }, goals: { total: 1 } }] },
          { player: { id: 13, name: 'Defensa G1' }, statistics: [{ games: { minutes: 90 }, goals: { total: 0 } }] },
          { player: { id: 14, name: 'Defensa G2' }, statistics: [{ games: { minutes: 90 }, goals: { total: 0 } }] },
          { player: { id: 15, name: 'Medio G1' }, statistics: [{ games: { minutes: 90 }, goals: { total: 0 } }] },
          { player: { id: 16, name: 'Medio G2' }, statistics: [{ games: { minutes: 90 }, goals: { total: 0 } }] },
          { player: { id: 17, name: 'Portero G' }, statistics: [{ games: { minutes: 90 }, goals: { total: 0 } }] }
        ]
      }
    ]
  };

  const inferido = inferirMarcadorYEstado(fixture, { ahora });
  assert.equal(inferido.estado, 'FT');
  assert.equal(inferido.golesLocal, 3);
  assert.equal(inferido.golesVisitante, 2);

  const doc = documentoFixture(fixture);
  assert.equal(doc.estado, 'FT');
  assert.equal(doc['equipo_local.goles'], 3);
  assert.equal(doc['equipo_visitante.goles'], 2);
  assert.equal(doc.total_goles, 5);
  assert.equal(doc.ambos_anotan, true);
  assert.equal(doc.resultado, 'local');
  assert.equal(doc.minuto_juego, 90);
});

test('inferirMarcadorYEstado deduce 0-0 FT si el partido concluyó sin goles', () => {
  const ahora = new Date('2026-09-17T06:00:00.000Z');
  const fixture = {
    fixture: {
      id: 999901,
      date: '2026-09-16T20:00:00.000Z',
      status: { short: 'NS' }
    },
    league: { id: 71, name: 'Brasileirão Serie A', season: 2026, round: 'Regular Season - 21' },
    teams: {
      home: { id: 10, name: 'Equipo A' },
      away: { id: 20, name: 'Equipo B' }
    },
    goals: { home: null, away: null },
    statistics: [{ team: { id: 10 }, statistics: [{ type: 'Shots on Goal', value: 1 }] }, { team: { id: 20 }, statistics: [{ type: 'Shots on Goal', value: 0 }] }],
    players: [
      {
        team: { id: 10 },
        players: Array.from({ length: 11 }, (_, i) => ({
          player: { id: i + 1 },
          statistics: [{ games: { minutes: 90 }, goals: { total: 0 } }]
        }))
      },
      {
        team: { id: 20 },
        players: Array.from({ length: 11 }, (_, i) => ({
          player: { id: i + 20 },
          statistics: [{ games: { minutes: 90 }, goals: { total: 0 } }]
        }))
      }
    ]
  };

  const inferido = inferirMarcadorYEstado(fixture, { ahora });
  assert.equal(inferido.estado, 'FT');
  assert.equal(inferido.golesLocal, 0);
  assert.equal(inferido.golesVisitante, 0);

  const doc = documentoFixture(fixture);
  assert.equal(doc.estado, 'FT');
  assert.equal(doc['equipo_local.goles'], 0);
  assert.equal(doc['equipo_visitante.goles'], 0);
  assert.equal(doc.total_goles, 0);
  assert.equal(doc.ambos_anotan, false);
  assert.equal(doc.resultado, 'empate');
});

test('inferirMarcadorYEstado no altera partidos futuros ni partidos suspendidos/postergados sin juego', () => {
  const ahora = new Date('2026-09-17T06:00:00.000Z');
  // Partido futuro
  const futuro = {
    fixture: {
      id: 999902,
      date: '2026-09-20T20:00:00.000Z',
      status: { short: 'NS' }
    },
    league: { id: 71, name: 'Brasileirão Serie A', season: 2026 },
    teams: { home: { id: 10 }, away: { id: 20 } },
    goals: { home: null, away: null }
  };
  const inferidoFuturo = inferirMarcadorYEstado(futuro, { ahora });
  assert.equal(inferidoFuturo.estado, 'NS');
  assert.equal(inferidoFuturo.golesLocal, null);
  assert.equal(inferidoFuturo.golesVisitante, null);

  // Partido postergado sin minutos
  const postergado = {
    fixture: {
      id: 999903,
      date: '2026-09-16T20:00:00.000Z',
      status: { short: 'PST' }
    },
    league: { id: 71, name: 'Brasileirão Serie A', season: 2026 },
    teams: { home: { id: 10 }, away: { id: 20 } },
    goals: { home: null, away: null },
    players: []
  };
  const inferidoPst = inferirMarcadorYEstado(postergado, { ahora });
  assert.equal(inferidoPst.estado, 'PST');
  assert.equal(inferidoPst.golesLocal, null);
  assert.equal(inferidoPst.golesVisitante, null);
});

test('inferirMarcadorYEstado respeta partidos normales que ya vienen con FT y goles explícitos', () => {
  const normal = {
    fixture: {
      id: 999904,
      date: '2026-09-16T20:00:00.000Z',
      status: { short: 'FT' }
    },
    league: { id: 71, name: 'Brasileirão Serie A', season: 2026 },
    teams: { home: { id: 10 }, away: { id: 20 } },
    goals: { home: 2, away: 1 }
  };
  const inferido = inferirMarcadorYEstado(normal);
  assert.equal(inferido.estado, 'FT');
  assert.equal(inferido.golesLocal, 2);
  assert.equal(inferido.golesVisitante, 1);
});


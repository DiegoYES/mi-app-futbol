const test = require('node:test');
const assert = require('node:assert/strict');
const { documentoFixture } = require('../services/fixtureCatalog');

function fixture(estado = 'FT') {
  return {
    fixture: { id: 10, date: '2026-07-20T00:00:00Z', referee: 'Árbitro', status: { short: estado, elapsed: 90 } },
    league: { id: 262, name: 'Liga MX', season: 2026, round: 'Apertura - 2' },
    teams: { home: { id: 1, name: 'Local', logo: 'l.png' }, away: { id: 2, name: 'Visita', logo: 'v.png' } },
    goals: { home: 2, away: 1 }, score: { halftime: { home: 1, away: 0 } }
  };
}

test('normaliza un fixture finalizado sin borrar campos de detalle', () => {
  const doc = documentoFixture(fixture(), { 262: { nombre: 'Liga MX' } });
  assert.equal(doc['equipo_local.id'], 1);
  assert.equal(doc.total_goles, 3);
  assert.equal(doc.resultado, 'local');
  assert.equal(doc.liga.temporada, 2026);
  assert.equal(doc.estadisticas_completas, undefined);
});

test('un fixture futuro no inventa marcador ni resultado', () => {
  const base = fixture('NS');
  base.goals = { home: null, away: null };
  const doc = documentoFixture(base, {});
  assert.equal(doc.total_goles, undefined);
  assert.equal(doc.resultado, undefined);
});

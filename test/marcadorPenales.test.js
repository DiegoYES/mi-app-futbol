const test = require('node:test');
const assert = require('node:assert/strict');
const { construirMarcador, documentoFixture } = require('../services/fixtureCatalog');
const marcador = require('../public/match-score');

// Fixture real de referencia: un partido de copa 1-1 en 120' resuelto 4-3 en
// la tanda. Antes de este cambio la tanda se perdía y la ficha decía "Final 1-1".
function fixturePenales() {
  return {
    fixture: { id: 9001, date: '2026-08-05T02:00:00+00:00', status: { short: 'PEN', elapsed: 120 }, referee: null },
    league: { id: 16, name: 'Leagues Cup', season: 2026, round: 'Round of 16' },
    teams: { home: { id: 1, name: 'Los Angeles FC', logo: '' }, away: { id: 2, name: 'Guadalajara Chivas', logo: '' } },
    goals: { home: 1, away: 1 },
    score: {
      halftime: { home: 0, away: 1 },
      fulltime: { home: 1, away: 1 },
      extratime: { home: 0, away: 0 },
      penalty: { home: 3, away: 4 }
    }
  };
}

test('construirMarcador extrae la tanda de penales y su ganador', () => {
  assert.deepEqual(construirMarcador(fixturePenales()), {
    'goles_prorroga.local': 0,
    'goles_prorroga.visitante': 0,
    'penales.local': 3,
    'penales.visitante': 4,
    ganador_penales: 'visitante'
  });
});

test('construirMarcador deja los penales en null en un partido normal', () => {
  const fixture = fixturePenales();
  fixture.fixture.status.short = 'FT';
  fixture.score.extratime = { home: null, away: null };
  fixture.score.penalty = { home: null, away: null };

  assert.deepEqual(construirMarcador(fixture), {
    'goles_prorroga.local': null,
    'goles_prorroga.visitante': null,
    'penales.local': null,
    'penales.visitante': null,
    ganador_penales: null
  });
});

test('construirMarcador descarta una tanda informada a medias', () => {
  const fixture = fixturePenales();
  fixture.score.penalty = { home: 3, away: null };

  const resultado = construirMarcador(fixture);
  assert.equal(resultado['penales.local'], null);
  assert.equal(resultado['penales.visitante'], null);
  assert.equal(resultado.ganador_penales, null);
});

test('construirMarcador tolera un fixture sin bloque score', () => {
  assert.deepEqual(construirMarcador({}), {
    'goles_prorroga.local': null,
    'goles_prorroga.visitante': null,
    'penales.local': null,
    'penales.visitante': null,
    ganador_penales: null
  });
});

test('la tanda no altera el marcador con el que se liquidan los mercados', () => {
  const doc = documentoFixture(fixturePenales());
  assert.equal(doc['equipo_local.goles'], 1);
  assert.equal(doc['equipo_visitante.goles'], 1);
  assert.equal(doc.total_goles, 2, 'los penales no suman goles al partido');
  assert.equal(doc.resultado, 'empate', 'el 1X2 se decide a 120 minutos');
  assert.equal(doc['penales.visitante'], 4);
  assert.equal(doc.ganador_penales, 'visitante');
});

test('un partido AET sin penales conserva su resultado y prórroga', () => {
  const fixture = fixturePenales();
  fixture.fixture.status.short = 'AET';
  fixture.goals = { home: 3, away: 2 };
  fixture.score.extratime = { home: 2, away: 0 };
  fixture.score.penalty = { home: null, away: null };

  const doc = documentoFixture(fixture);
  assert.equal(doc.resultado, 'local');
  assert.equal(doc.total_goles, 5);
  assert.equal(doc['goles_prorroga.local'], 2);
  assert.equal(doc['penales.local'], null);
});

test('etiquetaEstado distingue penales, prórroga y final normal', () => {
  assert.equal(marcador.etiquetaEstado({ estado: 'PEN' }), 'Penales');
  assert.equal(marcador.etiquetaEstado({ estado: 'AET' }), 'Final (pró.)');
  assert.equal(marcador.etiquetaEstado({ estado: 'FT' }), 'Final');
});

test('etiquetaEstado usa la hora como alternativa en partidos por jugarse', () => {
  assert.equal(marcador.etiquetaEstado({ estado: 'NS' }, '19:00'), '19:00');
  assert.equal(marcador.etiquetaEstado({ estado: 'PST' }, '19:00'), 'Aplazado');
  assert.equal(marcador.etiquetaEstado({ estado: '2H' }, '19:00'), 'En vivo');
});

test('un NS cuya hora pasó deja de presentarse como no empezado', () => {
  const partido = { estado: 'NS', fecha: '2026-08-24T01:00:00Z' };
  assert.equal(marcador.esEstadoAtrasado(partido, '2026-08-24T04:00:00Z'), true);
  assert.equal(marcador.esEstadoAtrasado(partido, '2026-08-24T02:59:59Z'), false);
  assert.equal(marcador.etiquetaEstado(partido, '19:00'), 'Sin confirmar');
  assert.equal(marcador.esEstadoAtrasado({ ...partido, estado: 'PST' }, '2026-08-25T04:00:00Z'), false);
});

test('textoPenales sólo aparece cuando hubo tanda', () => {
  const conTanda = { local: { goles: 1 }, visitante: { goles: 1 }, penales: { local: 3, visitante: 4 } };
  assert.equal(marcador.textoMarcador(conTanda), '1 - 1', 'el marcador principal excluye la tanda');
  assert.equal(marcador.textoPenales(conTanda), '(3 - 4 pen.)');
  assert.equal(marcador.descripcionMarcador(conTanda), '1 - 1, 3 - 4 en penales');

  const sinTanda = { local: { goles: 2 }, visitante: { goles: 0 }, penales: null };
  assert.equal(marcador.textoPenales(sinTanda), '');
  assert.equal(marcador.descripcionMarcador(sinTanda), '2 - 0');
});

test('textoPenales ignora una tanda incompleta o vacía', () => {
  assert.equal(marcador.textoPenales({ penales: { local: 3, visitante: null } }), '');
  assert.equal(marcador.textoPenales({ penales: {} }), '');
  assert.equal(marcador.textoPenales({}), '');
});

test('ganadorPenales identifica quién avanza', () => {
  assert.equal(marcador.ganadorPenales({ penales: { local: 5, visitante: 4 } }), 'local');
  assert.equal(marcador.ganadorPenales({ penales: { local: 4, visitante: 5 } }), 'visitante');
  assert.equal(marcador.ganadorPenales({ penales: { local: 4, visitante: 4 } }), null);
  assert.equal(marcador.ganadorPenales({}), null);
});

test('un 0-0 resuelto en penales sigue mostrando marcador, no cadena vacía', () => {
  const partido = { local: { goles: 0 }, visitante: { goles: 0 }, penales: { local: 5, visitante: 3 } };
  assert.equal(marcador.textoMarcador(partido), '0 - 0');
  assert.equal(marcador.textoPenales(partido), '(5 - 3 pen.)');
});

test('esFinalizado reconoce los tres estados terminales', () => {
  for (const estado of ['FT', 'AET', 'PEN']) assert.ok(marcador.esFinalizado(estado));
  for (const estado of ['NS', '2H', 'PST', '', null]) assert.ok(!marcador.esFinalizado(estado));
});

test('el calendario expone la tanda al cliente', () => {
  const fuente = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes', 'calendario.js'), 'utf8');
  assert.match(fuente, /'penales\.local', 'penales\.visitante'/, 'la proyección debe incluir los penales');
  assert.match(fuente, /penales: marcadorExtra\(p\.penales\)/);
});

test('el calendario ya no rotula todo partido finalizado como "Final"', () => {
  const html = ['calendario.html', 'calendario.js'].map(archivo => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', archivo), 'utf8')).join(String.fromCharCode(10));
  assert.ok(!/p\.finalizado \? 'Final'/.test(html), 'quedó la etiqueta fija anterior');
  assert.match(html, /FutbolMarcador\.etiquetaEstado/);
  assert.match(html, /<script src="\/match-score\.js">/);
});

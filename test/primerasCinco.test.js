const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Partido = require('../models/partido');
const { documentoFixture } = require('../services/fixtureCatalog');
const { PATRONES_DATOS_PARTIDOS } = require('../services/syncCache');

test('el esquema conserva estado_consultado_en', () => {
  assert.ok(Partido.schema.path('estado_consultado_en'));
});

test('documentoFixture conserva el país de la liga', () => {
  const fixture = { fixture:{id:1,date:new Date(),status:{short:'NS',elapsed:null},referee:null}, league:{id:39,name:'Premier League',country:'England',season:2026,round:'R1'}, teams:{home:{id:1,name:'A',logo:''},away:{id:2,name:'B',logo:''}}, goals:{home:null,away:null}, score:{halftime:{home:null,away:null}} };
  assert.equal(documentoFixture(fixture).liga.pais, 'England');
  assert.equal(documentoFixture(fixture, {39:{nombre:'Premier',pais:'Inglaterra'}}).liga.pais, 'Inglaterra');
});

test('las vistas dinámicas refrescan sólo cuando están visibles', () => {
  for (const archivo of ['public/calendario.html', 'public/partido.html']) {
    const fuente = fs.readFileSync(archivo, 'utf8');
    assert.match(fuente, /visibilitychange/);
    assert.match(fuente, /document\.hidden/);
  }
});

test('la invalidación incluye calendario y estadísticas', () => {
  assert.ok(PATRONES_DATOS_PARTIDOS.includes('/calendario/'));
  assert.ok(PATRONES_DATOS_PARTIDOS.includes('/estadisticas-detalladas'));
});

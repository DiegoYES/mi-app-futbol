const test = require('node:test');
const assert = require('node:assert/strict');
const { construirCatalogo } = require('../services/competitionCatalog');

test('agrupa temporadas en una sola competición y conserva su cobertura', () => {
  const filas = [
    { _id: { id: 39, temporada: 2026 }, nombre: 'Premier League', partidos: 380, finalizados: 0, estadisticas: 0 },
    { _id: { id: 39, temporada: 2025 }, nombre: 'Premier League', partidos: 380, finalizados: 380, estadisticas: 380 },
    { _id: { id: 2, temporada: 2024 }, nombre: 'UEFA Champions League', partidos: 100, finalizados: 100, estadisticas: 80 }
  ];
  const configuradas = {
    39: { nombre: 'Premier League', pais: 'Inglaterra', liga_principal: true },
    2: { nombre: 'UEFA Champions League', pais: 'Europa', liga_principal: false }
  };

  const catalogo = construirCatalogo(filas, configuradas, (_id, temporada) => `${temporada}-${String(temporada + 1).slice(-2)}`);

  assert.equal(catalogo.length, 2);
  assert.equal(catalogo[0].id, 39);
  assert.equal(catalogo[0].temporadas.length, 2);
  assert.deepEqual(catalogo[0].temporadas.map(item => item.temporada), [2026, 2025]);
  assert.equal(catalogo[0].resumen.partidos, 760);
  assert.equal(catalogo[0].resumen.cobertura.estadisticas, 380);
  assert.equal(catalogo[0].temporada_actual_etiqueta, '2026-27');
});

test('ignora filas sin identificadores válidos', () => {
  const catalogo = construirCatalogo([
    { _id: { id: null, temporada: 2025 }, nombre: 'Inválida' },
    { _id: { id: 39, temporada: null }, nombre: 'Inválida' }
  ], {}, String);

  assert.deepEqual(catalogo, []);
});

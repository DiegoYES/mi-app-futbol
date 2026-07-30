const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../fixtures/playdoit-simulated.json');
const { categoriaMercado, normalizarSeleccion } = require('../../services/betting/marketNormalizer');
const { extraerSelecciones } = require('../../services/betting/playdoitParser');
const { resolverNombre } = require('../../services/betting/strings');

test('normaliza categorías en español e inglés', () => {
  assert.equal(categoriaMercado('Tarjetas del jugador', 'Más de 1.5'), 'player_cards');
  assert.equal(categoriaMercado('Player shots on target', 'Over 0.5'), 'player_shots_on_target');
  assert.equal(categoriaMercado('Total corners', 'Under 9.5'), 'corners');
});

test('extrae jugador, lado, línea y cuota sin perder texto original', () => {
  const item = normalizarSeleccion({ eventName: 'A vs B', marketName: 'Tarjetas del jugador', selectionName: 'Luciano Sarmiento Más de 1.5', odds: 1.85 });
  assert.equal(item.jugador, 'Luciano Sarmiento'); assert.equal(item.lado, 'OVER');
  assert.equal(item.linea, 1.5); assert.equal(item.cuota, 1.85); assert.match(item.texto_origen, /Luciano Sarmiento/);
});

test('parser separado de navegación procesa fixture marcado como simulado', () => {
  const items = extraerSelecciones(fixture);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => item.lado).sort(), ['OVER', 'UNDER']);
  assert.ok(items.every(item => item.evento_externo_id === 'sim-event-1'));
});

test('matching de jugadores evita resultados ambiguos', () => {
  const candidatos = [{ id: 1, nombre: 'Luis García' }, { id: 2, nombre: 'Luis Garcia' }];
  assert.equal(resolverNombre('Luis Garcia', candidatos, 'jugadores').estado, 'AMBIGUOUS');
  assert.equal(resolverNombre('Luciano Sarmiento', [{ id: 3, nombre: 'Luciano Sarmiento' }], 'jugadores').estado, 'MATCHED');
});

test('respuesta incompleta queda diagnosticada y cuota suspendida conserva estado', () => {
  const incompleta = normalizarSeleccion({ eventName: 'A vs B', marketName: 'Mercado desconocido', selectionName: 'Dato' });
  assert.ok(incompleta.problemas.includes('MARKET_NOT_NORMALIZED'));
  assert.ok(incompleta.problemas.includes('ODDS_NOT_AVAILABLE'));
  const suspendida = normalizarSeleccion({ eventName: 'A vs B', marketName: 'Corners', selectionName: 'Over 8.5', odds: 1.9, suspended: true });
  assert.equal(suspendida.estado, 'SUSPENDED');
});

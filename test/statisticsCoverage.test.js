const test = require('node:test');
const assert = require('node:assert/strict');
const { resolverCoberturaEstadisticas } = require('../services/statisticsCoverage');
const { filtroPendientes, partir } = require('../scripts/procesarPendientesEstadisticas');
const { filtroSinCoberturaAgotada } = require('../scripts/reconciliarEstadisticas');

test('una respuesta parcial avanza hasta cerrar la cobertura al tercer intento', () => {
  const ahora = new Date('2026-08-24T12:00:00Z');
  const primero = resolverCoberturaEstadisticas({ estadisticas_intentos: 0 }, false, ahora);
  const tercero = resolverCoberturaEstadisticas({ estadisticas_intentos: 2 }, false, ahora);
  assert.equal(primero.estadisticas_estado, 'pendiente');
  assert.equal(primero.estadisticas_no_disponibles, false);
  assert.equal(tercero.estadisticas_intentos, 3);
  assert.equal(tercero.estadisticas_estado, 'sin_cobertura_proveedor');
  assert.equal(tercero.estadisticas_no_disponibles, true);
});

test('una respuesta completa revierte la clasificación sin borrar historial de intentos', () => {
  const estado = resolverCoberturaEstadisticas({ estadisticas_intentos: 9 }, true);
  assert.equal(estado.estadisticas_estado, 'completas');
  assert.equal(estado.estadisticas_no_disponibles, false);
  assert.equal(Object.hasOwn(estado, 'estadisticas_intentos'), false);
});

test('los procesos por lotes tienen alcance acotado y filtros explícitos', () => {
  assert.deepEqual(partir(Array.from({ length: 45 }, (_, i) => i), 20).map(x => x.length), [20, 20, 5]);
  assert.deepEqual(filtroPendientes(new Date('2026-08-24T12:00:00Z')).estado.$in, ['FT', 'AET', 'PEN']);
  const agotada = filtroSinCoberturaAgotada();
  assert.equal(agotada.estadisticas_intentos.$gte, 3);
  assert.equal(agotada.estadisticas_no_disponibles.$ne, true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolverFechas } = require('../scripts/syncCalendario');

test('resolverFechas consulta hoy y mañana UTC por defecto', () => {
  const ahora = new Date('2026-07-29T03:30:00.000Z');
  assert.deepEqual(resolverFechas([], ahora), ['2026-07-29', '2026-07-30']);
});

test('resolverFechas conserva una fecha explícita', () => {
  assert.deepEqual(resolverFechas(['2026-07-28']), ['2026-07-28']);
});

test('resolverFechas permite solicitar próximos días explícitamente', () => {
  const ahora = new Date('2026-07-29T23:30:00.000Z');
  assert.deepEqual(
    resolverFechas(['--dias=3'], ahora),
    ['2026-07-29', '2026-07-30', '2026-07-31']
  );
});

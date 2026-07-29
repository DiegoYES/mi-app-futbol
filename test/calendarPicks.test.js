const test = require('node:test');
const assert = require('node:assert/strict');
const { familiaMercado, seleccionarPicksDiversos } = require('../services/calendarPicks');

function pick(id, categoria, estimacion, extra = {}) {
  return { id, mercado: id, categoria, estimacion, muestra: 10, fuentes: 2, alcance: 'total', tipo: 'over', ...extra };
}

test('el calendario excluye over 0.5 y candidatos con evidencia insuficiente', () => {
  const resultado = seleccionarPicksDiversos([
    pick('over_0_5', 'goles', 95),
    pick('over_1_5', 'goles', 75),
    pick('corners_total_over_8_5', 'corners', 80, { muestra: 4 }),
    pick('ambos_anotan', 'goles', 64, { tipo: null })
  ]);
  assert.deepEqual(resultado.map(item => item.id), ['over_1_5']);
});

test('diversifica categorías y no repite líneas de la misma familia', () => {
  const resultado = seleccionarPicksDiversos([
    pick('over_1_5', 'goles', 82),
    pick('over_2_5', 'goles', 80),
    pick('corners_total_over_8_5', 'corners', 78),
    pick('tiros_total_over_19_5', 'tiros', 76),
    pick('faltas_total_over_21_5', 'faltas', 74),
    pick('amarillas_total_over_2_5', 'tarjetas', 72)
  ]);
  assert.deepEqual(resultado.map(item => item.id), [
    'over_1_5', 'corners_total_over_8_5', 'tiros_total_over_19_5',
    'faltas_total_over_21_5', 'amarillas_total_over_2_5'
  ]);
  assert.equal(familiaMercado(resultado[0]), familiaMercado(pick('over_3_5', 'goles', 70)));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { esPickTrivial, normalizarPick } = require('../services/pickRules');

test('normalizarPick extrae propiedades estructuradas y deduce faltantes', () => {
  const p1 = normalizarPick({
    id: 'over_0_5',
    mercado: 'Más de 0.5 goles',
    categoria: 'goles',
    tipo: 'over',
    linea: 0.5,
    alcance: 'total'
  });
  assert.equal(p1.tipo, 'over');
  assert.equal(p1.linea, 0.5);
  assert.equal(p1.categoria, 'goles');

  // Deducir desde id y mercado cuando no vienen explícitos
  const p2 = normalizarPick({
    id: 'tiros_puerta_local_over_1_5',
    mercado: 'Más de 1.5 tiros a puerta del local'
  });
  assert.equal(p2.tipo, 'over');
  assert.equal(p2.linea, 1.5);
  assert.equal(p2.categoria, 'tiros_puerta');
  assert.equal(p2.alcance, 'local');
});

test('Regla 1: Over 0.5 goles es trivial; Under 0.5 goles o Over > 0.5 goles son válidos', () => {
  // Triviales
  assert.equal(esPickTrivial({ id: 'over_0_5', categoria: 'goles', tipo: 'over', linea: 0.5 }), true);
  assert.equal(esPickTrivial({ id: 'goles_total_over_0_5', mercado: 'Más de 0.5 goles' }), true);
  assert.equal(esPickTrivial({ id: 'goles_local_over_0_5', mercado: 'Más de 0.5 goles del local' }), true);

  // Válidos
  assert.equal(esPickTrivial({ id: 'under_0_5', categoria: 'goles', tipo: 'under', linea: 0.5 }), false);
  assert.equal(esPickTrivial({ id: 'over_1_5', categoria: 'goles', tipo: 'over', linea: 1.5 }), false);
  assert.equal(esPickTrivial({ id: 'over_2_5', categoria: 'goles', tipo: 'over', linea: 2.5 }), false);
});

test('Regla 2: Over <= 2.5 tiros es trivial; Under <= 2.5 tiros o Over > 2.5 tiros son válidos', () => {
  // Triviales
  assert.equal(esPickTrivial({ id: 'tiros_total_over_2_5', categoria: 'tiros', tipo: 'over', linea: 2.5 }), true);
  assert.equal(esPickTrivial({ id: 'tiros_total_over_1_5', categoria: 'tiros', tipo: 'over', linea: 1.5 }), true);
  assert.equal(esPickTrivial({ id: 'tiros_local_over_2_5', categoria: 'tiros', tipo: 'over', linea: 2.5 }), true);

  // Válidos
  assert.equal(esPickTrivial({ id: 'tiros_total_under_2_5', categoria: 'tiros', tipo: 'under', linea: 2.5 }), false);
  assert.equal(esPickTrivial({ id: 'tiros_total_over_18_5', categoria: 'tiros', tipo: 'over', linea: 18.5 }), false);
  assert.equal(esPickTrivial({ id: 'tiros_local_over_9_5', categoria: 'tiros', tipo: 'over', linea: 9.5 }), false);
});

test('Regla 3: Over <= 1.5 tiros a puerta es trivial; Under <= 1.5 o Over > 1.5 son válidos', () => {
  // Triviales
  assert.equal(esPickTrivial({ id: 'tiros_puerta_local_over_1_5', categoria: 'tiros_puerta', tipo: 'over', linea: 1.5 }), true);
  assert.equal(esPickTrivial({ id: 'tiros_puerta_visitante_over_1_5', categoria: 'tiros_puerta', tipo: 'over', linea: 1.5 }), true);
  assert.equal(esPickTrivial({ id: 'tiros_puerta_total_over_1_5', categoria: 'tiros_puerta', tipo: 'over', linea: 1.5 }), true);

  // Válidos
  assert.equal(esPickTrivial({ id: 'tiros_puerta_local_under_1_5', categoria: 'tiros_puerta', tipo: 'under', linea: 1.5 }), false);
  assert.equal(esPickTrivial({ id: 'tiros_puerta_local_over_2_5', categoria: 'tiros_puerta', tipo: 'over', linea: 2.5 }), false);
  assert.equal(esPickTrivial({ id: 'tiros_puerta_total_over_8_5', categoria: 'tiros_puerta', tipo: 'over', linea: 8.5 }), false);
});

test('Regla 4: Over <= 1.5 córners es trivial; Under <= 1.5 o Over > 1.5 son válidos', () => {
  // Triviales
  assert.equal(esPickTrivial({ id: 'corners_local_over_1_5', categoria: 'corners', tipo: 'over', linea: 1.5 }), true);
  assert.equal(esPickTrivial({ id: 'corners_visitante_over_1_5', categoria: 'corners', tipo: 'over', linea: 1.5 }), true);
  assert.equal(esPickTrivial({ id: 'corners_total_over_1_5', categoria: 'corners', tipo: 'over', linea: 1.5 }), true);

  // Válidos
  assert.equal(esPickTrivial({ id: 'corners_local_under_1_5', categoria: 'corners', tipo: 'under', linea: 1.5 }), false);
  assert.equal(esPickTrivial({ id: 'corners_local_over_2_5', categoria: 'corners', tipo: 'over', linea: 2.5 }), false);
  assert.equal(esPickTrivial({ id: 'corners_total_over_8_5', categoria: 'corners', tipo: 'over', linea: 8.5 }), false);
});

test('Regla 5: Over 0.5 tarjetas por equipo (o totales <= 0.5) es trivial; Under o Over > 0.5 son válidos', () => {
  // Triviales
  assert.equal(esPickTrivial({ id: 'amarillas_local_over_0_5', categoria: 'tarjetas', tipo: 'over', linea: 0.5, alcance: 'local' }), true);
  assert.equal(esPickTrivial({ id: 'amarillas_visitante_over_0_5', categoria: 'tarjetas', tipo: 'over', linea: 0.5, alcance: 'visitante' }), true);
  assert.equal(esPickTrivial({ id: 'tarjetas_registradas_local_over_0_5', categoria: 'tarjetas', tipo: 'over', linea: 0.5, alcance: 'local' }), true);

  // Válidos
  assert.equal(esPickTrivial({ id: 'amarillas_local_under_0_5', categoria: 'tarjetas', tipo: 'under', linea: 0.5, alcance: 'local' }), false);
  assert.equal(esPickTrivial({ id: 'amarillas_local_over_1_5', categoria: 'tarjetas', tipo: 'over', linea: 1.5, alcance: 'local' }), false);
  assert.equal(esPickTrivial({ id: 'tarjetas_registradas_total_over_3_5', categoria: 'tarjetas', tipo: 'over', linea: 3.5, alcance: 'total' }), false);
});

test('Regla 6: Over <= 2.5 faltas es trivial; Under <= 2.5 o Over > 2.5 son válidos', () => {
  // Triviales
  assert.equal(esPickTrivial({ id: 'faltas_total_over_2_5', categoria: 'faltas', tipo: 'over', linea: 2.5 }), true);
  assert.equal(esPickTrivial({ id: 'faltas_local_over_2_5', categoria: 'faltas', tipo: 'over', linea: 2.5 }), true);

  // Válidos
  assert.equal(esPickTrivial({ id: 'faltas_total_under_2_5', categoria: 'faltas', tipo: 'under', linea: 2.5 }), false);
  assert.equal(esPickTrivial({ id: 'faltas_total_over_21_5', categoria: 'faltas', tipo: 'over', linea: 21.5 }), false);
  assert.equal(esPickTrivial({ id: 'faltas_local_over_10_5', categoria: 'faltas', tipo: 'over', linea: 10.5 }), false);
});

test('Otros mercados (ambos anotan, resultado, etc.) no se descartan', () => {
  assert.equal(esPickTrivial({ id: 'ambos_anotan', mercado: 'Ambos anotan', categoria: 'goles' }), false);
  assert.equal(esPickTrivial({ id: 'local_no_pierde', mercado: 'Local gana o empata', categoria: 'resultado' }), false);
});

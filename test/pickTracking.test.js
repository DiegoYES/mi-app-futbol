const test = require('node:test');
const assert = require('node:assert/strict');
const PickGuardado = require('../models/PickGuardado');
const { evaluarMercado, resumirRendimiento } = require('../services/pickTracking');

test('evalúa los mercados contra un marcador final', () => {
  assert.equal(evaluarMercado('over_1_5', 1, 1), true);
  assert.equal(evaluarMercado('over_2_5', 1, 1), false);
  assert.equal(evaluarMercado('ambos_anotan', 1, 1), true);
  assert.equal(evaluarMercado('local_no_pierde', 0, 1), false);
  assert.equal(evaluarMercado('mercado_desconocido', 1, 1), null);
});

test('liquida córners y tiros únicamente con estadísticas confirmadas', () => {
  const partido = {
    estadisticas_completas: true,
    equipo_local: { goles: 1, corners: 6, tiros_total: 13, tiros_puerta: 5 },
    equipo_visitante: { goles: 0, corners: 4, tiros_total: 9, tiros_puerta: 2 }
  };
  assert.equal(evaluarMercado('corners_total_over_9_5', partido), true);
  assert.equal(evaluarMercado('tiros_puerta_total_under_7_5', partido), true);

  partido.estadisticas_completas = false;
  assert.equal(evaluarMercado('corners_total_over_9_5', partido), null);
});

test('resume efectividad y calibración sin contar pendientes', () => {
  const resumen = resumirRendimiento([
    { estado: 'acertado', estimacion: 70 },
    { estado: 'fallado', estimacion: 80 },
    { estado: 'pendiente', estimacion: 90 }
  ]);

  assert.deepEqual(resumen, {
    total: 3,
    pendientes: 1,
    resueltos: 2,
    acertados: 1,
    fallados: 1,
    efectividad: 50,
    brier: 0.365
  });
});

test('cada usuario solo puede guardar una vez el mismo mercado y partido', () => {
  const indice = PickGuardado.schema.indexes().find(([, opciones]) => (
    opciones.name === 'pick_usuario_partido_mercado_unico'
  ));

  assert.ok(indice);
  assert.equal(indice[1].unique, true);
  assert.deepEqual(indice[0], { usuario: 1, partido_api_id: 1, 'mercado.id': 1 });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const MercadoCasa = require('../../models/MercadoCasa');
const { resolverEvento } = require('../../services/betting/marketMatchingService');
const { evaluarSelecciones, mercadoInterno } = require('../../services/betting/predictionEvaluationService');

const partido = { api_id: 10, fecha: new Date('2030-01-20T20:00:00Z'), liga: { id: 1, temporada: 2029 }, equipo_local: { id: 1, nombre: 'Club América' }, equipo_visitante: { id: 2, nombre: 'Cruz Azul' } };
function seleccion(extra = {}) { return { evento_externo_id: 'e1', evento_nombre: 'Club América vs Cruz Azul', local: 'Club America', visitante: 'Cruz Azul', inicio: partido.fecha, categoria: 'goals', lado: 'OVER', linea: 2.5, cuota: 1.9, estado: 'OPEN', problemas: [], ...extra }; }

test('matching de evento considera local, visitante y fecha', () => {
  assert.equal(resolverEvento(partido, [seleccion()]).estado, 'MATCHED');
});

test('matching ambiguo no publica automáticamente', () => {
  assert.equal(resolverEvento(partido, [seleccion(), seleccion({ evento_externo_id: 'e2' })]).estado, 'AMBIGUOUS_MATCH');
});

test('la línea de la casa mapea sólo a la misma línea interna', () => {
  assert.equal(mercadoInterno(seleccion({ linea: 3.5 }), partido), 'over_3_5');
  assert.notEqual(mercadoInterno(seleccion({ linea: 3.5 }), partido), 'over_1_5');
});

test('modelo de caché exige expiración y conserva historial siete días adicionales', () => {
  assert.equal(MercadoCasa.schema.path('expira_en').isRequired, true);
  const indice = MercadoCasa.schema.indexes().find(([campos]) => campos.expira_en === 1);
  assert.equal(indice[1].expireAfterSeconds, 86400 * 7);
});

test('evaluación clasifica cuotas suspendidas y líneas incompletas', async () => {
  const resultadoModelo = { mercados: [{ id: 'over_2_5', estimacion: 60, muestra: 10 }] };
  const [suspendida] = await evaluarSelecciones({ partido, selecciones: [seleccion({ estado: 'SUSPENDED' })], resultadoModelo });
  const [sinLinea] = await evaluarSelecciones({ partido, selecciones: [seleccion({ linea: null, problemas: ['LINE_NOT_AVAILABLE'] })], resultadoModelo });
  assert.equal(suspendida.estado, 'MARKET_SUSPENDED');
  assert.equal(sinLinea.estado, 'LINE_NOT_AVAILABLE');
});

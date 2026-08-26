const test = require('node:test');
const assert = require('node:assert/strict');
const { confianza, explicarMercado, frecuencia, generarPicks } = require('../services/pickEngine');

function partido(id, localId, golesLocal, visitanteId, golesVisitante) {
  return {
    api_id: id,
    fecha: new Date(`2024-08-${String(id + 1).padStart(2, '0')}T15:00:00Z`),
    equipo_local: { id: localId, nombre: `Equipo ${localId}`, goles: golesLocal },
    equipo_visitante: { id: visitanteId, nombre: `Equipo ${visitanteId}`, goles: golesVisitante }
  };
}

test('suaviza las frecuencias para no convertir muestras pequeñas en certeza', () => {
  const datos = frecuencia([partido(1, 10, 2, 20, 0)], 10);
  assert.equal(datos.over_1_5.aciertos, 1);
  assert.equal(datos.over_1_5.tasa, 0.6);
});

test('clasifica la confianza por tamaño de muestra', () => {
  assert.equal(confianza(4), 'baja');
  assert.equal(confianza(10), 'media');
  assert.equal(confianza(18), 'alta');
});

test('genera picks ordenados y conserva la evidencia de ambos equipos', () => {
  const local = Array.from({ length: 10 }, (_, i) => partido(i, 10, 2, 30 + i, i < 7 ? 1 : 0));
  const visita = Array.from({ length: 10 }, (_, i) => partido(20 + i, 40 + i, i < 8 ? 1 : 0, 20, 1));
  const resultado = generarPicks({
    partidosLocal: local,
    teamLocal: 10,
    partidosVisitante: visita,
    teamVisitante: 20
  });

  assert.ok(resultado.mercados.length > 0);
  assert.ok(resultado.mercados[0].estimacion >= resultado.mercados.at(-1).estimacion);
  const over15 = resultado.mercados.find(item => item.id === 'over_1_5');
  assert.equal(over15.evidencia.length, 2);
  assert.deepEqual(over15.detalle_fuentes.map(item => item.rol), ['local', 'visitante']);
  assert.ok(over15.detalle_fuentes.every(item => item.lectura === 'partidos_del_equipo'));
  assert.ok(over15.detalle_fuentes.every(item => Number.isFinite(item.tasa_suavizada)));
  assert.match(resultado.metodologia, /no es una probabilidad calibrada/);
});

test('proyecta al local solo con partidos en casa y al visitante solo con salidas', () => {
  const localEnCasa = [
    partido(1, 10, 2, 30, 0),
    partido(5, 10, 1, 31, 1),
    partido(6, 10, 3, 32, 0)
  ];
  const localFuera = partido(2, 30, 4, 10, 0);
  const visitanteFuera = [
    partido(3, 40, 0, 20, 2),
    partido(7, 41, 1, 20, 2),
    partido(8, 42, 0, 20, 3)
  ];
  const visitanteEnCasa = partido(4, 20, 4, 40, 0);
  const explicacion = explicarMercado({
    partidosLocal: [...localEnCasa, localFuera],
    teamLocal: 10,
    partidosVisitante: [...visitanteFuera, visitanteEnCasa],
    teamVisitante: 20,
    mercadoId: 'over_1_5',
    detalle: 5
  });

  // Con muestra suficiente por rol la condición efectiva se mantiene.
  assert.equal(explicacion.detalle_fuentes[0].condicion_efectiva, 'local');
  assert.deepEqual(explicacion.detalle_fuentes[0].partidos.map(item => item.api_id), [1, 5, 6]);
  assert.equal(explicacion.detalle_fuentes[0].partidos[0].condicion_referencia, 'local');
  assert.equal(explicacion.detalle_fuentes[1].condicion_efectiva, 'visitante');
  assert.deepEqual(explicacion.detalle_fuentes[1].partidos.map(item => item.api_id), [3, 7, 8]);
  assert.equal(explicacion.detalle_fuentes[1].partidos[0].condicion_referencia, 'visitante');
});

test('respeta condiciones independientes elegidas en el comparador', () => {
  const localSoloFuera = partido(1, 30, 0, 10, 2);
  const visitanteSoloEnCasa = partido(2, 20, 3, 40, 1);
  const resultado = generarPicks({
    partidosLocal: [localSoloFuera],
    teamLocal: 10,
    partidosVisitante: [visitanteSoloEnCasa],
    teamVisitante: 20,
    condicionLocal: 'visitante',
    condicionVisitante: 'local',
    limiteLocal: null,
    limiteVisitante: null
  });

  assert.ok(resultado.mercados.length > 0);
  assert.deepEqual(resultado.filtros.local, { condicion: 'visitante', condicion_efectiva: 'visitante', limite: null, periodo: 0 });
  assert.deepEqual(resultado.filtros.visitante, { condicion: 'local', condicion_efectiva: 'local', limite: null, periodo: 0 });
  const over15 = resultado.mercados.find(item => item.id === 'over_1_5');
  assert.equal(over15.fuentes, 2);
  assert.equal(over15.evidencia_parcial, false);
});

test('usa el periodo elegido para calcular las frecuencias de picks', () => {
  const local = partido(1, 10, 2, 30, 1);
  const visitante = partido(2, 40, 1, 20, 2);
  local.equipo_local.goles_primer_tiempo = 0;
  local.equipo_visitante.goles_primer_tiempo = 0;
  visitante.equipo_local.goles_primer_tiempo = 0;
  visitante.equipo_visitante.goles_primer_tiempo = 0;
  const completo = generarPicks({ partidosLocal: [local], teamLocal: 10, partidosVisitante: [visitante], teamVisitante: 20 });
  const primerTiempo = generarPicks({ partidosLocal: [local], teamLocal: 10, partidosVisitante: [visitante], teamVisitante: 20, halfLocal: 1, halfVisitante: 1 });

  assert.ok(completo.mercados.find(item => item.id === 'over_1_5').estimacion > primerTiempo.mercados.find(item => item.id === 'over_1_5').estimacion);
});

test('no convierte estadísticas avanzadas faltantes en ceros', () => {
  const sinCobertura = partido(1, 10, 1, 20, 0);
  const datos = frecuencia([sinCobertura], 10);

  assert.equal(datos.corners_total_over_8_5.total, 0);
  assert.equal(datos.corners_total_over_8_5.tasa, null);
});

test('excluye campos nulos aunque el partido esté marcado con cobertura avanzada', () => {
  const incompleto = partido(1, 10, 1, 20, 0);
  incompleto.estadisticas_completas = true;
  incompleto.equipo_local.faltas = null;
  incompleto.equipo_visitante.faltas = null;
  const datos = frecuencia([incompleto], 10);

  assert.equal(datos.faltas_total_under_19_5.total, 0);
  assert.equal(datos.faltas_local_under_8_5.total, 0);
  assert.equal(datos.faltas_visitante_under_8_5.total, 0);
});

test('la explicación salta partidos con el campo requerido ausente', () => {
  const incompleto = partido(3, 30, 1, 20, 1);
  incompleto.estadisticas_completas = true;
  incompleto.equipo_local.faltas = 12;
  incompleto.equipo_visitante.faltas = null;
  const completo = partido(2, 40, 1, 20, 1);
  completo.estadisticas_completas = true;
  completo.equipo_local.faltas = 14;
  completo.equipo_visitante.faltas = 7;
  const explicacion = explicarMercado({
    partidosLocal: [], teamLocal: 10,
    partidosVisitante: [incompleto, completo], teamVisitante: 20,
    mercadoId: 'faltas_visitante_under_8_5', detalle: 3
  });

  assert.deepEqual(explicacion.detalle_fuentes[0].partidos.map(item => item.api_id), [2]);
  assert.equal(explicacion.detalle_fuentes[0].partidos[0].valor, 7);
});

test('calcula líneas avanzadas cuando el partido sí tiene cobertura', () => {
  const completo = partido(1, 10, 1, 20, 0);
  completo.estadisticas_completas = true;
  Object.assign(completo.equipo_local, {
    corners: 6, tiros_total: 14, tiros_puerta: 5, faltas: 12,
    tarjetas_amarillas: 2, tarjetas_rojas: 0, offsides: 2
  });
  Object.assign(completo.equipo_visitante, {
    corners: 4, tiros_total: 10, tiros_puerta: 3, faltas: 11,
    tarjetas_amarillas: 3, tarjetas_rojas: 0, offsides: 1
  });
  const datos = frecuencia([completo], 10);

  assert.equal(datos.corners_total_over_8_5.aciertos, 1);
  assert.equal(datos.tiros_puerta_total_over_7_5.aciertos, 1);
  assert.equal(datos.faltas_total_under_23_5.aciertos, 1);
});

test('explica un mercado con los partidos y valores concretos de cada fuente', () => {
  const local = Array.from({ length: 3 }, (_, i) => {
    const p = partido(i, 10, 2, 30 + i, 0);
    p.estadisticas_completas = true;
    p.equipo_local.corners = 5 + i;
    p.equipo_visitante.corners = 2;
    return p;
  });
  const visitante = Array.from({ length: 3 }, (_, i) => {
    const p = partido(10 + i, 50 + i, 1, 20, 1);
    p.estadisticas_completas = true;
    p.equipo_local.corners = 4;
    p.equipo_visitante.corners = 3;
    return p;
  });
  const explicacion = explicarMercado({
    partidosLocal: local,
    teamLocal: 10,
    partidosVisitante: visitante,
    teamVisitante: 20,
    mercadoId: 'corners_local_over_2_5',
    limite: 10,
    detalle: 3
  });

  assert.equal(explicacion.detalle_fuentes[0].partidos.length, 3);
  assert.equal(explicacion.detalle_fuentes[0].partidos[0].valor, 5);
  assert.equal(explicacion.detalle_fuentes[0].partidos[0].sujeto, 'Equipo 10');
  assert.equal(explicacion.detalle_fuentes[1].lectura, 'concesion_del_rival');
  assert.equal(explicacion.detalle_fuentes[1].partidos[0].sujeto, 'Equipo 50');
  assert.ok(explicacion.detalle_fuentes.flatMap(item => item.partidos).every(item => item.cumplio));
});

test('calcula tarjetas registradas como amarillas más rojas simples', () => {
  const completo = partido(22, 10, 1, 20, 0);
  completo.estadisticas_completas = true;
  Object.assign(completo.equipo_local, { tarjetas_amarillas: 1, tarjetas_rojas: 1 });
  Object.assign(completo.equipo_visitante, { tarjetas_amarillas: 1, tarjetas_rojas: 0 });

  const datos = frecuencia([completo], 10);
  assert.equal(datos.tarjetas_registradas_total_over_2_5.aciertos, 1);
  assert.equal(datos.tarjetas_registradas_total_under_3_5.aciertos, 1);
});

test('cae a la forma general cuando la muestra por rol es menor al umbral', () => {
  // El equipo 10 aparece 2 veces como local y 5 como visitante: la condición
  // 'local' no alcanza el umbral y el motor debe usar los 7 partidos.
  const comoLocal = Array.from({ length: 2 }, (_, i) => partido(i, 10, 1, 60 + i, 0));
  const comoVisitante = Array.from({ length: 5 }, (_, i) => partido(30 + i, 70 + i, 0, 10, 2));
  const resultado = generarPicks({
    partidosLocal: [...comoLocal, ...comoVisitante],
    teamLocal: 10,
    partidosVisitante: [],
    teamVisitante: 20
  });

  const over05 = resultado.mercados.find(item => item.id === 'over_0_5');
  assert.ok(over05);
  assert.equal(over05.detalle_fuentes[0].condicion_efectiva, 'general');
  assert.equal(resultado.filtros.local.condicion_efectiva, 'general');
});

test('marca evidencia parcial y no recomienda mercados de un solo lado', () => {
  const local = Array.from({ length: 8 }, (_, i) => partido(i, 10, 3, 80 + i, 0));
  const resultado = generarPicks({
    partidosLocal: local,
    teamLocal: 10,
    partidosVisitante: [],
    teamVisitante: 20
  });

  const over05 = resultado.mercados.find(item => item.id === 'over_0_5');
  assert.ok(over05);
  assert.equal(over05.fuentes, 1);
  assert.equal(over05.evidencia_parcial, true);
  assert.ok(!resultado.recomendados.some(item => item.id === 'over_0_5'));
  assert.ok(resultado.recomendados.every(item => item.fuentes === 2 && !item.evidencia_parcial));
});

test('conserva la condición por rol cuando hay muestra suficiente', () => {
  const local = Array.from({ length: 6 }, (_, i) => partido(i, 10, 2, 90 + i, 1));
  const visita = Array.from({ length: 6 }, (_, i) => partido(40 + i, 95 + i, 1, 20, 1));
  const resultado = generarPicks({
    partidosLocal: local,
    teamLocal: 10,
    partidosVisitante: visita,
    teamVisitante: 20
  });

  assert.equal(resultado.filtros.local.condicion_efectiva, 'local');
  assert.equal(resultado.filtros.visitante.condicion_efectiva, 'visitante');
  const over15 = resultado.mercados.find(item => item.id === 'over_1_5');
  assert.equal(over15.evidencia_parcial, false);
});

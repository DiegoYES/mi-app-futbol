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

test('no convierte estadísticas avanzadas faltantes en ceros', () => {
  const sinCobertura = partido(1, 10, 1, 20, 0);
  const datos = frecuencia([sinCobertura], 10);

  assert.equal(datos.corners_total_over_8_5.total, 0);
  assert.equal(datos.corners_total_over_8_5.tasa, null);
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

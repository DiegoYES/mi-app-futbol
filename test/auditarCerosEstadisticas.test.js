const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATEGORIAS, CONFIRMACION_PRODUCCION, camposCobertura, filtroBase, horasRestantesDiaUtc,
  parseArgs, partir, planificarCambio, reservaParaCron
} = require('../scripts/auditarCerosEstadisticas');

const partido = {
  _id: 'x', api_id: 1623390, fecha: new Date('2026-08-20T18:30:00Z'), fecha_actualizacion: new Date('2026-08-23T18:09:19Z'),
  liga: { id: 848, temporada: 2026 }, estadisticas_intentos: 0, estadisticas_completas: true,
  equipo_local: { id: 631, goles: 0, tiros_total: 0, tiros_puerta: 3, corners: 7, faltas: 10, tarjetas_amarillas: 1, tarjetas_rojas: 0, offsides: 0, posesion: 50 },
  equipo_visitante: { id: 249, goles: 0, tiros_total: 0, tiros_puerta: 2, corners: 2, faltas: 6, tarjetas_amarillas: 5, tarjetas_rojas: 0, offsides: 2, posesion: 50 }
};

function bloque(teamId, valores) {
  const tipos = { tiros_total: 'Total Shots', tiros_puerta: 'Shots on Goal', corners: 'Corner Kicks', faltas: 'Fouls', tarjetas_amarillas: 'Yellow Cards', tarjetas_rojas: 'Red Cards', offsides: 'Offsides', posesion: 'Ball Possession' };
  return { team: { id: teamId }, statistics: Object.entries(valores).map(([clave, value]) => ({ type: tipos[clave], value })) };
}

test('los argumentos tienen valores conservadores por defecto', () => {
  const args = parseArgs([]);
  assert.equal(args.execute, false);
  assert.equal(args.maxLlamadas, 25);
  assert.equal(args.reservaCronHora, 250);
  assert.equal(args.reservaMinima, 1000);
  assert.throws(() => parseArgs(['--max-llamadas=0']), /entero positivo/);
  assert.throws(() => parseArgs(['sin-guiones']), /no reconocido/);
});

test('la reserva para el cron crece con las horas restantes del día UTC', () => {
  const args = parseArgs(['--reserva-cron-hora=250', '--reserva-minima=1000']);
  assert.equal(horasRestantesDiaUtc(new Date('2026-09-10T08:15:00Z')), 16);
  assert.equal(reservaParaCron(args, new Date('2026-09-10T08:15:00Z')), 4000);
  assert.equal(reservaParaCron(args, new Date('2026-09-10T23:30:00Z')), 1000);
});

test('divide candidatos en lotes de veinte y define las categorías esperadas', () => {
  assert.deepEqual(partir(Array.from({ length: 45 })).map(l => l.length), [20, 20, 5]);
  assert.deepEqual(CATEGORIAS.map(c => c.clave), [
    'sin_estadisticas_pendiente', 'todo_cero', 'tiros_total_cero_ambos', 'corners_cero_ambos', 'goles_mayor_que_tiros',
    'tiros_puerta_mayor_que_total', 'tarjetas_eventos_mayor_que_stats', 'tiros_total_cero_un_lado'
  ]);
  assert.equal(CONFIRMACION_PRODUCCION, 'REPARAR_CEROS_PRODUCCION');
});

test('si el proveedor no trae Total Shots deja null y retira la cobertura sin tocar otros campos', () => {
  const detalle = { fixture: { id: 1623390 }, goals: { home: 0, away: 0 }, statistics: [
    bloque(631, { tiros_total: null, tiros_puerta: 3, corners: 7, faltas: 10, tarjetas_amarillas: 1, tarjetas_rojas: 0, offsides: 0, posesion: '50%' }),
    bloque(249, { tiros_total: null, tiros_puerta: 2, corners: 2, faltas: 6, tarjetas_amarillas: 5, tarjetas_rojas: 0, offsides: 2, posesion: '50%' })
  ] };
  const plan = planificarCambio(detalle, { ...partido, fecha: new Date('2026-01-01T00:00:00Z') });
  assert.equal(plan.clasificacion, 'metricas_basicas_incompletas');
  assert.equal(plan.set['equipo_local.tiros_total'], null);
  assert.equal(plan.set['equipo_local.corners'], 7);
  assert.equal(plan.set.estadisticas_completas, false);
  assert.equal(plan.set.estadisticas_no_disponibles, true);
  assert.equal(plan.set.estadisticas_estado, 'sin_cobertura_proveedor');
  assert.deepEqual(plan.diferencias.map(d => d.campo).sort(), ['equipo_local.tiros_total', 'equipo_visitante.tiros_total']);
  assert.ok(Object.keys(plan.set).every(campo => !campo.includes('eventos') && !campo.includes('goles') && !campo.includes('formacion')));
});

test('un partido reciente sin cobertura sigue el flujo normal de reintentos', () => {
  const cobertura = camposCobertura({ fecha: new Date(), estadisticas_intentos: 0 }, false);
  assert.equal(cobertura.estadisticas_intentos, 1);
  assert.equal(cobertura.estadisticas_no_disponibles, false);
  assert.equal(cobertura.estadisticas_estado, 'pendiente');
});

test('si el proveedor trae valores reales corrige solo las diferencias', () => {
  const detalle = { fixture: { id: 1623390 }, goals: { home: 0, away: 0 }, statistics: [
    bloque(631, { tiros_total: 12, tiros_puerta: 3, corners: 7, faltas: 10, tarjetas_amarillas: 1, tarjetas_rojas: 0, offsides: 0, posesion: '50%' }),
    bloque(249, { tiros_total: 9, tiros_puerta: 2, corners: 2, faltas: 6, tarjetas_amarillas: 5, tarjetas_rojas: 0, offsides: 2, posesion: '50%' })
  ] };
  const plan = planificarCambio(detalle, partido);
  assert.equal(plan.clasificacion, 'discrepancia_corregida');
  assert.equal(plan.set['equipo_local.tiros_total'], 12);
  assert.equal(plan.set['equipo_visitante.tiros_total'], 9);
  assert.equal(plan.set.estadisticas_completas, true);
  assert.equal(plan.set.estadisticas_estado, 'completas');
  assert.deepEqual(plan.diferencias, [
    { campo: 'equipo_local.tiros_total', antes: 0, despues: 12 },
    { campo: 'equipo_visitante.tiros_total', antes: 0, despues: 9 }
  ]);
});

test('si el proveedor confirma los mismos valores no se escribe nada', () => {
  const detalle = { fixture: { id: 1623390 }, goals: { home: 0, away: 0 }, statistics: [
    bloque(631, { tiros_total: 0, tiros_puerta: 3, corners: 7, faltas: 10, tarjetas_amarillas: 1, tarjetas_rojas: 0, offsides: 0, posesion: '50%' }),
    bloque(249, { tiros_total: 0, tiros_puerta: 2, corners: 2, faltas: 6, tarjetas_amarillas: 5, tarjetas_rojas: 0, offsides: 2, posesion: '50%' })
  ] };
  const plan = planificarCambio(detalle, partido);
  assert.equal(plan.clasificacion, 'dato_real_confirmado');
  assert.equal(plan.set, null);
});

test('sin bloques de estadísticas anula las métricas y marca sin cobertura', () => {
  const plan = planificarCambio({ fixture: { id: 1623390 }, goals: { home: 0, away: 0 }, statistics: [] }, { ...partido, fecha: new Date('2025-05-01T00:00:00Z') });
  assert.equal(plan.clasificacion, 'sin_cobertura_proveedor');
  assert.equal(plan.set['equipo_local.corners'], null);
  assert.equal(plan.set.estadisticas_completas, false);
  assert.equal(plan.set.estadisticas_no_disponibles, true);
});

test('por defecto solo audita completas; --incluir-pendientes suma los finalizados sin cobertura', () => {
  const base = filtroBase(parseArgs(['--temporada-min=2025', '--liga=262']));
  assert.deepEqual(base, { estado: { $in: ['FT', 'AET', 'PEN'] }, estadisticas_completas: true, 'liga.temporada': { $gte: 2025 }, 'liga.id': 262 });

  const conPendientes = filtroBase(parseArgs(['--incluir-pendientes']));
  assert.equal(conPendientes.estadisticas_completas, undefined);
  assert.deepEqual(conPendientes.$or, [
    { estadisticas_completas: true },
    { estadisticas_completas: { $ne: true }, estadisticas_no_disponibles: { $ne: true } }
  ]);
});

test('un pendiente con estadísticas en el proveedor queda completado en una sola pasada', () => {
  const pendiente = { ...partido, estadisticas_completas: false, equipo_local: { id: 631, goles: 0 }, equipo_visitante: { id: 249, goles: 0 } };
  const detalle = { fixture: { id: 1623390 }, goals: { home: 0, away: 0 }, statistics: [
    bloque(631, { tiros_total: 12, tiros_puerta: 3, corners: 7, faltas: 10, tarjetas_amarillas: 1, tarjetas_rojas: 0, offsides: 0, posesion: '50%' }),
    bloque(249, { tiros_total: 9, tiros_puerta: 2, corners: 2, faltas: 6, tarjetas_amarillas: 5, tarjetas_rojas: 0, offsides: 2, posesion: '50%' })
  ] };
  const plan = planificarCambio(detalle, pendiente);
  assert.equal(plan.clasificacion, 'estadisticas_completadas');
  assert.equal(plan.set.estadisticas_completas, true);
  assert.equal(plan.set.estadisticas_estado, 'completas');
  assert.equal(plan.set['equipo_local.tiros_total'], 12);
});

test('un pendiente antiguo sin cobertura se cierra como sin_cobertura_proveedor sin más reintentos', () => {
  const pendiente = { ...partido, estadisticas_completas: false, fecha: new Date('2025-09-01T00:00:00Z') };
  const plan = planificarCambio({ fixture: { id: 1623390 }, goals: { home: 0, away: 0 } }, pendiente);
  assert.equal(plan.clasificacion, 'sin_cobertura_proveedor');
  assert.equal(plan.set.estadisticas_no_disponibles, true);
  assert.equal(plan.set.estadisticas_intentos, 3);
  assert.equal(plan.set.estadisticas_estado, 'sin_cobertura_proveedor');
});

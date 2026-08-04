const { MERCADOS, obtenerMercado } = require('./marketCatalog');
const { estadisticasPeriodo } = require('./teamStats');

const MERCADOS_EVALUABLES = new Set(MERCADOS.map(mercado => mercado.id));

function separarPeriodo(mercadoId) {
  const coincidencia = String(mercadoId).match(/^(.*)__(1|2)t$/);
  return coincidencia
    ? { mercadoId: coincidencia[1], periodo: Number(coincidencia[2]) }
    : { mercadoId, periodo: 0 };
}

function idMercadoPeriodo(mercadoId, periodo = 0) {
  return periodo === 1 || periodo === 2 ? `${mercadoId}__${periodo}t` : mercadoId;
}

function evaluarMercado(mercadoId, partidoOGolesLocal, golesVisitante) {
  const separado = separarPeriodo(mercadoId);
  const mercado = obtenerMercado(separado.mercadoId);
  if (!mercado) return null;

  if (typeof partidoOGolesLocal === 'object' && partidoOGolesLocal !== null) {
    const partido = partidoOGolesLocal;
    if (separado.periodo > 0 && partido.tiempos_completos !== true) return null;
    if (separado.periodo === 0 && mercado.requiereAvanzadas && partido.estadisticas_completas !== true) return null;
    if (![partido.equipo_local?.goles, partido.equipo_visitante?.goles].every(Number.isFinite)) return null;
    return mercado.cumple(
      estadisticasPeriodo(partido.equipo_local, separado.periodo),
      estadisticasPeriodo(partido.equipo_visitante, separado.periodo)
    );
  }

  if (![partidoOGolesLocal, golesVisitante].every(Number.isFinite)) return null;
  if (mercado.requiereAvanzadas) return null;
  return mercado.cumple({ goles: partidoOGolesLocal }, { goles: golesVisitante });
}

function resumirRendimiento(picks) {
  const acertados = picks.filter(pick => pick.estado === 'acertado').length;
  const fallados = picks.filter(pick => pick.estado === 'fallado').length;
  const pendientes = picks.filter(pick => pick.estado === 'pendiente').length;
  const resueltos = acertados + fallados;
  const evaluados = picks.filter(pick => (
    ['acertado', 'fallado'].includes(pick.estado) && Number.isFinite(pick.estimacion)
  ));
  const brier = evaluados.length
    ? evaluados.reduce((suma, pick) => {
      const probabilidad = pick.estimacion / 100;
      const realidad = pick.estado === 'acertado' ? 1 : 0;
      return suma + ((probabilidad - realidad) ** 2);
    }, 0) / evaluados.length
    : null;

  return {
    total: picks.length,
    pendientes,
    resueltos,
    acertados,
    fallados,
    efectividad: resueltos ? Number(((acertados / resueltos) * 100).toFixed(1)) : null,
    brier: brier === null ? null : Number(brier.toFixed(3))
  };
}

module.exports = { MERCADOS_EVALUABLES, evaluarMercado, idMercadoPeriodo, resumirRendimiento, separarPeriodo };

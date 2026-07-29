const { contextoPartido } = require('./teamStats');
const { MERCADOS, obtenerMercado } = require('./marketCatalog');

function casoParticular(partido, contexto, perspectiva, mercado) {
  const statsLocal = perspectiva === 'local' ? contexto.statsEquipo : contexto.statsRival;
  const statsVisitante = perspectiva === 'local' ? contexto.statsRival : contexto.statsEquipo;
  const equipoLocal = perspectiva === 'local' ? contexto.equipo : contexto.rival;
  const equipoVisitante = perspectiva === 'local' ? contexto.rival : contexto.equipo;
  const valor = typeof mercado.medir === 'function'
    ? mercado.medir(statsLocal, statsVisitante)
    : null;
  const sujeto = mercado.alcance === 'local'
    ? equipoLocal.nombre
    : mercado.alcance === 'visitante'
      ? equipoVisitante.nombre
      : `${equipoLocal.nombre} vs ${equipoVisitante.nombre}`;

  return {
    api_id: partido.api_id,
    fecha: partido.fecha,
    local: partido.equipo_local.nombre,
    visitante: partido.equipo_visitante.nombre,
    marcador: `${partido.equipo_local.goles}-${partido.equipo_visitante.goles}`,
    condicion_referencia: contexto.esLocal ? 'local' : 'visitante',
    sujeto,
    valor,
    unidad: mercado.unidad || 'valor',
    cumplio: mercado.cumple(statsLocal, statsVisitante)
  };
}

function frecuenciaMercado(registros, perspectiva, mercado, limite, detalle = 0) {
  const utilizables = registros
    .filter(({ partido }) => !mercado.requiereAvanzadas || partido.estadisticas_completas === true)
    .slice(0, limite);
  const evaluados = utilizables.map(({ partido, contexto }) => ({
    partido,
    contexto,
    cumplio: mercado.cumple(
      perspectiva === 'local' ? contexto.statsEquipo : contexto.statsRival,
      perspectiva === 'local' ? contexto.statsRival : contexto.statsEquipo
    )
  }));
  const aciertos = evaluados.filter(item => item.cumplio).length;
  const total = utilizables.length;
  return {
    aciertos,
    total,
    tasa: total === 0 ? null : (aciertos + 2) / (total + 4),
    ...(detalle > 0 ? {
      partidos: utilizables.slice(0, detalle).map(({ partido, contexto }) => (
        casoParticular(partido, contexto, perspectiva, mercado)
      ))
    } : {})
  };
}

function frecuencia(partidos, teamId, perspectiva = 'local', limite = 10) {
  const registros = partidos
    .map(partido => ({ partido, contexto: contextoPartido(partido, teamId) }))
    .filter(item => item.contexto);
  const resultado = {};

  for (const mercado of MERCADOS) {
    resultado[mercado.id] = frecuenciaMercado(registros, perspectiva, mercado, limite);
  }
  return resultado;
}

function confianza(muestra) {
  if (muestra >= 15) return 'alta';
  if (muestra >= 8) return 'media';
  return 'baja';
}

function partidosEnCondicion(partidos, teamId, condicion) {
  const campo = condicion === 'local' ? 'equipo_local' : 'equipo_visitante';
  return partidos.filter(partido => partido?.[campo]?.id === teamId);
}

function combinar(mercado, a, b) {
  const disponibles = [
    { rol: 'local', dato: a },
    { rol: 'visitante', dato: b }
  ].filter(item => item.dato?.tasa !== null && item.dato?.tasa !== undefined);
  if (disponibles.length === 0) return null;
  const tasa = disponibles.reduce((suma, item) => suma + item.dato.tasa, 0) / disponibles.length;
  const muestra = Math.min(...disponibles.map(item => item.dato.total));

  return {
    id: mercado.id,
    mercado: mercado.nombre,
    categoria: mercado.categoria,
    tipo: mercado.tipo,
    linea: mercado.linea,
    alcance: mercado.alcance,
    requiere_avanzadas: mercado.requiereAvanzadas,
    estimacion: Number((tasa * 100).toFixed(1)),
    confianza: confianza(muestra),
    muestra,
    fuentes: disponibles.length,
    evidencia: disponibles.map(item => `${item.dato.aciertos}/${item.dato.total}`),
    detalle_fuentes: disponibles.map(item => ({
      rol: item.rol,
      lectura: mercado.alcance === 'total'
        ? 'partidos_del_equipo'
        : mercado.alcance === item.rol
          ? 'produccion_propia'
          : 'concesion_del_rival',
      aciertos: item.dato.aciertos,
      total: item.dato.total,
      frecuencia_observada: Number(((item.dato.aciertos / item.dato.total) * 100).toFixed(1)),
      tasa_suavizada: Number((item.dato.tasa * 100).toFixed(1)),
      partidos: item.dato.partidos
    }))
  };
}

function explicarMercado({ partidosLocal, teamLocal, partidosVisitante, teamVisitante, mercadoId, limite = 10, detalle = 3 }) {
  const mercado = obtenerMercado(mercadoId);
  if (!mercado) return null;
  const registrosLocal = partidosEnCondicion(partidosLocal, teamLocal, 'local')
    .map(partido => ({ partido, contexto: contextoPartido(partido, teamLocal) }))
    .filter(item => item.contexto);
  const registrosVisitante = partidosEnCondicion(partidosVisitante, teamVisitante, 'visitante')
    .map(partido => ({ partido, contexto: contextoPartido(partido, teamVisitante) }))
    .filter(item => item.contexto);
  return combinar(
    mercado,
    frecuenciaMercado(registrosLocal, 'local', mercado, limite, detalle),
    frecuenciaMercado(registrosVisitante, 'visitante', mercado, limite, detalle)
  );
}

function generarPicks({ partidosLocal, teamLocal, partidosVisitante, teamVisitante, limite = 10 }) {
  const local = frecuencia(partidosEnCondicion(partidosLocal, teamLocal, 'local'), teamLocal, 'local', limite);
  const visitante = frecuencia(partidosEnCondicion(partidosVisitante, teamVisitante, 'visitante'), teamVisitante, 'visitante', limite);
  const mercados = MERCADOS
    .map(mercado => combinar(mercado, local[mercado.id], visitante[mercado.id]))
    .filter(Boolean)
    .sort((a, b) => b.estimacion - a.estimacion || a.mercado.localeCompare(b.mercado, 'es'));
  const recomendados = mercados.filter(item => (
    item.estimacion >= 65 && item.muestra >= 5 && item.fuentes === 2
  ));

  return {
    mercados,
    recomendados,
    categorias: [...new Set(mercados.map(item => item.categoria))],
    metodologia: 'Frecuencia histórica suavizada: el local usa únicamente sus partidos en casa y el visitante únicamente sus partidos fuera; las estadísticas avanzadas excluyen partidos sin cobertura. Esto no es una probabilidad calibrada ni garantiza resultados.'
  };
}

module.exports = { confianza, explicarMercado, frecuencia, generarPicks, partidosEnCondicion };

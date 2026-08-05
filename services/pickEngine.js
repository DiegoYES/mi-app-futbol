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
  const stats = contexto => perspectiva === 'local'
    ? [contexto.statsEquipo, contexto.statsRival]
    : [contexto.statsRival, contexto.statsEquipo];
  const disponibles = registros.filter(registro => {
    if (!mercado.requiereAvanzadas) return true;
    if (!registro.coberturaAvanzada || typeof mercado.medir !== 'function') return false;
    const valor = mercado.medir(...stats(registro.contexto));
    return valor !== null && valor !== undefined && (typeof valor !== 'number' || Number.isFinite(valor));
  });
  const utilizables = limite === null ? disponibles : disponibles.slice(0, limite);
  const evaluados = utilizables.map(({ partido, contexto }) => ({
    partido,
    contexto,
    cumplio: mercado.cumple(...stats(contexto))
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

function registrosPartidos(partidos, teamId, half = 0) {
  return partidos
    .map(partido => ({
      partido,
      contexto: contextoPartido(partido, teamId, half),
      coberturaAvanzada: half === 0
        ? partido.estadisticas_completas === true
        : partido.tiempos_completos === true
    }))
    .filter(item => item.contexto);
}

function frecuencia(partidos, teamId, perspectiva = 'local', limite = 10, half = 0) {
  const registros = registrosPartidos(partidos, teamId, half);
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
  if (condicion === 'general') {
    return partidos.filter(partido => partido?.equipo_local?.id === teamId || partido?.equipo_visitante?.id === teamId);
  }
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

function explicarMercado({
  partidosLocal, teamLocal, partidosVisitante, teamVisitante, mercadoId,
  limite = 10, limiteLocal = limite, limiteVisitante = limite,
  condicionLocal = 'local', condicionVisitante = 'visitante',
  halfLocal = 0, halfVisitante = 0, detalle = 3
}) {
  const mercado = obtenerMercado(mercadoId);
  if (!mercado) return null;
  const registrosLocal = registrosPartidos(partidosEnCondicion(partidosLocal, teamLocal, condicionLocal), teamLocal, halfLocal);
  const registrosVisitante = registrosPartidos(partidosEnCondicion(partidosVisitante, teamVisitante, condicionVisitante), teamVisitante, halfVisitante);
  return combinar(
    mercado,
    frecuenciaMercado(registrosLocal, 'local', mercado, limiteLocal, detalle),
    frecuenciaMercado(registrosVisitante, 'visitante', mercado, limiteVisitante, detalle)
  );
}

function generarPicks({
  partidosLocal, teamLocal, partidosVisitante, teamVisitante,
  limite = 10, limiteLocal = limite, limiteVisitante = limite,
  condicionLocal = 'local', condicionVisitante = 'visitante',
  halfLocal = 0, halfVisitante = 0
}) {
  const local = frecuencia(partidosEnCondicion(partidosLocal, teamLocal, condicionLocal), teamLocal, 'local', limiteLocal, halfLocal);
  const visitante = frecuencia(partidosEnCondicion(partidosVisitante, teamVisitante, condicionVisitante), teamVisitante, 'visitante', limiteVisitante, halfVisitante);
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
    filtros: {
      local: { condicion: condicionLocal, limite: limiteLocal, periodo: halfLocal },
      visitante: { condicion: condicionVisitante, limite: limiteVisitante, periodo: halfVisitante }
    },
    metodologia: `Frecuencia histórica suavizada con la muestra elegida: local proyectado (${condicionLocal}, periodo ${halfLocal}) y visitante proyectado (${condicionVisitante}, periodo ${halfVisitante}); las estadísticas avanzadas excluyen partidos sin cobertura. Esto no es una probabilidad calibrada ni garantiza resultados.`
  };
}

module.exports = { confianza, explicarMercado, frecuencia, generarPicks, partidosEnCondicion };

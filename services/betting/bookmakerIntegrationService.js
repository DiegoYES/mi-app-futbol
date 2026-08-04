const { vigentes } = require('./marketRepository');
const { resolverEvento } = require('./marketMatchingService');
const { evaluarSelecciones, mercadoInterno } = require('./predictionEvaluationService');

function resumir(resultados) {
  return resultados.reduce((salida, item) => {
    salida[item.estado] = (salida[item.estado] || 0) + 1;
    return salida;
  }, {});
}

async function evaluarPartidoEnCasa(partido, resultadoModelo, proveedor = 'playdoit', opciones = {}) {
  const selecciones = opciones.selecciones || await vigentes(proveedor);
  if (!selecciones.length) {
    return { proveedor, estado: 'CACHE_EMPTY_OR_EXPIRED', actualizado_en: null, resultados: [], resumen: {} };
  }
  const coincidencia = resolverEvento(partido, selecciones);
  if (coincidencia.estado !== 'MATCHED') {
    return {
      proveedor,
      estado: coincidencia.estado,
      actualizado_en: selecciones[0]?.recolectado_en || null,
      resultados: [],
      resumen: { [coincidencia.estado]: 1 }
    };
  }
  const mercadoIds = opciones.mercadoIds ? new Set(opciones.mercadoIds) : null;
  const seleccionesEvaluables = mercadoIds
    ? coincidencia.evento.selecciones.filter(item => mercadoIds.has(mercadoInterno(item, partido)))
    : coincidencia.evento.selecciones;
  const resultados = await evaluarSelecciones({
    partido,
    selecciones: seleccionesEvaluables,
    resultadoModelo
  });
  return {
    proveedor,
    estado: 'MATCHED',
    evento: {
      id: coincidencia.evento.evento.evento_externo_id,
      nombre: coincidencia.evento.evento.evento_nombre,
      score: coincidencia.evento.score
    },
    actualizado_en: coincidencia.evento.evento.recolectado_en,
    resultados,
    picks_apostables: resultados.filter(item => item.estado === 'AVAILABLE_WITH_VALUE'),
    resumen: resumir(resultados)
  };
}

module.exports = { evaluarPartidoEnCasa, resumir };

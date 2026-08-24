const MAX_INTENTOS_ESTADISTICAS = 3;

function resolverCoberturaEstadisticas(partido = {}, completas, ahora = new Date()) {
  if (completas) {
    return {
      estadisticas_no_disponibles: false,
      estadisticas_estado: 'completas',
      estadisticas_ausencia_motivo: null,
      estadisticas_ultimo_intento_en: ahora
    };
  }

  const intentos = Math.max(0, Number(partido.estadisticas_intentos) || 0) + 1;
  const agotados = intentos >= MAX_INTENTOS_ESTADISTICAS;
  return {
    estadisticas_intentos: intentos,
    estadisticas_no_disponibles: agotados,
    estadisticas_estado: agotados ? 'sin_cobertura_proveedor' : 'pendiente',
    estadisticas_ausencia_motivo: agotados ? 'metricas_basicas_incompletas' : null,
    estadisticas_ultimo_intento_en: ahora
  };
}

module.exports = { MAX_INTENTOS_ESTADISTICAS, resolverCoberturaEstadisticas };

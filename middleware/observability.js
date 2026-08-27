const iniciadoEn = Date.now();
const metricas = {
  solicitudes: 0,
  activas: 0,
  respuestas_429: 0,
  duracion_total_ms: 0,
  duracion_maxima_ms: 0,
  por_estado: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
};

function observarHttp(_req, res, next) {
  const inicio = process.hrtime.bigint();
  metricas.solicitudes += 1;
  metricas.activas += 1;
  let finalizada = false;
  const finalizar = () => {
    if (finalizada) return;
    finalizada = true;
    const duracion = Number(process.hrtime.bigint() - inicio) / 1_000_000;
    metricas.activas = Math.max(0, metricas.activas - 1);
    metricas.duracion_total_ms += duracion;
    metricas.duracion_maxima_ms = Math.max(metricas.duracion_maxima_ms, duracion);
    const familia = `${Math.floor(res.statusCode / 100)}xx`;
    if (familia in metricas.por_estado) metricas.por_estado[familia] += 1;
    if (res.statusCode === 429) metricas.respuestas_429 += 1;
  };
  res.once('finish', finalizar);
  res.once('close', finalizar);
  next();
}

function obtenerMetricasHttp() {
  return {
    uptime_segundos: Math.floor((Date.now() - iniciadoEn) / 1000),
    solicitudes: metricas.solicitudes,
    activas: metricas.activas,
    respuestas_429: metricas.respuestas_429,
    duracion_promedio_ms: metricas.solicitudes
      ? Number((metricas.duracion_total_ms / metricas.solicitudes).toFixed(2))
      : 0,
    duracion_maxima_ms: Number(metricas.duracion_maxima_ms.toFixed(2)),
    por_estado: { ...metricas.por_estado }
  };
}

module.exports = { observarHttp, obtenerMetricasHttp };

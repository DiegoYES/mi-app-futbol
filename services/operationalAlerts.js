function numero(valor, fallback = 0) { return Number.isFinite(Number(valor)) ? Number(valor) : fallback; }

function evaluarAlertas(calidad, http = {}, env = process.env, ahora = new Date()) {
  const alertas = [];
  const maxCronMin = numero(env.ALERT_CRON_MAX_MINUTES, 90);
  const ultimaOk = calidad.cron?.ultima_ejecucion_exitosa ? new Date(calidad.cron.ultima_ejecucion_exitosa) : null;
  if (calidad.cron?.estado === 'fallido' || !ultimaOk || ahora - ultimaOk > maxCronMin * 60000) alertas.push({ codigo: 'CRON_ATRASADO', severidad: 'alta', detalle: calidad.cron?.estado === 'fallido' ? 'última ejecución fallida' : ultimaOk?.toISOString() || 'sin ejecución exitosa' });
  const restantes = numero(calidad.cuota?.restantes, Infinity);
  if (restantes <= numero(env.ALERT_QUOTA_REMAINING, 50)) alertas.push({ codigo: 'CUOTA_BAJA', severidad: 'media', detalle: `${restantes} restantes` });
  if (numero(calidad.problemas?.partidos_ns_atrasados) >= numero(env.ALERT_STALE_MATCHES, 5)) alertas.push({ codigo: 'PARTIDOS_ATRASADOS', severidad: 'alta', detalle: calidad.problemas.partidos_ns_atrasados });
  if (calidad.redis === 'no_disponible') alertas.push({ codigo: 'REDIS_CAIDO', severidad: 'alta', detalle: 'Redis no disponible' });
  if (calidad.version?.diferencias) alertas.push({ codigo: 'VERSION_POOL', severidad: 'critica', detalle: calidad.version.instancias });
  if (numero(calidad.pagos?.webhook_pago_fallos) > 0) alertas.push({ codigo: 'WEBHOOK_PAGO_FALLANDO', severidad: 'critica', detalle: calidad.pagos });
  if (numero(calidad.pagos?.discrepancias_suscripcion) > 0) alertas.push({ codigo: 'SUSCRIPCION_INCONSISTENTE', severidad: 'alta', detalle: calidad.pagos.discrepancias_suscripcion });
  const solicitudes = numero(http.solicitudes);
  const errores5xx = numero(http.por_estado?.['5xx']);
  if (solicitudes >= 20 && errores5xx / solicitudes >= numero(env.ALERT_5XX_RATE, 0.05)) alertas.push({ codigo: 'HTTP_5XX_ALTO', severidad: 'alta', detalle: `${errores5xx}/${solicitudes}` });
  const respuestas429 = numero(http.respuestas_429 || http['429']);
  if (respuestas429 >= numero(env.ALERT_429_COUNT, 20)) alertas.push({ codigo: 'HTTP_429_ALTO', severidad: 'media', detalle: respuestas429 });
  return alertas;
}

async function notificarAlertas(alertas, env = process.env, fetchImpl = global.fetch) {
  if (!alertas.length) return { enviadas: 0, canal: 'ninguno' };
  const payload = { aplicacion: 'data-fut', entorno: env.APP_ENVIRONMENT || env.NODE_ENV || 'desconocido', generado_en: new Date().toISOString(), alertas };
  if (!env.ALERT_WEBHOOK_URL) {
    console.warn(`[operational-alert] ${JSON.stringify(payload)}`);
    return { enviadas: alertas.length, canal: 'log' };
  }
  const respuesta = await fetchImpl(env.ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
  if (!respuesta.ok) throw new Error(`Webhook de alertas respondió ${respuesta.status}`);
  return { enviadas: alertas.length, canal: 'webhook' };
}

module.exports = { evaluarAlertas, notificarAlertas };

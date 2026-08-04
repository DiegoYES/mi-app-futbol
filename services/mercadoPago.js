const crypto = require('crypto');

const API_BASE = 'https://api.mercadopago.com';
const PRECIO_MENSUAL = 70;

class ErrorMercadoPago extends Error {
  constructor(message, status, detalle) {
    super(message);
    this.name = 'ErrorMercadoPago';
    this.status = status;
    this.detalle = detalle;
  }
}

function configuracion(env = process.env) {
  const accessToken = String(env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  if (!accessToken) throw new Error('Falta MERCADOPAGO_ACCESS_TOKEN');
  return { accessToken };
}

async function solicitar(ruta, opciones = {}, dependencias = {}) {
  const { accessToken } = configuracion(dependencias.env);
  const fetchImpl = dependencias.fetchImpl || fetch;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...opciones.headers
  };
  const respuesta = await fetchImpl(`${API_BASE}${ruta}`, {
    ...opciones,
    headers,
    signal: opciones.signal || AbortSignal.timeout(10_000)
  });
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new ErrorMercadoPago(
      'Mercado Pago rechazó la operación.',
      respuesta.status,
      cuerpo?.message || cuerpo?.error || null
    );
  }
  return cuerpo;
}

function origenPublico(env = process.env) {
  const primero = String(env.APP_ORIGIN || '').split(',')[0].trim();
  const url = new URL(primero);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('APP_ORIGIN no es válido');
  return url.origin;
}

function crearSuscripcionPendiente({ usuarioId, email }, dependencias = {}) {
  const env = dependencias.env || process.env;
  const origen = origenPublico(env);
  const emailPrueba = String(env.MERCADOPAGO_TEST_PAYER_EMAIL || '').trim();
  const payerEmail = env.MERCADOPAGO_ENVIRONMENT === 'test' && emailPrueba
    ? emailPrueba
    : email;
  const idempotencyKey = crypto.randomUUID();
  return solicitar('/preapproval', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      reason: 'Membresía Data Fut',
      external_reference: String(usuarioId),
      payer_email: payerEmail,
      back_url: `${origen}/suscripcion.html`,
      notification_url: `${origen}/webhooks/mercadopago`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: PRECIO_MENSUAL,
        currency_id: 'MXN'
      },
      status: 'pending'
    })
  }, dependencias);
}

function obtenerSuscripcion(id, dependencias = {}) {
  return solicitar(`/preapproval/${encodeURIComponent(id)}`, {}, dependencias);
}

function obtenerPagoAutorizado(id, dependencias = {}) {
  return solicitar(`/authorized_payments/${encodeURIComponent(id)}`, {}, dependencias);
}

function cancelarSuscripcion(id, dependencias = {}) {
  return solicitar(`/preapproval/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'cancelled' })
  }, dependencias);
}

function partesFirma(encabezado) {
  const resultado = {};
  for (const parte of String(encabezado || '').split(',')) {
    const indice = parte.indexOf('=');
    if (indice > 0) resultado[parte.slice(0, indice).trim()] = parte.slice(indice + 1).trim();
  }
  return resultado;
}

function firmaWebhookValida({ xSignature, xRequestId, dataId, secret }) {
  const { ts, v1 } = partesFirma(xSignature);
  if (!ts || !v1 || !xRequestId || !dataId || !secret) return false;
  const idNormalizado = String(dataId).toLowerCase();
  const manifiesto = `id:${idNormalizado};request-id:${xRequestId};ts:${ts};`;
  const calculada = crypto.createHmac('sha256', secret).update(manifiesto).digest('hex');
  const recibida = String(v1).toLowerCase();
  if (calculada.length !== recibida.length) return false;
  return crypto.timingSafeEqual(Buffer.from(calculada), Buffer.from(recibida));
}

module.exports = {
  ErrorMercadoPago,
  PRECIO_MENSUAL,
  cancelarSuscripcion,
  crearSuscripcionPendiente,
  firmaWebhookValida,
  obtenerPagoAutorizado,
  obtenerSuscripcion
};

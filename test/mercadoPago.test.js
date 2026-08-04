const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  PRECIO_MENSUAL,
  crearSuscripcionPendiente,
  firmaWebhookValida
} = require('../services/mercadoPago');

test('crea la solicitud de suscripción con precio fijo del servidor', async () => {
  let peticion;
  const fetchImpl = async (url, opciones) => {
    peticion = { url, opciones, body: JSON.parse(opciones.body) };
    return {
      ok: true,
      status: 201,
      json: async () => ({ id: 'preapproval-test', init_point: 'https://mercadopago.test/checkout' })
    };
  };
  const respuesta = await crearSuscripcionPendiente(
    { usuarioId: 'usuario-123', email: 'comprador@example.com' },
    {
      fetchImpl,
      env: { MERCADOPAGO_ACCESS_TOKEN: 'TEST-token', APP_ORIGIN: 'https://staging.example.com' }
    }
  );

  assert.equal(respuesta.id, 'preapproval-test');
  assert.equal(peticion.url, 'https://api.mercadopago.com/preapproval');
  assert.equal(peticion.body.auto_recurring.transaction_amount, PRECIO_MENSUAL);
  assert.equal(peticion.body.auto_recurring.currency_id, 'MXN');
  assert.equal(peticion.body.status, 'pending');
  assert.equal(peticion.body.external_reference, 'usuario-123');
  assert.equal(peticion.body.payer_email, 'comprador@example.com');
  assert.equal(peticion.body.notification_url, 'https://staging.example.com/webhooks/mercadopago');
  assert.match(peticion.opciones.headers.Authorization, /^Bearer /);
  assert.ok(peticion.opciones.headers['X-Idempotency-Key']);
});

test('usa el comprador TESTUSER sólo en el ambiente de prueba', async () => {
  let body;
  const fetchImpl = async (_url, opciones) => {
    body = JSON.parse(opciones.body);
    return { ok: true, status: 201, json: async () => ({ id: 'preapproval-test' }) };
  };
  const baseEnv = {
    MERCADOPAGO_ACCESS_TOKEN: 'TEST-token',
    MERCADOPAGO_TEST_PAYER_EMAIL: 'test_user_123@testuser.com',
    APP_ORIGIN: 'https://staging.example.com'
  };

  await crearSuscripcionPendiente(
    { usuarioId: 'usuario-123', email: 'cliente@example.com' },
    { fetchImpl, env: { ...baseEnv, MERCADOPAGO_ENVIRONMENT: 'test' } }
  );
  assert.equal(body.payer_email, 'test_user_123@testuser.com');

  await crearSuscripcionPendiente(
    { usuarioId: 'usuario-123', email: 'cliente@example.com' },
    { fetchImpl, env: { ...baseEnv, MERCADOPAGO_ENVIRONMENT: 'production' } }
  );
  assert.equal(body.payer_email, 'cliente@example.com');
});

test('valida la firma HMAC de Mercado Pago y rechaza alteraciones', () => {
  const secret = 'secreto-webhook';
  const dataId = 'ABC123';
  const requestId = 'request-456';
  const ts = '1704908010';
  const manifiesto = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const firma = crypto.createHmac('sha256', secret).update(manifiesto).digest('hex');
  const datos = { xSignature: `ts=${ts},v1=${firma}`, xRequestId: requestId, dataId, secret };

  assert.equal(firmaWebhookValida(datos), true);
  assert.equal(firmaWebhookValida({ ...datos, dataId: 'otro' }), false);
  assert.equal(firmaWebhookValida({ ...datos, xSignature: '' }), false);
});

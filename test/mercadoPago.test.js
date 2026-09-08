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
  const datos = { xSignature: `ts=${ts},v1=${firma}`, xRequestId: requestId, dataId, secret, toleranciaSegundos: 0 };

  assert.equal(firmaWebhookValida(datos), true);
  assert.equal(firmaWebhookValida({ ...datos, dataId: 'otro' }), false);
  assert.equal(firmaWebhookValida({ ...datos, xSignature: '' }), false);
});

test('la firma de webhook rechaza timestamps expirados para mitigar replay attacks', () => {
  const secret = 'secreto-webhook';
  const dataId = 'ABC123';
  const requestId = 'request-456';
  const ahoraSec = 1700000000;
  const tsValido = String(ahoraSec - 120); // 2 minutos atrás
  const tsExpirado = String(ahoraSec - 700); // casi 12 minutos atrás (excede 10m)

  const manValido = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${tsValido};`;
  const firmaValida = crypto.createHmac('sha256', secret).update(manValido).digest('hex');

  const manExpirado = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${tsExpirado};`;
  const firmaExpirada = crypto.createHmac('sha256', secret).update(manExpirado).digest('hex');

  assert.equal(firmaWebhookValida({
    xSignature: `ts=${tsValido},v1=${firmaValida}`,
    xRequestId: requestId,
    dataId,
    secret,
    toleranciaSegundos: 600,
    ahora: ahoraSec * 1000
  }), true);

  assert.equal(firmaWebhookValida({
    xSignature: `ts=${tsExpirado},v1=${firmaExpirada}`,
    xRequestId: requestId,
    dataId,
    secret,
    toleranciaSegundos: 600,
    ahora: ahoraSec * 1000
  }), false);
});

test('el webhook de pagos valida el external_reference con mongoose.isValidObjectId', () => {
  const fs = require('fs');
  const path = require('path');
  const codigo = fs.readFileSync(path.join(__dirname, '../routes/mercadoPagoWebhook.js'), 'utf8');
  assert.match(codigo, /mongoose\.isValidObjectId\(usuarioId\)/, 'falta validar formato de usuarioId');
  assert.match(codigo, /referencia_invalida/, 'no declara motivo cuando la referencia no es válida');
});

test('el webhook y billing garantizan 30 días de acceso cuando next_payment_date es nulo', () => {
  const fs = require('fs');
  const path = require('path');
  const codigoWebhook = fs.readFileSync(path.join(__dirname, '../routes/mercadoPagoWebhook.js'), 'utf8');
  const codigoBilling = fs.readFileSync(path.join(__dirname, '../routes/billing.js'), 'utf8');
  assert.match(codigoWebhook, /fallbackFin\s*=\s*new Date\(Date\.now\(\)\s*\+\s*30\s*\*\s*86400000\)/);
  assert.match(codigoBilling, /fallbackFin\s*=\s*new Date\(Date\.now\(\)\s*\+\s*30\s*\*\s*86400000\)/);
});

test('billing descarta enlaces de checkout pendientes que tengan más de 24 horas', () => {
  const fs = require('fs');
  const path = require('path');
  const codigoBilling = fs.readFileSync(path.join(__dirname, '../routes/billing.js'), 'utf8');
  assert.match(codigoBilling, /esReciente\s*=\s*msDesdeActualizacion\s*<\s*24\s*\*\s*3600000/);
});

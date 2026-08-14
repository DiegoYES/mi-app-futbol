const test = require('node:test');
const assert = require('node:assert/strict');
const {
  crearRegistradorEventosProducto,
  esEventoNavegador,
  esEventoProducto
} = require('../services/productEvents');
const { calcularTasas, parsearArgumentos, resumirLineas } = require('../scripts/resumirEventosProducto');

test('los eventos registran únicamente nombre, fecha y entorno', () => {
  const lineas = [];
  const registrar = crearRegistradorEventosProducto({
    escribir: linea => lineas.push(linea),
    ahora: () => new Date('2026-08-14T12:00:00.000Z'),
    entorno: 'staging'
  });

  assert.equal(registrar('landing_view'), true);
  const registro = JSON.parse(lineas[0].replace('[product-event] ', ''));
  assert.deepEqual(registro, {
    event: 'landing_view',
    at: '2026-08-14T12:00:00.000Z',
    environment: 'staging'
  });
});

test('rechaza eventos desconocidos y reserva los eventos sensibles al servidor', () => {
  const lineas = [];
  const registrar = crearRegistradorEventosProducto({ escribir: linea => lineas.push(linea) });

  assert.equal(esEventoProducto('evento_inventado'), false);
  assert.equal(esEventoNavegador('registration_active'), false);
  assert.equal(registrar('evento_inventado'), false);
  assert.equal(lineas.length, 0);
});

test('el resumidor ignora ruido, JSON inválido y otros entornos', () => {
  const contenido = [
    'mensaje normal',
    '[product-event] {incompleto',
    '[product-event] {"event":"landing_view","at":"x","environment":"production"}',
    '[product-event] {"event":"landing_view","at":"x","environment":"staging"}',
    '[product-event] {"event":"desconocido","at":"x","environment":"production"}'
  ].join('\n');

  const resumen = resumirLineas(contenido, { entorno: 'production' });
  assert.equal(resumen.total, 1);
  assert.equal(resumen.conteos.landing_view, 1);
});

test('calcula tasas agregadas incluyendo registros limitados', () => {
  const tasas = calcularTasas({
    landing_view: 100,
    trial_cta_click: 20,
    registration_active: 6,
    registration_ip_limited: 4,
    checkout_started: 2
  }, 50);

  assert.deepEqual(tasas, {
    landingACta: 20,
    ctaARegistro: 50,
    registrosActivos: 60,
    registroACheckout: 20,
    registros: 10,
    muestraSuficiente: true,
    muestraMinima: 50
  });
});

test('las tasas sin denominador son nulas y la muestra pequeña se advierte', () => {
  const tasas = calcularTasas({
    landing_view: 3,
    trial_cta_click: 0,
    registration_active: 0,
    registration_ip_limited: 0,
    checkout_started: 0
  }, 10);

  assert.equal(tasas.landingACta, 0);
  assert.equal(tasas.ctaARegistro, null);
  assert.equal(tasas.registrosActivos, null);
  assert.equal(tasas.registroACheckout, null);
  assert.equal(tasas.muestraSuficiente, false);
});

test('acepta una muestra mínima positiva y descarta valores inválidos', () => {
  assert.deepEqual(parsearArgumentos(['--environment', 'production', '--minimum-sample', '25']), {
    entorno: 'production',
    muestraMinima: 25
  });
  assert.equal(parsearArgumentos(['--minimum-sample', '0']).muestraMinima, 50);
  assert.equal(parsearArgumentos(['--minimum-sample', 'texto']).muestraMinima, 50);
});

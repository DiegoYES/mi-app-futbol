const test = require('node:test');
const assert = require('node:assert/strict');
const {
  crearRegistradorEventosProducto,
  esEventoNavegador,
  esEventoProducto
} = require('../services/productEvents');
const { resumirLineas } = require('../scripts/resumirEventosProducto');

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

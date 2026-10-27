const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Sugerencia = require('../models/Sugerencia');

const usuarioId = new mongoose.Types.ObjectId();

test('un ticket válido recibe estado y prioridad iniciales', () => {
  const ticket = new Sugerencia({
    usuario: usuarioId,
    tipo: 'idea',
    asunto: 'Agregar favoritos',
    descripcion: 'Me gustaría guardar equipos favoritos en mi perfil.'
  });

  assert.equal(ticket.validateSync(), undefined);
  assert.equal(ticket.estado, 'nueva');
  assert.equal(ticket.prioridad, 'media');
});

test('un ticket de tipo pago admite referencia_pago y evidencia_url', () => {
  const ticket = new Sugerencia({
    usuario: usuarioId,
    tipo: 'pago',
    asunto: 'Error al acreditar suscripción Mercado Pago',
    descripcion: 'Se realizó el cobro por 70 pesos en la tarjeta pero sigo como usuario gratuito.',
    referencia_pago: 'MP-892749104',
    evidencia_url: 'https://drive.google.com/file/d/comprobante123/view'
  });

  assert.equal(ticket.validateSync(), undefined);
  assert.equal(ticket.tipo, 'pago');
  assert.equal(ticket.referencia_pago, 'MP-892749104');
  assert.equal(ticket.evidencia_url, 'https://drive.google.com/file/d/comprobante123/view');
});

test('un ticket rechaza tipos y textos fuera de los límites', () => {
  const ticket = new Sugerencia({
    usuario: usuarioId,
    tipo: 'spam',
    asunto: 'No',
    descripcion: 'Muy corto'
  });
  const error = ticket.validateSync();

  assert.ok(error.errors.tipo);
  assert.ok(error.errors.asunto);
  assert.ok(error.errors.descripcion);
});

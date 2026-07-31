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

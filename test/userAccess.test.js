const test = require('node:test');
const assert = require('node:assert/strict');
const Usuario = require('../models/Usuario');

function usuario(datos = {}) {
  return new Usuario({
    email: 'persona@example.com',
    password: 'password-seguro',
    nombre: 'Persona',
    ...datos
  });
}

test('un usuario nuevo obtiene acceso de prueba', () => {
  const estado = usuario().estadoAcceso();

  assert.equal(estado.tieneAcceso, true);
  assert.equal(estado.motivo, 'prueba_activa');
  assert.ok(estado.diasRestantes >= 6);
});

test('un administrador conserva acceso sin fecha de vencimiento', () => {
  const estado = usuario({
    rol: 'admin',
    prueba_termina: new Date('2020-01-01')
  }).estadoAcceso();

  assert.equal(estado.tieneAcceso, true);
  assert.equal(estado.motivo, 'admin');
  assert.equal(estado.diasRestantes, null);
});

test('una cuenta vencida no obtiene acceso y nunca expone su contraseña', () => {
  const cuenta = usuario({
    prueba_termina: new Date('2020-01-01'),
    suscripcion_termina: new Date('2020-02-01')
  });
  const salida = cuenta.aJSON();

  assert.equal(salida.tieneAcceso, false);
  assert.equal(salida.plan, 'expirado');
  assert.equal('password' in salida, false);
});

test('una suscripción vigente prevalece sobre el límite de prueba por IP', () => {
  const estado = usuario({
    bloqueado_ip_duplicada: true,
    prueba_termina: new Date('2020-01-01'),
    suscripcion_termina: new Date(Date.now() + 30 * 86400000)
  }).estadoAcceso();

  assert.equal(estado.tieneAcceso, true);
  assert.equal(estado.motivo, 'suscripcion_activa');
  assert.equal(estado.plan, 'premium');
});

test('la IP duplicada continúa bloqueando una prueba gratuita', () => {
  const estado = usuario({ bloqueado_ip_duplicada: true }).estadoAcceso();

  assert.equal(estado.tieneAcceso, false);
  assert.equal(estado.motivo, 'ip_duplicada');
});

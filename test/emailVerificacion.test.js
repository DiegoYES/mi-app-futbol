const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Usuario = require('../models/Usuario');
const {
  generarHtmlVerificacion,
  generarTextoVerificacion,
  enviarEmailVerificacion
} = require('../services/mailer');

test('el modelo Usuario define email_verificado en false por defecto', () => {
  const usuario = new Usuario({
    email: 'nuevo@example.com',
    password: 'password-seguro-123',
    nombre: 'Nuevo Usuario'
  });

  assert.equal(usuario.email_verificado, false);
  assert.equal(usuario.fecha_verificacion_email, null);
  assert.equal(usuario.token_verificacion, null);
  assert.equal(usuario.token_verificacion_expira, null);
});

test('generarTokenVerificacion genera token criptográfico de 64 hex y almacena hash sha256', () => {
  const usuario = new Usuario({
    email: 'verificar@example.com',
    password: 'password-seguro-123'
  });

  const tokenPlano = usuario.generarTokenVerificacion();

  assert.equal(typeof tokenPlano, 'string');
  assert.equal(tokenPlano.length, 64);
  assert.match(tokenPlano, /^[a-f0-9]{64}$/);

  const hashEsperado = crypto.createHash('sha256').update(tokenPlano).digest('hex');
  assert.equal(usuario.token_verificacion, hashEsperado);
  assert.notEqual(usuario.token_verificacion, tokenPlano, 'el token no se almacena en plano');

  assert.ok(usuario.token_verificacion_expira instanceof Date);
  const horasRestantes = (usuario.token_verificacion_expira - Date.now()) / (1000 * 60 * 60);
  assert.ok(horasRestantes > 23.9 && horasRestantes <= 24);
});

test('hashearTokenVerificacion genera el mismo hash sha256 para validación', () => {
  const tokenPlano = crypto.randomBytes(32).toString('hex');
  const hash = Usuario.hashearTokenVerificacion(tokenPlano);

  assert.equal(hash, crypto.createHash('sha256').update(tokenPlano).digest('hex'));
  assert.equal(Usuario.hashearTokenVerificacion(null), null);
  assert.equal(Usuario.hashearTokenVerificacion(''), null);
});

test('aJSON y serialización excluyen tokens de verificación y exponen email_verificado', () => {
  const usuario = new Usuario({
    email: 'seguro@example.com',
    password: 'password-seguro-123',
    nombre: 'Usuario Seguro'
  });
  usuario.generarTokenVerificacion();

  const salida = usuario.aJSON();
  assert.equal(salida.email_verificado, false);
  assert.equal('token_verificacion' in salida, false);
  assert.equal('token_verificacion_expira' in salida, false);

  const jsonSerializado = usuario.toJSON();
  assert.equal('password' in jsonSerializado, false);
  assert.equal('token_verificacion' in jsonSerializado, false);
  assert.equal('token_verificacion_expira' in jsonSerializado, false);

  const objetoSerializado = usuario.toObject();
  assert.equal('password' in objetoSerializado, false);
  assert.equal('token_verificacion' in objetoSerializado, false);
  assert.equal('token_verificacion_expira' in objetoSerializado, false);
});

test('generarHtmlVerificacion incluye branding de Data-Fut, enlace seguro y advertencia de expiración', () => {
  const urlVerificacion = 'https://data-fut.com/verificar-email.html?token=abc123token';
  const html = generarHtmlVerificacion({ nombre: 'Diego <script>', urlVerificacion });

  assert.match(html, /DATA/);
  assert.match(html, /Diego &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /href="https:\/\/data-fut\.com\/verificar-email\.html\?token=abc123token"/);
  assert.match(html, /24 horas/);
  assert.match(html, /contacto@data-fut\.com/);
});

test('generarTextoVerificacion genera texto plano legible y seguro', () => {
  const urlVerificacion = 'https://data-fut.com/verificar-email.html?token=abc123token';
  const texto = generarTextoVerificacion({ nombre: 'Diego', urlVerificacion });

  assert.match(texto, /¡Hola, Diego!/);
  assert.match(texto, /https:\/\/data-fut\.com\/verificar-email\.html\?token=abc123token/);
  assert.match(texto, /24 horas/);
});

test('enviarEmailVerificacion tolera la ausencia de API key sin lanzar excepciones', async () => {
  const apiKeyOriginal = process.env.RESEND_API_KEY;
  try {
    delete process.env.RESEND_API_KEY;
    const resultado = await enviarEmailVerificacion({
      email: 'test@example.com',
      nombre: 'Prueba',
      token: '123'
    });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, 'resend_no_configurado');
  } finally {
    if (apiKeyOriginal) process.env.RESEND_API_KEY = apiKeyOriginal;
  }
});

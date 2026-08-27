const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET ||= 'secreto-de-pruebas-con-longitud-suficiente';

const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const { firmarToken, sesionCoincide } = require('../middleware/auth');
const {
  normalizarNombreCuenta,
  normalizarPerfilCuenta,
  validarPasswordNueva
} = require('../services/accountSettings');
const { crearAuditorSeguridad } = require('../services/securityAudit');

test('el nombre admite caracteres humanos y normaliza espacios sin aceptar HTML', () => {
  assert.equal(normalizarNombreCuenta("  María   O’Connor-Juárez 2  ").valor, "María O’Connor-Juárez 2");
  assert.equal(normalizarNombreCuenta('Ａna').valor, 'Ana');
  assert.match(normalizarNombreCuenta('<img src=x onerror=alert(1)>').error, /no permitidos/);
  assert.ok(normalizarNombreCuenta({ $ne: null }).error);
  assert.ok(normalizarNombreCuenta('A').error);
  assert.ok(normalizarNombreCuenta('A'.repeat(81)).error);
  assert.ok(normalizarNombreCuenta('Ana\u0000 Pérez').error);
});

test('el perfil usa una lista cerrada de campos y preferencias', () => {
  const valido = normalizarPerfilCuenta({
    nombre: 'Persona 7',
    preferencias: { formato_momio: 'americano' }
  });
  assert.deepEqual(valido.valor, {
    nombre: 'Persona 7',
    preferencias: { formato_momio: 'americano' }
  });
  assert.ok(normalizarPerfilCuenta({ nombre: 'Ana', preferencias: { formato_momio: 'ambos' }, rol: 'admin' }).error);
  assert.ok(normalizarPerfilCuenta({ $set: { rol: 'admin' } }).error);
  assert.ok(normalizarPerfilCuenta({ nombre: 'Ana', preferencias: { formato_momio: { $ne: null } } }).error);
  assert.ok(normalizarPerfilCuenta({ nombre: 'Ana', preferencias: { formato_momio: 'fraccionario' } }).error);
});

test('la contraseña respeta la frontera segura de bcrypt y evita datos personales', () => {
  assert.equal(validarPasswordNueva('frase extensa y única 2026').valor, 'frase extensa y única 2026');
  assert.ok(validarPasswordNueva('muy-corta-2026').error);
  assert.ok(validarPasswordNueva('administrador123').error);
  assert.ok(validarPasswordNueva('a'.repeat(73)).error);
  assert.ok(validarPasswordNueva('🔐'.repeat(19)).error, '19 emojis superan 72 bytes');
  assert.ok(validarPasswordNueva('frase segura\u0000extra').error);
  assert.ok(validarPasswordNueva('mi-cuenta-diego-2026', { email: 'diego@example.com' }).error);
  assert.ok(validarPasswordNueva('clave-maria-perez-2026', { nombre: 'María Pérez' }).error);
});

test('la versión de sesión permite invalidar tokens anteriores', () => {
  const usuario = { _id: '507f1f77bcf86cd799439011', rol: 'usuario', sesion_version: 3 };
  const payload = jwt.verify(firmarToken(usuario), process.env.JWT_SECRET);
  assert.equal(payload.sesion_version, 3);
  assert.equal(sesionCoincide(payload, usuario), true);
  assert.equal(sesionCoincide({ sesion_version: 2 }, usuario), false);
  assert.equal(sesionCoincide({}, { sesion_version: 0 }), true, 'los tokens previos a la migración siguen siendo válidos inicialmente');
});

test('la respuesta de cuenta expone preferencias pero no secretos de sesión', () => {
  const usuario = new Usuario({
    email: 'persona@example.com',
    password: 'secreto-que-no-sale',
    nombre: 'Persona',
    preferencias: { formato_momio: 'decimal' },
    sesion_version: 9
  });
  const salida = usuario.aJSON();
  assert.deepEqual(salida.preferencias, { formato_momio: 'decimal' });
  assert.equal('password' in salida, false);
  assert.equal('sesion_version' in salida, false);
});

test('la auditoría registra el evento sin correo, nombre, contraseña ni IP', () => {
  const lineas = [];
  const auditar = crearAuditorSeguridad({
    escribir: linea => lineas.push(linea),
    ahora: () => new Date('2026-08-21T12:00:00.000Z'),
    entorno: 'test'
  });
  const resultado = auditar('account_profile_updated', {
    requestId: 'req-segura-123',
    usuario: { _id: 'usuario-1', email: 'secreto@example.com', nombre: '<script>', password: 'nunca' },
    ip: '203.0.113.1'
  });
  assert.equal(resultado, true);
  assert.equal(lineas.length, 1);
  assert.match(lineas[0], /account_profile_updated/);
  assert.doesNotMatch(lineas[0], /secreto@example|<script>|nunca|203\.0\.113\.1/);
  assert.equal(auditar('evento-inventado', { usuario: { _id: 'usuario-1' } }), false);
});

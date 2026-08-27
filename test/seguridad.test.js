const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET ||= 'secreto-de-pruebas-con-longitud-suficiente';

const mongoose = require('mongoose');
// Sin conexión a Mongo, una consulta queda en cola 10 s por defecto. Aquí lo
// que se comprueba es que el fallo se resuelva en 404, no cuánto tarda.
mongoose.set('bufferTimeoutMS', 200);

const jwt = require('jsonwebtoken');
const { app } = require('../server');
const {
  escaparRegex,
  revisarConfiguracionSegura,
  textoDeConsulta
} = require('../middleware/security');
const { normalizarRuta } = require('../middleware/paginasPrivadas');

async function servidorTemporal(t) {
  const servidor = await new Promise(resolve => {
    const instancia = app.listen(0, '127.0.0.1', () => resolve(instancia));
  });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const { port } = servidor.address();
  return `http://127.0.0.1:${port}`;
}

test('el panel de administración no se sirve a visitantes anónimos', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/admin.html`);
  const cuerpo = await respuesta.text();

  assert.equal(respuesta.status, 404);
  assert.doesNotMatch(cuerpo, /Panel/i);
  assert.doesNotMatch(cuerpo, /cargarUsuarios/);
});

test('el panel de administración tampoco se filtra por variantes de la ruta', async t => {
  const baseUrl = await servidorTemporal(t);
  const variantes = ['/admin.html/', '//admin.html', '/./admin.html', '/%61dmin.html', '/ADMIN.HTML'];

  for (const ruta of variantes) {
    const respuesta = await fetch(`${baseUrl}${ruta}`, { redirect: 'manual' });
    assert.ok(
      respuesta.status >= 300,
      `${ruta} devolvió ${respuesta.status}; el panel no debe servirse`
    );
    const cuerpo = await respuesta.text();
    assert.doesNotMatch(cuerpo, /cargarUsuarios/, `${ruta} filtró el contenido del panel`);
  }
});

test('un token con rol de usuario no abre el panel de administración', async t => {
  const baseUrl = await servidorTemporal(t);
  // Firmado con el secreto real: el rol del token nunca sustituye al de la base.
  const token = jwt.sign({ id: '507f1f77bcf86cd799439011', rol: 'admin' }, process.env.JWT_SECRET);
  const respuesta = await fetch(`${baseUrl}/admin.html`, { headers: { cookie: `token=${token}` } });

  assert.equal(respuesta.status, 404);
});

test('la API de administración exige sesión', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/api/admin/usuarios`);
  const cuerpo = await respuesta.json();

  assert.equal(respuesta.status, 401);
  assert.equal(cuerpo.codigo, 'SIN_TOKEN');
});

test('la configuración de cuenta no se sirve a visitantes anónimos', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/configuracion.html`);
  const cuerpo = await respuesta.text();

  assert.equal(respuesta.status, 404);
  assert.doesNotMatch(cuerpo, /Cambiar contraseña/);
});

test('los cambios de cuenta exigen sesión y rechazan orígenes externos', async t => {
  const baseUrl = await servidorTemporal(t);
  const solicitudes = [
    ['/api/auth/perfil', 'PATCH', { nombre: 'Persona', preferencias: { formato_momio: 'ambos' } }],
    ['/api/auth/cambiar-password', 'POST', { password_actual: 'x', password_nueva: 'frase extensa de ejemplo' }],
    ['/api/auth/revocar-sesiones', 'POST', undefined]
  ];

  for (const [ruta, method, body] of solicitudes) {
    const respuesta = await fetch(`${baseUrl}${ruta}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    assert.equal(respuesta.status, 401, ruta);
  }

  const externa = await fetch(`${baseUrl}/api/auth/perfil`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: 'https://sitio-atacante.example' },
    body: JSON.stringify({ nombre: 'Persona', preferencias: { formato_momio: 'ambos' } })
  });
  assert.equal(externa.status, 403);
  assert.equal((await externa.json()).codigo, 'ORIGEN_NO_PERMITIDO');
});

test('la configuración pinta datos del servidor sólo con textContent o value', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'configuracion.html'), 'utf8');
  assert.doesNotMatch(codigo, /\.innerHTML\s*=/);
  assert.match(codigo, /cuenta-nombre'\)\.textContent/);
  assert.match(codigo, /config-nombre'\)\.value/);
});

test('normalizarRuta neutraliza codificaciones y recorridos', () => {
  assert.equal(normalizarRuta('/admin.html'), '/admin.html');
  assert.equal(normalizarRuta('//admin.html'), '/admin.html');
  assert.equal(normalizarRuta('/./admin.html'), '/admin.html');
  assert.equal(normalizarRuta('/%61dmin.html'), '/admin.html');
  assert.equal(normalizarRuta('/publico/../admin.html'), '/admin.html');
  assert.equal(normalizarRuta('/admin.html?x=1'), '/admin.html');
  assert.equal(normalizarRuta('/ADMIN.HTML'), '/admin.html');
  assert.equal(normalizarRuta('/%ZZ'), null);
  assert.equal(normalizarRuta('/admin.html%00.txt'), null);
});

test('escaparRegex anula los metacaracteres de una búsqueda', () => {
  const patron = escaparRegex('(a+)+$');
  assert.equal(patron, '\\(a\\+\\)\\+\\$');
  assert.ok(new RegExp(patron).test('(a+)+$'));
  assert.ok(!new RegExp(patron).test('aaaa'));
});

test('textoDeConsulta tolera arreglos, objetos y textos larguísimos', () => {
  assert.equal(textoDeConsulta(['uno', 'dos']), 'dos');
  assert.equal(textoDeConsulta({ $ne: null }), '');
  assert.equal(textoDeConsulta(undefined), '');
  assert.equal(textoDeConsulta('  hola  '), 'hola');
  assert.equal(textoDeConsulta('x'.repeat(500)).length, 80);
  assert.equal(textoDeConsulta('x'.repeat(500), 10).length, 10);
});

test('revisarConfiguracionSegura alerta de una puesta en producción insegura', () => {
  const avisos = revisarConfiguracionSegura({ NODE_ENV: 'production' });
  assert.equal(avisos.length, 2);
  assert.ok(avisos.some(aviso => /TRUST_PROXY/.test(aviso)));
  assert.ok(avisos.some(aviso => /APP_ORIGIN/.test(aviso)));

  const seguro = revisarConfiguracionSegura({
    NODE_ENV: 'production',
    TRUST_PROXY: '1',
    APP_ORIGIN: 'https://futbol.example.com'
  });
  assert.deepEqual(seguro, []);

  assert.ok(revisarConfiguracionSegura({}).some(aviso => /NODE_ENV/.test(aviso)));
});

test('ninguna ruta devuelve el mensaje interno de error al cliente', () => {
  const archivos = ['server.js', 'routes/admin.js', 'routes/boletas.js', 'routes/calendario.js',
    'routes/home.js', 'routes/jugadores.js', 'routes/picks.js', 'routes/auth.js'];

  for (const archivo of archivos) {
    const codigo = fs.readFileSync(path.join(__dirname, '..', archivo), 'utf8');
    assert.doesNotMatch(codigo, /error:\s*error\.message/, `${archivo} filtra error.message`);
  }
});

test('el frontend escapa los nombres de equipo del aviso de correlación', () => {
  const codigo = ['app.js', 'app-picks.js'].map(archivo => fs.readFileSync(path.join(__dirname, '..', 'public', archivo), 'utf8')).join(String.fromCharCode(10));
  const linea = codigo.split('\n').find(item => item.includes('bet-slip-correlation') === false
    && item.includes('Atención a la correlación'));

  assert.ok(linea, 'no se encontró el render del aviso de correlación');
  assert.match(linea, /escaparHtml\(aviso\)/);
});

test('las búsquedas con $regex sólo usan patrones escapados', () => {
  for (const archivo of ['routes/admin.js', 'routes/jugadores.js']) {
    const codigo = fs.readFileSync(path.join(__dirname, '..', archivo), 'utf8');
    const usos = codigo.match(/\$regex:\s*([A-Za-z_$][\w$.]*)/g) || [];
    assert.ok(usos.length > 0, `${archivo} debería seguir teniendo búsquedas por regex`);
    for (const uso of usos) {
      assert.doesNotMatch(uso, /\$regex:\s*(busqueda|q)\b/, `${archivo} usa el texto crudo en ${uso}`);
    }
  }
});

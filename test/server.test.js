const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET ||= 'secreto-de-pruebas-con-longitud-suficiente';
const { app } = require('../server');

async function servidorTemporal(t) {
  const servidor = await new Promise(resolve => {
    const instancia = app.listen(0, '127.0.0.1', () => resolve(instancia));
  });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const { port } = servidor.address();
  return `http://127.0.0.1:${port}`;
}

test('la página de acceso es pública', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/login.html`);
  const html = await respuesta.text();

  assert.equal(respuesta.status, 200);
  assert.match(html, /Iniciar sesión/);
});

test('index.html muestra la portada y el comparador conserva su propia ruta', async t => {
  const baseUrl = await servidorTemporal(t);
  const [inicio, comparador] = await Promise.all([
    fetch(`${baseUrl}/index.html`).then(respuesta => respuesta.text()),
    fetch(`${baseUrl}/comparador.html`).then(respuesta => respuesta.text())
  ]);

  assert.match(inicio, /Encuentra el partido/);
  assert.doesNotMatch(inicio, /Selecciona el local/);
  assert.match(comparador, /Selecciona el local/);
});

test('las ligas requieren una sesión', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/api/ligas`);
  const body = await respuesta.json();

  assert.equal(respuesta.status, 401);
  assert.equal(body.codigo, 'SIN_TOKEN');
});

test('las estadísticas también se protegen antes de consultar la base', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/api/equipos/42/estadisticas-detalladas?league=39`);
  const body = await respuesta.json();

  assert.equal(respuesta.status, 401);
  assert.equal(body.codigo, 'SIN_TOKEN');
});

test('el historial personal de picks requiere una sesión', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/api/picks/seguimiento`);
  const body = await respuesta.json();

  assert.equal(respuesta.status, 401);
  assert.equal(body.codigo, 'SIN_TOKEN');
});

test('las boletas guardadas requieren una sesión', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/api/boletas`);
  const body = await respuesta.json();

  assert.equal(respuesta.status, 401);
  assert.equal(body.codigo, 'SIN_TOKEN');
});

test('el resumen de inicio requiere una sesión', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/api/home/resumen`);
  const body = await respuesta.json();

  assert.equal(respuesta.status, 401);
  assert.equal(body.codigo, 'SIN_TOKEN');
});

test('el buzón de sugerencias requiere una sesión', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/api/sugerencias`);
  const body = await respuesta.json();

  assert.equal(respuesta.status, 401);
  assert.equal(body.codigo, 'SIN_TOKEN');
});

test('el directorio de jugadores requiere una sesión', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/api/jugadores`);
  const body = await respuesta.json();

  assert.equal(respuesta.status, 401);
  assert.equal(body.codigo, 'SIN_TOKEN');
});

test('la actualización de mercados nunca queda expuesta sin sesión administrativa', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/api/admin/mercados/actualizar`, { method: 'POST' });
  const body = await respuesta.json();

  assert.equal(respuesta.status, 401);
  assert.equal(body.codigo, 'SIN_TOKEN');
});

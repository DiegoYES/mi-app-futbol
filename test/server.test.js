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

test('expone salud y cabeceras seguras sin revelar Express', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/health/live`);
  const body = await respuesta.json();

  assert.equal(respuesta.status, 200);
  assert.equal(body.estado, 'ok');
  assert.equal(respuesta.headers.get('x-powered-by'), null);
  assert.equal(respuesta.headers.get('x-content-type-options'), 'nosniff');
  assert.match(respuesta.headers.get('content-security-policy'), /default-src 'self'/);
  assert.ok(respuesta.headers.get('x-request-id'));
});

test('rechaza escrituras web desde un origen ajeno', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { origin: 'https://sitio-malicioso.example' }
  });
  const body = await respuesta.json();

  assert.equal(respuesta.status, 403);
  assert.equal(body.codigo, 'ORIGEN_NO_PERMITIDO');
});

test('acepta escrituras del mismo host cuando un proxy termina HTTPS', async t => {
  const baseUrl = await servidorTemporal(t);
  const url = new URL(baseUrl);
  const respuesta = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { origin: `https://${url.host}` }
  });
  const body = await respuesta.json();

  // Superó la validación de origen y llegó al controlador de cierre de sesión.
  assert.equal(respuesta.status, 200);
  assert.equal(body.mensaje, 'Sesión cerrada');
});

test('rechaza cuerpos JSON demasiado grandes con una respuesta controlada', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(40_000) })
  });
  const body = await respuesta.json();

  assert.equal(respuesta.status, 413);
  assert.equal(body.codigo, 'BODY_MUY_GRANDE');
});

test('index.html muestra la landing pública y el comparador conserva su propia ruta', async t => {
  const baseUrl = await servidorTemporal(t);
  const [inicio, comparador] = await Promise.all([
    fetch(`${baseUrl}/index.html`).then(respuesta => respuesta.text()),
    fetch(`${baseUrl}/comparador.html`).then(respuesta => respuesta.text())
  ]);

  assert.match(inicio, /Todo el contexto del partido/);
  assert.match(inicio, /\$70/);
  assert.match(inicio, /Ya tengo cuenta · Iniciar sesión/);
  assert.match(inicio, /¿Ya eres miembro\? Inicia sesión/);
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

const test = require('node:test');
const assert = require('node:assert');
const {
  BANNER_ID,
  esStaging,
  inyectarBanner,
  crearEnviadorHtml,
  bannerEstatico
} = require('../middleware/entornoBanner');

test('esStaging sólo se activa con APP_ENVIRONMENT=staging', () => {
  assert.strictEqual(esStaging({ APP_ENVIRONMENT: 'staging' }), true);
  assert.strictEqual(esStaging({ APP_ENVIRONMENT: ' Staging ' }), true);
  assert.strictEqual(esStaging({ APP_ENVIRONMENT: 'production' }), false);
  assert.strictEqual(esStaging({ APP_ENVIRONMENT: '' }), false);
  assert.strictEqual(esStaging({}), false);
});

test('inyectarBanner añade el aviso tras <body> una sola vez', () => {
  const html = '<html><body class="x"><h1>Hola</h1></body></html>';
  const conBanner = inyectarBanner(html);
  assert.ok(conBanner.includes(`id="${BANNER_ID}"`));
  assert.ok(conBanner.includes('ENTORNO DE PRUEBA'));
  assert.ok(conBanner.indexOf('<h1>') > conBanner.indexOf(BANNER_ID), 'el banner precede al contenido');
  const repetido = inyectarBanner(conBanner);
  const apariciones = repetido.split(BANNER_ID).length - 1;
  assert.strictEqual(apariciones, 1, 'no debe duplicarse');
});

test('inyectarBanner no altera contenido sin <body>', () => {
  assert.strictEqual(inyectarBanner('{"json":true}'), '{"json":true}');
  assert.strictEqual(inyectarBanner(null), null);
});

test('en producción enviarHtml usa sendFile sin modificar la página', () => {
  const enviarHtml = crearEnviadorHtml('/tmp/public', { APP_ENVIRONMENT: 'production' });
  let enviado = null;
  const res = { sendFile: (ruta) => { enviado = ruta; } };
  enviarHtml(res, 'inicio.html');
  assert.ok(enviado.endsWith('inicio.html'), 'debe delegar en sendFile');
});

test('sin APP_ENVIRONMENT el banner tampoco aparece', () => {
  const enviarHtml = crearEnviadorHtml('/tmp/public', {});
  let enviado = null;
  const res = { sendFile: (ruta) => { enviado = ruta; } };
  enviarHtml(res, 'inicio.html');
  assert.ok(enviado, 'debe delegar en sendFile sin inyección');
});

test('en staging enviarHtml inyecta el banner en el HTML servido', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banner-'));
  fs.writeFileSync(path.join(dir, 'inicio.html'), '<html><body><p>portada</p></body></html>');
  const enviarHtml = crearEnviadorHtml(dir, { APP_ENVIRONMENT: 'staging' });
  const html = await new Promise((resolve) => {
    const res = {
      type: () => res,
      send: (cuerpo) => resolve(cuerpo),
      status: () => res,
      end: () => resolve(null)
    };
    enviarHtml(res, 'inicio.html');
  });
  assert.ok(html.includes('ENTORNO DE PRUEBA'));
  assert.ok(html.includes('<p>portada</p>'));
  fs.rmSync(path.join(dir, 'inicio.html'));
  fs.rmdirSync(dir);
});

test('bannerEstatico es passthrough puro en producción', async () => {
  const mw = bannerEstatico('/tmp/public', { APP_ENVIRONMENT: 'production' });
  let siguiente = false;
  mw({ method: 'GET', path: '/calendario.html' }, {}, () => { siguiente = true; });
  assert.strictEqual(siguiente, true);
});

test('bannerEstatico en staging ignora rutas que no son .html y traversal', async () => {
  const mw = bannerEstatico('/tmp/public', { APP_ENVIRONMENT: 'staging' });
  for (const ruta of ['/api/picks', '/../etc/passwd.html', '/%zz.html']) {
    let siguiente = false;
    mw({ method: 'GET', path: ruta }, {}, () => { siguiente = true; });
    assert.strictEqual(siguiente, true, `debe pasar de largo: ${ruta}`);
  }
});

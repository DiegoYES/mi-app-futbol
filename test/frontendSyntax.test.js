const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const paginas = [
  'index.html', 'inicio.html', 'login.html', 'admin.html', 'calendario.html',
  'partido.html', 'picks.html', 'boletas.html', 'equipos.html', 'equipo.html', 'jugadores.html',
  'competiciones.html', 'competicion.html', 'jugador.html', 'arbitros.html'
];

for (const pagina of paginas) {
  test(`${pagina} contiene JavaScript inline válido`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', pagina), 'utf8');
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .map(coincidencia => coincidencia[1])
      .filter(codigo => codigo.trim());

    assert.ok(scripts.length > 0 || /<script\s+src=/.test(html));
    for (const codigo of scripts) {
      assert.doesNotThrow(() => new Function(codigo));
    }
  });
}

test('app.js contiene JavaScript válido', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.doesNotThrow(() => new Function(codigo));
});

test('auth-client.js contiene JavaScript válido y monta Mis picks globales', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'auth-client.js'), 'utf8');
  assert.doesNotThrow(() => new Function(codigo));
  assert.match(codigo, /global-picks-widget/);
  assert.match(codigo, /futbol:picks-actualizados/);
});

test('los enfrentamientos del centro de partido exponen detalles desplegables', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'partido.html'), 'utf8');
  assert.match(html, /data-h2h-details/);
  assert.match(html, /alternarDetalleH2H/);
  assert.match(html, /Ver estadísticas/);
});

test('el directorio de competiciones agrupa temporadas y permite elegirlas', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'competiciones.html'), 'utf8');
  assert.match(html, /data-competition-season/);
  assert.match(html, /temporadas\.map/);
  assert.match(html, /ligas\/torneos únicos/);
});

test('user-library.js contiene JavaScript válido', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-library.js'), 'utf8');
  assert.doesNotThrow(() => new Function(codigo));
});

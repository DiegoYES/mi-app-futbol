const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const paginas = [
  'index.html', 'inicio.html', 'login.html', 'admin.html', 'calendario.html',
  'partido.html', 'picks.html', 'boletas.html', 'equipos.html', 'equipo.html', 'jugadores.html',
  'competiciones.html', 'competicion.html', 'jugador.html', 'arbitros.html', 'sugerencias.html'
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
  assert.match(html, /normalizarCatalogo/);
});

test('el directorio de equipos selecciona ligas y delega la temporada a la ficha', () => {
  const directorio = fs.readFileSync(path.join(__dirname, '..', 'public', 'equipos.html'), 'utf8');
  const ficha = fs.readFileSync(path.join(__dirname, '..', 'public', 'equipo.html'), 'utf8');
  assert.match(directorio, /allSeasons=true/);
  assert.doesNotMatch(directorio, /value="\$\{c\.id\}:\$\{c\.temporada\}"/);
  assert.match(ficha, /id="season"/);
  assert.match(ficha, /Menos de 2\.5 goles/);
  assert.match(ficha, /Producción por partido/);
  assert.match(ficha, /recent-opponent/);
});

test('user-library.js contiene JavaScript válido', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-library.js'), 'utf8');
  assert.doesNotThrow(() => new Function(codigo));
});

test('el directorio de jugadores separa competición y temporada', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'jugadores.html'), 'utf8');
  assert.match(html, /id="liga"/);
  assert.match(html, /id="temporada"/);
  assert.match(html, /pintarTemporadas/);
  assert.match(html, /&season=\$\{season\}/);
  assert.doesNotMatch(html, /const \[league,season\]=valor\.split/);
});

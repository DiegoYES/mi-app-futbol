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

test('user-library.js contiene JavaScript válido', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-library.js'), 'utf8');
  assert.doesNotThrow(() => new Function(codigo));
});

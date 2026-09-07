const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const raiz = path.join(__dirname, '..', '..', 'public');
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const servidor = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];
  let relativo = pathname;
  if (pathname === '/' || pathname === '/comparador.html') relativo = 'index.html';

  const archivo = path.join(raiz, relativo);
  if (!archivo.startsWith(raiz) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': tipos[path.extname(archivo)] || 'application/octet-stream' });
  fs.createReadStream(archivo).pipe(res);
});

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

(async () => {
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const navegador = await chromium.launch({ headless: true });
  const pagina = await navegador.newPage();

  let intentoEquipoA = 0;

  await pagina.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/ligas') {
      return json(route, [
        { id: 78, nombre: 'Bundesliga', pais: 'Alemania', temporada: 2026, temporada_analisis: 2026, disponible: true, temporadas_analisis: [{ temporada: 2026, finalizados: 10 }] },
        { id: 140, nombre: 'La Liga', pais: 'España', temporada: 2026, temporada_analisis: 2026, disponible: true, temporadas_analisis: [{ temporada: 2026, finalizados: 10 }] }
      ]);
    }
    if (url.pathname === '/api/ligas/78/equipos') {
      intentoEquipoA++;
      // Simula fallo 429 en el primer intento y éxito en el segundo
      if (intentoEquipoA === 1) {
        return route.fulfill({ status: 429, headers: { 'Retry-After': '0' }, contentType: 'application/json', body: JSON.stringify({ error: 'Rate limit' }) });
      }
      return json(route, [{ id: 165, nombre: 'Borussia Dortmund' }]);
    }
    if (url.pathname === '/api/ligas/140/equipos') {
      return json(route, [{ id: 533, nombre: 'Villarreal' }]);
    }
    if (/^\/api\/equipos\/\d+\/estadisticas-detalladas$/.test(url.pathname)) {
      return json(route, {
        info: { equipo: 'Equipo', periodo: 'Partido completo', cobertura: { partidos: 5, estadisticas: 5 } },
        stats: { jugados: 5, golesFavor: 8, golesContra: 4 }
      });
    }
    if (url.pathname.includes('/escudo')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    return json(route, { usuario: { id: 1, nombre: 'QA', rol: 'admin', tieneAcceso: true } });
  });

  // Cargar comparador con local=165 y visitante=533
  await pagina.goto(`${base}/comparador.html?local=165&leagueLocal=78&visitante=533&leagueVisitante=140`);

  // Esperar a que los selectores se pueblen tras el reintento de 429
  await pagina.waitForSelector('#team-a option[value="165"]', { state: 'attached', timeout: 8000 });
  await pagina.waitForSelector('#team-b option[value="533"]', { state: 'attached', timeout: 8000 });

  // Esperar a que el valor se seleccione
  await pagina.waitForFunction(() => {
    return document.getElementById('team-a')?.value === '165' && document.getElementById('team-b')?.value === '533';
  }, { timeout: 8000 });

  const valorA = await pagina.$eval('#team-a', el => el.value);
  const valorB = await pagina.$eval('#team-b', el => el.value);

  assert.equal(valorA, '165', 'El equipo A debe haberse seleccionado tras superar el 429 con backoff');
  assert.equal(valorB, '533', 'El equipo B debe haberse seleccionado correctamente');

  // Verificar que la URL actual en el navegador conserva ambos parámetros y no dropeó local=165
  const urlActual = pagina.url();
  assert.match(urlActual, /local=165/, 'La URL debe conservar local=165');
  assert.match(urlActual, /leagueLocal=78/, 'La URL debe conservar leagueLocal=78');
  assert.match(urlActual, /visitante=533/, 'La URL debe conservar visitante=533');
  assert.match(urlActual, /leagueVisitante=140/, 'La URL debe conservar leagueVisitante=140');

  // Ahora probamos el segundo caso: fallo 429 permanente en un lado
  // La URL NO debe perder el parámetro a pesar del fallo
  const pagina2 = await navegador.newPage();
  await pagina2.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/ligas') {
      return json(route, [
        { id: 78, nombre: 'Bundesliga', pais: 'Alemania', temporada: 2026, temporada_analisis: 2026, disponible: true }
      ]);
    }
    if (url.pathname === '/api/ligas/78/equipos') {
      // 429 sostenido
      return route.fulfill({ status: 429, headers: { 'Retry-After': '0' }, contentType: 'application/json', body: JSON.stringify({ error: 'Rate limit' }) });
    }
    return json(route, { usuario: { id: 1, tieneAcceso: true } });
  });

  await pagina2.goto(`${base}/comparador.html?local=165&leagueLocal=78`);
  await pagina2.waitForTimeout(2000);

  const urlTrasFallo = pagina2.url();
  assert.match(urlTrasFallo, /local=165/, 'La URL debe seguir conservando local=165 ante fallo transitorio/rate limit');

  await navegador.close();
  servidor.close();
  console.log('Playwright: resiliencia a 429 y preservación de URL en comparador verificadas exitosamente.');
})().catch(err => {
  servidor.close();
  console.error(err);
  process.exitCode = 1;
});

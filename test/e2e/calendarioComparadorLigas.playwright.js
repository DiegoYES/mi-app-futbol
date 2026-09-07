const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const raiz = path.join(__dirname, '..', '..', 'public');
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const partidoChampions = {
  api_id: 1635609,
  fecha: '2026-09-08T16:45:00.000Z',
  estado: 'NS',
  finalizado: false,
  local: { id: 575, nombre: 'AEK Athens FC', goles: null, liga_id: 197 },
  visitante: { id: 1026, nombre: 'Lask Linz', goles: null, liga_id: 218 }
};

const servidor = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];
  let relativo = pathname;
  if (pathname === '/') relativo = 'calendario.html';
  else if (pathname === '/comparador.html') relativo = 'index.html';

  const archivo = path.join(raiz, relativo);
  if (!archivo.startsWith(raiz) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': tipos[path.extname(archivo)] || 'application/octet-stream' });
  fs.createReadStream(archivo).pipe(res);
});

async function json(route, body) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

(async () => {
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const navegador = await chromium.launch({ headless: true });
  const pagina = await navegador.newPage();

  const cspErrors = [];
  pagina.on('console', msg => {
    if (msg.text().includes('violates the following Content Security Policy')) {
      cspErrors.push(msg.text());
    }
  });

  await pagina.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/calendario/proximos') {
      return json(route, {
        catalogo: [],
        jornadas: [{
          fecha: '2026-09-08',
          total: 1,
          competiciones: [{
            liga_id: 2,
            liga: 'UEFA Champions League',
            pais: 'Europa',
            partidos: [partidoChampions]
          }]
        }]
      });
    }
    if (url.pathname === '/api/calendario/picks') return json(route, { por_partido: {}, mejores: [] });
    if (url.pathname === '/api/ligas') {
      return json(route, [
        { id: 197, nombre: 'Super League 1', pais: 'Grecia', temporada: 2026, temporada_analisis: 2026, disponible: true, temporadas_analisis: [{ temporada: 2026, finalizados: 3 }] },
        { id: 218, nombre: 'Bundesliga Austria', pais: 'Austria', temporada: 2026, temporada_analisis: 2026, disponible: true, temporadas_analisis: [{ temporada: 2026, finalizados: 5 }] }
      ]);
    }
    if (url.pathname === '/api/ligas/197/equipos') return json(route, [{ id: 575, nombre: 'AEK Athens FC' }]);
    if (url.pathname === '/api/ligas/218/equipos') return json(route, [{ id: 1026, nombre: 'Lask Linz' }]);
    if (/^\/api\/equipos\/\d+\/estadisticas-detalladas$/.test(url.pathname)) {
      return json(route, {
        info: { equipo: 'Equipo', periodo: 'Partido completo', cobertura: { partidos: 2, estadisticas: 2 } },
        stats: { jugados: 2 }
      });
    }
    if (url.pathname.includes('/escudo')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    return json(route, { usuario: { id: 1, nombre: 'QA', rol: 'admin', tieneAcceso: true } });
  });

  await pagina.goto(`${base}/calendario.html?fecha=2026-09-08`);

  const botonComparar = pagina.locator('.btn-quick-compare');
  await botonComparar.waitFor();
  const href = await botonComparar.getAttribute('href');

  // Verifica que el href apunte a las ligas domésticas resueltas (197 y 218) y no a la Champions (2)
  assert.equal(href, '/comparador.html?local=575&leagueLocal=197&visitante=1026&leagueVisitante=218');

  // Al hacer clic en el botón comparar no debe haber errores de CSP ni redirigir a partido.html
  await Promise.all([
    pagina.waitForURL(/comparador\.html/),
    botonComparar.click()
  ]);

  assert.match(pagina.url(), /leagueLocal=197/);
  assert.match(pagina.url(), /leagueVisitante=218/);
  assert.equal(cspErrors.length, 0, `No debe haber errores de CSP: ${cspErrors.join(', ')}`);

  // Regresar al calendario y verificar que hacer clic en la tarjeta fuera del botón navega a partido.html
  await pagina.goto(`${base}/calendario.html?fecha=2026-09-08`);
  const nombreEquipo = pagina.locator('.equipo span').first();
  await Promise.all([
    pagina.waitForURL(/partido\.html/),
    nombreEquipo.click()
  ]);
  assert.match(pagina.url(), /partido\.html\?local=575&visitante=1026&liga=2/);

  await navegador.close();
  servidor.close();
  console.log('Playwright: validación de botón rápido de comparador y ligas domésticas exitosa.');
})().catch(error => {
  servidor.close();
  console.error(error);
  process.exitCode = 1;
});

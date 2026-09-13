const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const publicDir = path.join(__dirname, '..', '..', 'public');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];
  const pathname = reqPath === '/' ? '/inicio.html' : reqPath;
  const file = path.join(publicDir, pathname);
  if (!file.startsWith(publicDir) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  // Mock APIs
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ usuario: { id: 1, nombre: 'Diego', rol: 'admin' }, tieneAcceso: true })
      });
    }
    if (url.pathname === '/api/home/resumen') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ con_estadisticas: 100, competiciones: 10, temporadas_guardadas: 5, jugadores: 50, picks: 20 })
      });
    }
    if (url.pathname === '/api/home/equipos') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ equipos: [] })
      });
    }
    if (url.pathname === '/api/recomendaciones') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ activas: [], historial: [], resumen: {} })
      });
    }
    if (url.pathname === '/api/calendario/rango') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ desde: '2026-09-01', hasta: '2026-09-30' })
      });
    }
    if (url.pathname === '/api/calendario/dia') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: 2,
          competiciones: [
            {
              liga_id: 140,
              liga: 'La Liga',
              partidos: [{
                api_id: 101,
                hora: '14:00',
                local: { id: 1, nombre: 'Real Madrid' },
                visitante: { id: 2, nombre: 'Barcelona' },
                finalizado: false
              }]
            },
            {
              liga_id: 39,
              liga: 'Premier League',
              partidos: [{
                api_id: 102,
                hora: '16:00',
                local: { id: 3, nombre: 'Arsenal' },
                visitante: { id: 4, nombre: 'Chelsea' },
                finalizado: false
              }]
            }
          ]
        })
      });
    }
    if (url.pathname.startsWith('/api/picks/partido/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          categorias: ['goles'],
          recomendados: ['m1'],
          mercados: [
            { id: 'm1', categoria: 'goles', mercado: 'Más de 1.5 goles', estimacion: 85, muestra: 10, confianza: 'alta' }
          ]
        })
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.goto(`http://127.0.0.1:${port}/inicio.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#radar-carousel-track .radar-carousel-item');

  // Caso 1: Arriba del todo (scrollY = 0)
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const scrollYInicial = await page.evaluate(() => window.scrollY);
  assert.equal(scrollYInicial, 0, 'La página debe iniciar con scrollY = 0');

  await page.evaluate(() => { rotarSiguienteLiga(); });
  await page.waitForTimeout(500);

  const scrollYPosterior = await page.evaluate(() => window.scrollY);
  assert.equal(scrollYPosterior, 0, `El scroll no debió moverse de arriba (actual: ${scrollYPosterior}px)`);

  // Caso 2: A mitad de página viendo hero o búsqueda (scrollY = 200)
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(200);

  await page.evaluate(() => { rotarSiguienteLiga(); });
  await page.waitForTimeout(500);

  const scrollYMitad = await page.evaluate(() => window.scrollY);
  assert.equal(scrollYMitad, 200, `El scroll de la página debió permanecer en 200px (actual: ${scrollYMitad}px)`);

  await browser.close();
  server.close();
  console.log('Test completado: scroll vertical intacto en todas las posiciones al rotar liga.');
})().catch(err => {
  console.error('ERROR EN TEST:', err.message);
  server.close();
  process.exit(1);
});

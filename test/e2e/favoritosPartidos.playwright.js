const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const raiz = path.join(__dirname, '..', '..', 'public');
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const partido = { api_id: 9001, fecha: '2026-08-08T18:00:00.000Z', estado: 'NS', finalizado: false, local: { id: 10, nombre: 'Local', goles: null }, visitante: { id: 20, nombre: 'Visitante', goles: null } };

const servidor = http.createServer((req, res) => {
  const archivo = path.join(raiz, req.url.split('?')[0] === '/' ? 'inicio.html' : req.url.split('?')[0]);
  if (!archivo.startsWith(raiz) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': tipos[path.extname(archivo)] || 'application/octet-stream' });
  fs.createReadStream(archivo).pipe(res);
});

async function json(route, body) { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); }

(async () => {
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const navegador = await chromium.launch({ headless: true });
  const pagina = await navegador.newPage();
  await pagina.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/calendario/proximos') return json(route, { catalogo: [], jornadas: [{ fecha: '2026-08-08', total: 1, competiciones: [{ liga_id: 39, liga: 'Liga', pais: 'País', partidos: [partido] }] }] });
    if (url.pathname === '/api/calendario/picks') return json(route, { por_partido: {}, mejores: [] });
    if (url.pathname.includes('/estadisticas-detalladas')) return json(route, { info: { equipo: 'Local', liga: 'Liga', temporada: 2026, temporada_etiqueta: '2026', periodo: 'partido completo', cobertura: { estadisticas: 1, partidos: 1 } }, stats: { avanzadas: {}, jugados: 1, ganados: 1, empatados: 0, perdidos: 0, golesFavor: 2, golesContra: 0, over05: {}, over15: {}, over25: {}, over35: {}, under15: {}, under25: {}, under35: {}, btts: {}, equipoOver15: {}, rivalOver15: {} }, local: { jugados: 1, ganados: 1, empatados: 0, perdidos: 0 }, visitante: { jugados: 0, ganados: 0, empatados: 0, perdidos: 0 }, partidos: [{ id: 9001, fecha: partido.fecha, liga_id: 39, local_id: 10, visitante_id: 20, rival: 'Visitante', ubicacion: 'local', marcador: '2-0', resultado: 'V' }] });
    if (url.pathname.endsWith('/historial')) return json(route, { temporadas: [{ temporada: 2026, etiqueta: '2026', posicion: 1, equipos: 2, jugados: 1, ganados: 1, empatados: 0, perdidos: 0, goles_favor: 2, goles_contra: 0, diferencia: 2, puntos: 3 }] });
    if (url.pathname === '/api/jugadores') return json(route, { jugadores: [], jornadas: [] });
    if (url.pathname.includes('/escudo')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    return json(route, { usuario: { id: 1, nombre: 'QA', rol: 'admin', tieneAcceso: true } });
  });

  await pagina.goto(`${base}/calendario.html?fecha=2026-08-08`);
  await pagina.locator('[data-favorite-match="9001"]').click();
  assert.equal(await pagina.locator('[data-favorite-match="9001"]').getAttribute('aria-pressed'), 'true');
  await pagina.getByRole('button', { name: '★ Favoritos' }).click();
  assert.equal(await pagina.locator('[data-favorite-match="9001"]').count(), 1);
  await pagina.reload();
  assert.equal(await pagina.locator('[data-favorite-match="9001"]').getAttribute('aria-pressed'), 'true');

  await pagina.goto(`${base}/equipo.html?id=10&league=39&season=2026`);
  await pagina.locator('[data-team-match-favorite="9001"]').waitFor();
  assert.equal(await pagina.locator('[data-team-match-favorite="9001"]').getAttribute('aria-pressed'), 'true');
  await pagina.locator('[data-team-match-favorite="9001"]').click();
  assert.equal(await pagina.locator('[data-team-match-favorite="9001"]').getAttribute('aria-pressed'), 'false');

  await navegador.close();
  servidor.close();
  console.log('Playwright: favoritos de partidos validados en calendario y equipo.');
})().catch(error => { servidor.close(); console.error(error); process.exitCode = 1; });

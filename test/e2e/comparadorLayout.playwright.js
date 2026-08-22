const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');

const publicDir = path.join(__dirname, '..', '..', 'public');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(publicDir, pathname);
  if (!file.startsWith(publicDir) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const metrics = '<p class="period-label">Partido completo · 8 partidos</p><div class="record-grid">' +
  ['Victorias', 'Empates', 'Derrotas', 'Goles a favor', 'Goles en contra', 'Diferencia']
    .map((label, i) => `<div class="metric-card"><span class="metric-label">${label}</span><strong>${i + 1}</strong></div>`).join('') + '</div>';

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  for (const config of [
    { name: 'desktop', viewport: { width: 1440, height: 1000 } },
    { name: 'mobile', ...devices['iPhone 13'] }
  ]) {
    const context = await browser.newContext(config);
    const page = await context.newPage();
    await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usuario: { id: 1, nombre: 'QA', rol: 'admin', tieneAcceso: true } }) }));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.locator('#stats-a').evaluate((node, html) => { node.innerHTML = html; }, metrics);
    await page.locator('#stats-b').evaluate((node, html) => { node.innerHTML = html; }, metrics);
    await page.locator('#tab-history-a').click();
    await page.locator('#matches-a').evaluate(node => {
      node.innerHTML = generarVistaPorEstadisticas([{
        fecha: '2026-08-09T12:00:00Z', rival: 'Rival', resultado: 'V', marcador: '2-1',
        goles: 2, tiros: 11, tiros_puerta: 5, corners: 6, faltas: 10, amarillas: 2, rojas: 1, puntos_tarjetas: 4, offsides: 1,
        rival_estadisticas: { goles: 1, tiros: 8, tiros_puerta: 3, corners: 4, faltas: 12, amarillas: 3, rojas: 0, puntos_tarjetas: 3, offsides: 2 }
      }], 5);
    });
    const encabezados = await page.locator('#matches-a .advanced-detail-table').first().locator('th').allTextContents();
    assert.deepEqual(encabezados, ['Fecha', 'Rival', 'A favor', 'En contra', 'Total partido', 'Resultado']);
    const tiros = await page.locator('#matches-a .advanced-detail-table').nth(1).locator('tbody tr').first().locator('td').allTextContents();
    assert.equal(tiros[2], '11');
    assert.equal(tiros[3], '8');
    assert.equal(tiros[4], '19');
    const puntosTarjetas = await page.locator('#matches-a .advanced-detail-table').nth(7).locator('tbody tr').first().locator('td').allTextContents();
    assert.equal(puntosTarjetas[2], '4');
    assert.equal(puntosTarjetas[3], '3');
    assert.equal(puntosTarjetas[4], '7');
    assert.equal(await page.locator('#panel-summary-a').isHidden(), true);
    assert.equal(await page.locator('#panel-history-a').isVisible(), true);
    await page.locator('#tab-trends-a').press('ArrowRight');
    assert.equal(await page.locator('#tab-history-a').getAttribute('aria-selected'), 'true');
    await page.locator('#tab-summary-a').click();
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      columns: getComputedStyle(document.querySelector('.main-grid')).gridTemplateColumns.split(' ').length,
      metricColumns: getComputedStyle(document.querySelector('.record-grid')).gridTemplateColumns.split(' ').length,
      container: Math.round(document.querySelector('.container').getBoundingClientRect().width),
      selectorTops: [...document.querySelectorAll('#panel-a .selection-field')].map(field => {
        const control = field.querySelector('.league-picker-button,.team-picker-button,select');
        return Math.round(control.getBoundingClientRect().top);
      })
    }));
    assert.equal(layout.overflow, false, `${config.name}: no debe haber desbordamiento horizontal`);
    if (config.name === 'desktop') {
      assert.equal(layout.columns, 2);
      assert.equal(layout.metricColumns, 6);
      assert.ok(layout.container <= 1320);
      assert.ok(Math.max(...layout.selectorTops) - Math.min(...layout.selectorTops) <= 1, 'los tres selectores deben quedar alineados');
    } else {
      assert.equal(layout.columns, 1);
      assert.equal(layout.metricColumns, 3);
    }
    await page.screenshot({ path: `/tmp/comparador-${config.name}.png`, fullPage: true });
    await context.close();
  }
  await browser.close();
  server.close();
  console.log('Playwright: layout del comparador validado en escritorio y móvil.');
})().catch(error => { server.close(); console.error(error); process.exitCode = 1; });

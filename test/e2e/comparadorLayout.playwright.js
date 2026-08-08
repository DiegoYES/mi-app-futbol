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
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      columns: getComputedStyle(document.querySelector('.main-grid')).gridTemplateColumns.split(' ').length,
      metricColumns: getComputedStyle(document.querySelector('.record-grid')).gridTemplateColumns.split(' ').length,
      container: Math.round(document.querySelector('.container').getBoundingClientRect().width)
    }));
    assert.equal(layout.overflow, false, `${config.name}: no debe haber desbordamiento horizontal`);
    if (config.name === 'desktop') {
      assert.equal(layout.columns, 2);
      assert.equal(layout.metricColumns, 6);
      assert.ok(layout.container <= 1320);
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

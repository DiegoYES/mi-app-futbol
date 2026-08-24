#!/usr/bin/env node
const { chromium, devices } = require('playwright');

const BASE_URL = process.env.SMOKE_BASE_URL || '';
const TOKEN = process.env.SMOKE_TOKEN || '';
const esProduccion = /^https:\/\/(?:www\.)?data-fut\.com\/?$/.test(BASE_URL);
if (!BASE_URL || !TOKEN) throw new Error('Faltan SMOKE_BASE_URL o SMOKE_TOKEN.');
if (esProduccion && process.env.ALLOW_PRODUCTION_READONLY !== '1') throw new Error('Producción requiere ALLOW_PRODUCTION_READONLY=1.');

const analiticaFixture = {
  resumen: { total: 3, pendientes: 1, resueltos: 2, acertados: 1, fallados: 1, efectividad: 50, brier: 0.25 },
  segmentos: {
    mercado: [{ id: 'prueba', etiqueta: 'Mercado de prueba', total: 3, pendientes: 1, resueltos: 2, acertados: 1, fallados: 1, efectividad: 50, brier: 0.25 }],
    liga: [], alcance: [], periodo: [], confianza: [], muestra: [], mes: [], temporada: []
  },
  calibracion: [{ id: '70-79', etiqueta: '70-79%', total: 2, pendientes: 0, resueltos: 2, acertados: 1, fallados: 1, efectividad: 50, brier: 0.25, estimacion_media: 74, desviacion: -24.5 }],
  picks: []
};

async function validar(nombre, opciones = {}) {
  const errores = [];
  const navegador = await chromium.launch({ headless: true });
  const contexto = await navegador.newContext({ baseURL: BASE_URL, ...opciones });
  await contexto.addCookies([{ name: 'token', value: TOKEN, url: BASE_URL, httpOnly: true, secure: BASE_URL.startsWith('https://'), sameSite: 'Lax' }]);
  const pagina = await contexto.newPage();
  await pagina.route('**/api/picks/seguimiento', ruta => ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(analiticaFixture) }));
  pagina.on('pageerror', error => errores.push(`error JS: ${error.message}`));
  pagina.on('console', mensaje => {
    if (mensaje.type() === 'error' && !mensaje.text().startsWith('Failed to load resource:')) errores.push(`console.error: ${mensaje.text()}`);
  });
  pagina.on('response', respuesta => {
    const estado = respuesta.status();
    if (estado < 400) return;
    if (/\/api\/(equipos|ligas)\/.+\/(escudo|logo)/.test(respuesta.url()) && [400, 404, 429, 503].includes(estado)) return;
    errores.push(`HTTP ${estado}: ${respuesta.url()}`);
  });

  const portada = await pagina.goto('/', { waitUntil: 'domcontentloaded' });
  if (!portada?.ok()) errores.push(`portada ${portada?.status()}`);
  const csp = portada?.headers()['content-security-policy'] || '';
  if (!csp.includes('nonce-') || csp.includes("'unsafe-inline'")) errores.push('CSP no usa nonce limpio');
  if (!(await pagina.locator('meta[name="csp-nonce"]').getAttribute('content'))) errores.push('falta meta nonce');

  const admin = await pagina.goto('/admin.html', { waitUntil: 'domcontentloaded' });
  if (!admin?.ok()) errores.push(`admin ${admin?.status()}`);
  await pagina.waitForSelector('#admin-menu');
  if (await pagina.getByText('Aviso legal', { exact: false }).count()) errores.push('aviso legal reapareció en admin');
  const esperaCalidad = pagina.waitForResponse(r => r.url().includes('/api/admin/calidad-datos'), { timeout: 20000 });
  await pagina.click('[data-admin-panel="calidad"]');
  const respuestaCalidad = await esperaCalidad;
  if (!respuestaCalidad.ok()) errores.push(`calidad ${respuestaCalidad.status()}`);
  await pagina.waitForSelector('.quality-card');
  if (await pagina.locator('.quality-card').count() !== 4) errores.push('calidad no muestra cuatro indicadores');
  if (!(await pagina.locator('#quality-revalidate-form').isVisible())) errores.push('revalidación controlada no visible');

  await pagina.goto('/picks.html', { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#analytics-segments');
  await pagina.selectOption('#analytics-dimension', 'mercado');
  await pagina.waitForFunction(() => document.querySelector('#analytics-segments')?.textContent.includes('Mercado de prueba'));
  if (!(await pagina.locator('#analytics-calibration').textContent()).includes('50% real')) errores.push('calibración no renderizada');

  const overflow = await pagina.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  if (overflow) { const medida = await pagina.evaluate(() => ({ ancho: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth })); errores.push('overflow horizontal en picks (' + medida.ancho + ' > ' + medida.viewport + ')'); }
  await pagina.waitForTimeout(500);
  await navegador.close();
  if (errores.length) throw new Error(`${nombre}:\n- ${errores.join('\n- ')}`);
  return { nombre, calidad: true, calibracion: true, csp: true };
}

(async () => {
  const resultados = [];
  resultados.push(await validar('escritorio', { viewport: { width: 1440, height: 1000 } }));
  resultados.push(await validar('móvil', { ...devices['iPhone 13'] }));
  console.log(JSON.stringify({ solo_lectura: true, resultados }, null, 2));
})().catch(error => { console.error(error.message); process.exit(1); });

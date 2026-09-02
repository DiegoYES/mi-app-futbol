const { chromium } = require('playwright');
const mongoose = require('mongoose');
const path = require('path');
const baseURL = process.env.BASE_URL || 'https://data-fut.com';
const envPath = baseURL.includes('staging')
  ? path.join(__dirname, '../../../mi-app-futbol-staging/.env')
  : path.join(__dirname, '../../.env');
require('dotenv').config({ path: envPath, override: true });
const Usuario = require('../../models/Usuario');

(async () => {
  console.log('--- Iniciando prueba E2E de Mercados por Equipo en competicion.html ---');
  await mongoose.connect(process.env.MONGODB_URI);
  await Usuario.deleteMany({ email: 'test-e2e-mercados@local.test' });
  const u = new Usuario({
    email: 'test-e2e-mercados@local.test',
    password: 'TestPassword123!',
    nombre: 'Tester Mercados',
    rol: 'admin',
    activo: true,
    suscripcion_termina: new Date(Date.now() + 86400000)
  });
  await u.save();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  console.log('Target URL:', baseURL);

  // 1. Login
  await page.goto(`${baseURL}/`, { waitUntil: 'networkidle' });
  const respLogin = await page.request.post(`${baseURL}/api/auth/login`, {
    data: { email: 'test-e2e-mercados@local.test', password: 'TestPassword123!' }
  });
  if (!respLogin.ok()) {
    throw new Error(`Login falló con status ${respLogin.status()}`);
  }

  // 2. Navegar a competición
  await page.goto(`${baseURL}/competicion.html?id=39&season=2026`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.competition-nav-tabs', { timeout: 10000 });

  // 3. Clic en pestaña Mercados
  const tabMercados = page.locator('[data-tab="mercados"]');
  if (await tabMercados.count() === 0) {
    throw new Error('No se encontró el botón de la pestaña Mercados.');
  }
  await tabMercados.click();
  await page.waitForTimeout(300);

  // 4. Validar panel activo y tabla con equipos
  const panelVisible = await page.locator('#panel-mercados.active').count();
  if (!panelVisible) {
    throw new Error('El panel de mercados no se activó al hacer clic.');
  }

  const filasIniciales = await page.locator('#lista-tabla-mercados tr').count();
  console.log('Filas de equipos en tabla de mercados:', filasIniciales);
  if (filasIniciales < 10) {
    throw new Error(`Se esperaban al menos 10 equipos, se encontraron ${filasIniciales}.`);
  }

  // 5. Validar que el primer equipo tiene porcentaje >= que el último (orden descendente)
  const primerPctText = await page.locator('#lista-tabla-mercados tr:first-child .market-pct-badge').textContent();
  const ultimoPctText = await page.locator('#lista-tabla-mercados tr:last-child .market-pct-badge').textContent();
  const primerPct = Number.parseInt(primerPctText.replace('%', ''), 10);
  const ultimoPct = Number.parseInt(ultimoPctText.replace('%', ''), 10);
  console.log(`Porcentajes de acierto: Primero=${primerPct}%, Último=${ultimoPct}%`);
  if (primerPct < ultimoPct) {
    throw new Error(`La tabla no está ordenada de mayor a menor: ${primerPct}% < ${ultimoPct}%`);
  }

  // 6. Probar selector de condición: Local
  console.log('Probando condición Local...');
  await page.click('.market-scope-pills button[data-scope="local"]');
  await page.waitForTimeout(250);
  const filasLocal = await page.locator('#lista-tabla-mercados tr').count();
  if (filasLocal === 0) {
    throw new Error('La condición Local no mostró filas.');
  }

  // 7. Probar selector de mercado: Ambos Anotan (btts_si)
  console.log('Probando mercado Ambos Anotan: Sí...');
  await page.selectOption('#filtro-mercados-tipo', 'btts_si');
  await page.waitForTimeout(250);

  // 8. Probar periodo: 1er Tiempo (1t)
  console.log('Probando periodo 1er Tiempo...');
  await page.selectOption('#filtro-mercados-periodo', '1t');
  await page.waitForTimeout(250);

  // 9. Probar buscador de equipo: "Arsenal"
  console.log('Probando buscador de equipo "Arsenal"...');
  await page.fill('#buscar-mercado-equipo', 'Arsenal');
  await page.waitForTimeout(250);

  const filasFiltradas = await page.locator('#lista-tabla-mercados tr').count();
  console.log('Filas mostradas para "Arsenal":', filasFiltradas);
  if (filasFiltradas !== 1) {
    throw new Error(`Se esperaba 1 fila para Arsenal, pero se encontraron ${filasFiltradas}.`);
  }
  const nombreEquipo = await page.locator('#lista-tabla-mercados tr td a span').textContent();
  if (!nombreEquipo.includes('Arsenal')) {
    throw new Error(`El equipo mostrado no es Arsenal, es: "${nombreEquipo}".`);
  }

  console.log('--- ¡PRUEBA E2E DE MERCADOS SUPERADA CON ÉXITO! ---');
  await browser.close();
  await Usuario.deleteMany({ email: 'test-e2e-mercados@local.test' });
  await mongoose.disconnect();
})().catch(async err => {
  console.error('ERROR EN PLAYWRIGHT TEST MERCADOS:', err.message);
  try {
    await Usuario.deleteMany({ email: 'test-e2e-mercados@local.test' });
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});

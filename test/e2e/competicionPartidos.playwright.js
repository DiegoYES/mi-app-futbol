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
  console.log('--- Iniciando prueba E2E de Partidos en competicion.html ---');
  await mongoose.connect(process.env.MONGODB_URI);
  await Usuario.deleteMany({ email: 'test-e2e-partidos@local.test' });
  const u = new Usuario({
    email: 'test-e2e-partidos@local.test',
    password: 'TestPassword123!',
    nombre: 'Tester',
    rol: 'admin',
    activo: true,
    suscripcion_termina: new Date(Date.now() + 86400000)
  });
  await u.save();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const baseURL = process.env.BASE_URL || 'https://data-fut.com';
  console.log('Target URL:', baseURL);

  // 1. Iniciar sesión
  await page.goto(`${baseURL}/`, { waitUntil: 'networkidle' });
  const respLogin = await page.request.post(`${baseURL}/api/auth/login`, {
    data: { email: 'test-e2e-partidos@local.test', password: 'TestPassword123!' }
  });
  if (!respLogin.ok()) {
    throw new Error(`Login falló con status ${respLogin.status()}`);
  }

  // 2. Navegar a Premier League 2026
  await page.goto(`${baseURL}/competicion.html?id=39&season=2026`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.competition-nav-tabs', { timeout: 10000 });

  // 3. Ir a la pestaña Partidos
  await page.click('[data-tab="partidos"]');
  await page.waitForTimeout(400);

  // 4. Validar que automáticamente se seleccionó la jornada siguiente
  const selJornada = page.locator('#filtro-partidos-jornada');
  const valorSeleccionado = await selJornada.inputValue();
  console.log('Jornada auto-seleccionada:', valorSeleccionado);
  if (!valorSeleccionado) {
    throw new Error('El selector de jornada no seleccionó automáticamente la jornada siguiente.');
  }

  // Validar que hay grupos visibles con partidos de esa jornada
  const gruposCount = await page.locator('.matches-round-group').count();
  console.log('Grupos de jornada visibles para la jornada seleccionada:', gruposCount);
  if (gruposCount === 0) {
    throw new Error('No se mostró el grupo de la jornada auto-seleccionada.');
  }

  const partidosJornadaCount = await page.locator('.match-list-item').count();
  console.log('Partidos de esa jornada:', partidosJornadaCount);
  if (partidosJornadaCount === 0) {
    throw new Error('La jornada auto-seleccionada no tiene partidos visibles.');
  }

  // 5. Cambiar a "Todas las jornadas"
  console.log('Cambiando selector a "Todas las jornadas"...');
  await selJornada.selectOption('');
  await page.waitForTimeout(400);

  const totalGrupos = await page.locator('.matches-round-group').count();
  console.log('Total de grupos jornada a jornada visibles en "Todas las jornadas":', totalGrupos);
  if (totalGrupos < 10) {
    throw new Error(`Se esperaban al menos 10 jornadas agrupadas, pero se encontraron ${totalGrupos}.`);
  }

  // Validar encabezados de grupo
  const primerTitulo = await page.locator('.matches-round-title').first().textContent();
  console.log('Título del primer grupo:', primerTitulo);
  if (!primerTitulo.includes('Jornada')) {
    throw new Error(`El título del grupo debería ser "Jornada X", pero fue: "${primerTitulo}".`);
  }

  // Validar etiquetas de jornada en los partidos (no debe decir solo "Jornada")
  const etiquetas = await page.$$eval('.match-list-round', els => els.slice(0, 10).map(e => e.textContent.trim()));
  console.log('Muestra de etiquetas de jornada:', etiquetas);
  for (const et of etiquetas) {
    if (et === 'Jornada' || !et) {
      throw new Error(`Etiqueta de jornada inválida encontrada: "${et}". Debe contener el número.`);
    }
  }

  // 6. Probar buscador por equipo
  console.log('Probando buscador de equipo "Arsenal"...');
  await page.fill('#buscar-partidos', 'Arsenal');
  await page.waitForTimeout(300);

  const partidosArsenal = await page.locator('.match-list-item').count();
  console.log('Partidos encontrados para "Arsenal":', partidosArsenal);
  if (partidosArsenal === 0) {
    throw new Error('El buscador por equipo no devolvió partidos para Arsenal.');
  }

  console.log('--- ¡TODAS LAS VALIDACIONES DE PLAYWRIGHT PASARON SATISFACTORIAMENTE! ---');
  await browser.close();
  await Usuario.deleteMany({ email: 'test-e2e-partidos@local.test' });
  await mongoose.disconnect();
})().catch(async err => {
  console.error('ERROR EN PLAYWRIGHT TEST:', err.message);
  try {
    await Usuario.deleteMany({ email: 'test-e2e-partidos@local.test' });
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});

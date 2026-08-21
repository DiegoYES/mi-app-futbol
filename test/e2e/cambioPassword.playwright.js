#!/usr/bin/env node
const { chromium } = require('playwright');
const { validarPasswordNueva } = require('../../services/accountSettings');

const BASE_URL = process.env.STAGING_BASE_URL || 'https://staging.data-fut.com';
const EMAIL = process.env.STAGING_SMOKE_EMAIL || '';
const PASSWORD = process.env.STAGING_SMOKE_PASSWORD || '';

if (/\/\/(www\.)?data-fut\.com/.test(BASE_URL)) {
  console.error(`BLOQUEADO: STAGING_BASE_URL apunta a producción (${BASE_URL}).`);
  process.exit(1);
}
if (!EMAIL || !PASSWORD) {
  console.error('Define STAGING_SMOKE_EMAIL y STAGING_SMOKE_PASSWORD.');
  process.exit(1);
}

async function main() {
  const navegador = await chromium.launch({ headless: true });
  const contexto = await navegador.newContext({ baseURL: BASE_URL });
  const pagina = await contexto.newPage();
  let temporal = '';
  let passwordCambiada = false;

  async function cambiar(actual, nueva) {
    const respuesta = await pagina.request.post('/api/auth/cambiar-password', {
      data: { password_actual: actual, password_nueva: nueva }
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok()) throw new Error(datos.error || `Cambiar contraseña respondió ${respuesta.status()}.`);
    return datos;
  }

  try {
    await pagina.goto('/login.html', { waitUntil: 'networkidle' });
    await pagina.fill('input[type="email"]', EMAIL);
    await pagina.fill('input[type="password"]', PASSWORD);
    const login = await Promise.all([
      pagina.waitForResponse(respuesta => respuesta.url().includes('/api/auth/login')),
      pagina.click('button[type="submit"]')
    ]).then(([respuesta]) => respuesta);
    if (!login.ok()) throw new Error(`El login técnico respondió ${login.status()}.`);

    await pagina.goto('/configuracion.html', { waitUntil: 'networkidle' });
    const me = await pagina.request.get('/api/auth/me');
    if (!me.ok()) throw new Error(`/api/auth/me respondió ${me.status()}.`);
    const usuario = (await me.json()).usuario;
    const originalValida = validarPasswordNueva(PASSWORD, { email: usuario.email, nombre: usuario.nombre });
    if (originalValida.error) throw new Error(`La contraseña técnica no puede restaurarse con las reglas actuales: ${originalValida.error}`);

    temporal = `Prueba temporal ${Date.now()} !`;
    await pagina.locator('#password-actual').fill(PASSWORD);
    await pagina.locator('#password-nueva').fill(temporal);
    await pagina.locator('#password-confirmacion').fill(temporal);
    const cambio = await Promise.all([
      pagina.waitForResponse(respuesta => respuesta.url().includes('/api/auth/cambiar-password')),
      pagina.locator('#form-password button[type="submit"]').click()
    ]).then(([respuesta]) => respuesta);
    if (!cambio.ok()) throw new Error(`El cambio real respondió ${cambio.status()}.`);
    passwordCambiada = true;
    if (!/otras sesiones cerradas/i.test(await pagina.locator('#mensaje-password').textContent())) {
      throw new Error('La interfaz no confirmó el cierre de las demás sesiones.');
    }

    await cambiar(temporal, PASSWORD);
    passwordCambiada = false;
    temporal = '';
    const vigente = await pagina.request.get('/api/auth/me');
    if (!vigente.ok()) throw new Error('La sesión actual no sobrevivió al cambio y restauración de contraseña.');
    console.log('Playwright contraseña OK: cambio real, nueva cookie e inmediata restauración en staging.');
  } finally {
    if (passwordCambiada && temporal) {
      const restaurada = await pagina.request.post('/api/auth/cambiar-password', {
        data: { password_actual: temporal, password_nueva: PASSWORD }
      }).catch(() => null);
      if (!restaurada?.ok()) console.error('ERROR: no se pudo restaurar la contraseña técnica de staging.');
    }
    await navegador.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

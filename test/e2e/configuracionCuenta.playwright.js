#!/usr/bin/env node
const { chromium } = require('playwright');

const BASE_URL = process.env.STAGING_BASE_URL || 'https://staging.data-fut.com';
const EMAIL = process.env.STAGING_ADMIN_EMAIL || '';
const PASSWORD = process.env.STAGING_ADMIN_PASSWORD || '';

if (/\/\/(www\.)?data-fut\.com/.test(BASE_URL)) {
  console.error(`BLOQUEADO: STAGING_BASE_URL apunta a producción (${BASE_URL}).`);
  process.exit(1);
}
if (!EMAIL || !PASSWORD) {
  console.error('Define STAGING_ADMIN_EMAIL y STAGING_ADMIN_PASSWORD.');
  process.exit(1);
}

async function main() {
  const navegador = await chromium.launch({ headless: true });
  const contexto = await navegador.newContext({ baseURL: BASE_URL });
  const pagina = await contexto.newPage();
  const errores = [];
  let perfilOriginal = null;

  pagina.on('pageerror', error => errores.push(error.message));

  try {
    await pagina.goto('/login.html', { waitUntil: 'networkidle' });
    await pagina.fill('input[type="email"]', EMAIL);
    await pagina.fill('input[type="password"]', PASSWORD);
    const login = await Promise.all([
      pagina.waitForResponse(respuesta => respuesta.url().includes('/api/auth/login')),
      pagina.click('button[type="submit"]')
    ]).then(([respuesta]) => respuesta);
    if (!login.ok()) throw new Error(`El login respondió ${login.status()}.`);

    await pagina.goto('/admin.html', { waitUntil: 'networkidle' });
    const navPrincipal = pagina.locator('nav[aria-label="Navegación principal"]');
    for (const ruta of ['/configuracion.html', '/guia.html', '/sugerencias.html']) {
      if (await navPrincipal.locator(`a[href="${ruta}"]`).count()) throw new Error(`${ruta} todavía aparece en la navegación principal.`);
    }
    const triggerCuenta = pagina.locator('#cuenta-menu-trigger');
    await triggerCuenta.click();
    if (await triggerCuenta.getAttribute('aria-expanded') !== 'true') throw new Error('El nombre no abrió el menú de cuenta.');
    const enlace = pagina.locator('#cuenta-menu-panel a[href="/configuracion.html"]');
    if (!await enlace.isVisible()) throw new Error('Configuración no aparece en el menú de cuenta.');
    if (!await pagina.locator('#cuenta-menu-panel a[href="/guia.html"]').isVisible()) throw new Error('Guía no aparece en el menú de cuenta.');
    if (!await pagina.locator('#cuenta-menu-panel a[href="/sugerencias.html"]').isVisible()) throw new Error('Sugerencias no aparece en el menú de cuenta.');
    await pagina.mouse.click(1000, 300);
    if (await pagina.locator('#cuenta-menu-panel').isVisible()) throw new Error('El clic fuera no cerró el menú de cuenta.');
    await triggerCuenta.click();
    await enlace.click();
    await pagina.waitForURL('**/configuracion.html');
    await pagina.waitForLoadState('networkidle');

    if (!await pagina.getByRole('heading', { name: 'Configuración.' }).count()) {
      throw new Error('La página de configuración no cargó su encabezado.');
    }
    const rol = (await pagina.locator('#cuenta-rol').textContent()).trim();
    if (rol !== 'Administrador') throw new Error(`La cuenta administrativa se mostró como ${rol}.`);

    const me = await pagina.request.get('/api/auth/me');
    if (!me.ok()) throw new Error(`/api/auth/me respondió ${me.status()}.`);
    const usuario = (await me.json()).usuario;
    perfilOriginal = {
      nombre: usuario.nombre || 'Administrador Staging',
      preferencias: { formato_momio: usuario.preferencias?.formato_momio || 'ambos' }
    };

    const nombreTemporal = `Admin Staging ${Date.now()}`;
    await pagina.locator('#config-nombre').fill(nombreTemporal);
    await pagina.locator('#config-momio').selectOption('americano');
    const guardado = await Promise.all([
      pagina.waitForResponse(respuesta => respuesta.url().includes('/api/auth/perfil') && respuesta.request().method() === 'PATCH'),
      pagina.locator('#form-perfil button[type="submit"]').click()
    ]).then(([respuesta]) => respuesta);
    if (!guardado.ok()) throw new Error(`Guardar perfil respondió ${guardado.status()}.`);
    await pagina.reload({ waitUntil: 'networkidle' });
    if (await pagina.locator('#config-nombre').inputValue() !== nombreTemporal) {
      throw new Error('El nombre no persistió al recargar.');
    }
    if (await pagina.locator('#config-momio').inputValue() !== 'americano') {
      throw new Error('La preferencia de momio no persistió al recargar.');
    }
    if (await pagina.evaluate(() => localStorage.getItem('datafut:formato-momio')) !== 'americano') {
      throw new Error('La preferencia de momio no se sincronizó con la vista editorial.');
    }

    await pagina.locator('#config-nombre').fill('<img src=x onerror=window.__inyectado=1>');
    const rechazado = await Promise.all([
      pagina.waitForResponse(respuesta => respuesta.url().includes('/api/auth/perfil') && respuesta.request().method() === 'PATCH'),
      pagina.locator('#form-perfil button[type="submit"]').click()
    ]).then(([respuesta]) => respuesta);
    if (rechazado.status() !== 400) throw new Error(`El nombre malicioso respondió ${rechazado.status()} en vez de 400.`);
    if (!/caracteres no permitidos/i.test(await pagina.locator('#mensaje-perfil').textContent())) {
      throw new Error('La interfaz no explicó el rechazo del nombre malicioso.');
    }
    if (await pagina.evaluate(() => Boolean(window.__inyectado))) throw new Error('Se ejecutó contenido inyectado en el nombre.');

    await pagina.locator('#password-nueva').fill('frase segura diferente 2026');
    await pagina.locator('#password-confirmacion').fill('frase segura diferente 2027');
    await pagina.locator('#password-actual').fill('no-se-envia');
    await pagina.locator('#form-password button[type="submit"]').click();
    if (!/no coinciden/i.test(await pagina.locator('#mensaje-password').textContent())) {
      throw new Error('La confirmación de contraseña no se valida en el cliente.');
    }

    await pagina.setViewportSize({ width: 390, height: 844 });
    await pagina.locator('#cuenta-menu-trigger').click();
    if (!await pagina.locator('#cuenta-menu-panel').isVisible()) throw new Error('El menú de cuenta no abre en móvil.');
    await pagina.keyboard.press('Escape');
    if (await pagina.locator('#cuenta-menu-panel').isVisible()) throw new Error('Escape no cerró el menú de cuenta.');
    const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (desborde) throw new Error('La configuración genera desborde horizontal en móvil.');
    if (errores.length) throw new Error(`Errores JavaScript: ${errores.join(' | ')}`);
    console.log('Playwright configuración OK: admin, persistencia, rechazo de inyección y móvil.');
  } finally {
    if (perfilOriginal) {
      const restaurada = await pagina.request.patch('/api/auth/perfil', { data: perfilOriginal }).catch(() => null);
      if (!restaurada?.ok()) console.error('AVISO: no se pudo restaurar el perfil administrativo de staging.');
    }
    await navegador.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

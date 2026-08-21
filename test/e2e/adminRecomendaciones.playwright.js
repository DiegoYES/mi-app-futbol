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
  const pagina = await navegador.newPage({ baseURL: BASE_URL });
  const errores = [];
  pagina.on('pageerror', error => errores.push(error.message));

  try {
    await pagina.goto('/login.html', { waitUntil: 'networkidle' });
    await pagina.fill('input[type="email"]', EMAIL);
    await pagina.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      pagina.waitForResponse(respuesta => respuesta.url().includes('/api/auth/login')),
      pagina.click('button[type="submit"]')
    ]);
    await pagina.goto('/admin.html', { waitUntil: 'networkidle' });

    const tipo = pagina.locator('#rec-tipo');
    const agregar = pagina.locator('#rec-agregar');
    const selecciones = pagina.locator('.rec-selection');
    if (await tipo.inputValue() !== 'pick') throw new Error('El formulario no inició como pick individual.');
    if (await selecciones.count() !== 1) throw new Error('El pick inicial no tiene exactamente una selección.');
    if (await agregar.isDisabled()) throw new Error('El botón Añadir selección está deshabilitado.');

    await agregar.click();
    if (await tipo.inputValue() !== 'parlay') throw new Error('Añadir una segunda selección no cambió el tipo a parlay.');
    if (await selecciones.count() !== 2) throw new Error('Añadir selección no creó la segunda fila.');

    await agregar.click();
    if (await selecciones.count() !== 3) throw new Error('Añadir selección no creó la tercera fila del parlay.');

    await tipo.selectOption('pick');
    if (await selecciones.count() !== 1) throw new Error('Volver a pick no redujo el formulario a una selección.');

    const seleccion = selecciones.first();
    await seleccion.locator('[data-rec="formato"]').selectOption('americano');
    await seleccion.locator('[data-rec="momio"]').fill('-100');
    if (await seleccion.locator('[data-rec="momio"]').inputValue() !== '+100') {
      throw new Error('El momio individual -100 no se normalizó como +100.');
    }
    await pagina.locator('#rec-formato-total').selectOption('americano');
    await pagina.locator('#rec-momio-total').fill('-100');
    if (await pagina.locator('#rec-momio-total').inputValue() !== '+100') {
      throw new Error('El momio total -100 no se normalizó como +100.');
    }
    if (errores.length) throw new Error(`Errores JavaScript: ${errores.join(' | ')}`);
    console.log('Playwright admin OK: añade selecciones y normaliza -100 como +100.');
  } finally {
    await navegador.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

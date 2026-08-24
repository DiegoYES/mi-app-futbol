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

  const partidoAudax = {
    api_id: 99001549,
    fecha: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    liga: { id: 265, nombre: 'Chile Primera División' },
    local: { id: 2329, nombre: 'A. Italiano' },
    visitante: { id: 2326, nombre: 'Union La Calera' }
  };
  await pagina.route('**/api/admin/recomendaciones/partidos?*', async ruta => {
    const respuesta = await ruta.fetch();
    const datos = await respuesta.json();
    await ruta.fulfill({ response: respuesta, json: { ...datos, partidos: [...(datos.partidos || []), partidoAudax] } });
  });
  await pagina.route(`**/api/admin/recomendaciones/partidos/${partidoAudax.api_id}/mercados`, ruta => ruta.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ mercados: [{
      id: 'tarjetas_total_over_2.5',
      nombre: 'Más de 2.5 tarjetas registradas totales',
      categoria: 'tarjetas',
      estimacion: 78.6,
      muestra: 10
    }] })
  }));

  try {
    await pagina.goto('/login.html', { waitUntil: 'networkidle' });
    await pagina.fill('input[type="email"]', EMAIL);
    await pagina.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      pagina.waitForResponse(respuesta => respuesta.url().includes('/api/auth/login')),
      pagina.click('button[type="submit"]')
    ]);
    await pagina.goto('/admin.html', { waitUntil: 'networkidle' });

    const paneles = ['resumen', 'picks', 'usuarios', 'tickets', 'redes', 'seguridad'];
    if (await pagina.locator('#site-legal-footer').count()) throw new Error('El aviso legal público no debe montarse en el panel administrativo.');
    const menu = pagina.locator('#admin-menu [data-admin-panel]');
    if (await menu.count() !== paneles.length) throw new Error('El menú no contiene todas las secciones administrativas.');
    if (await pagina.getByText('Playdoit', { exact: false }).count()) {
      throw new Error('La integración Playdoit todavía aparece en el panel.');
    }
    if (await pagina.locator('[data-admin-panel-content]:visible').count() !== 1) {
      throw new Error('Debe mostrarse exactamente una sección administrativa.');
    }
    for (const panel of paneles) {
      await pagina.locator(`[data-admin-panel="${panel}"]`).click();
      if (await pagina.locator(`[data-admin-panel-content="${panel}"]`).isHidden()) {
        throw new Error(`El menú no mostró la sección ${panel}.`);
      }
      if (await pagina.locator('[data-admin-panel-content]:visible').count() !== 1) {
        throw new Error(`La sección ${panel} dejó más de un panel visible.`);
      }
      if (await pagina.evaluate(() => location.hash) !== `#${panel}`) {
        throw new Error(`La sección ${panel} no se reflejó en la URL.`);
      }
    }
    await pagina.reload({ waitUntil: 'networkidle' });
    if (await pagina.locator('[data-admin-panel-content="seguridad"]').isHidden()) {
      throw new Error('La sección indicada por el hash no persistió al recargar.');
    }
    await pagina.locator('[data-admin-panel="picks"]').click();

    const tipo = pagina.locator('#rec-tipo');
    const agregar = pagina.locator('#rec-agregar');
    const selecciones = pagina.locator('.rec-selection');
    if (await tipo.inputValue() !== 'pick') throw new Error('El formulario no inició como pick individual.');
    if (await selecciones.count() !== 1) throw new Error('El pick inicial no tiene exactamente una selección.');
    if (await agregar.isDisabled()) throw new Error('El botón Añadir selección está deshabilitado.');

    const primeraSeleccion = selecciones.first();
    await primeraSeleccion.locator('[data-rec="buscar-partido"]').fill('Italiano Audax');
    const opcionAudax = primeraSeleccion.locator(`[data-rec="partido"] option[value="${partidoAudax.api_id}"]`);
    if (await opcionAudax.count() !== 1 || !(await opcionAudax.textContent()).includes('Audax Italiano')) {
      throw new Error('La búsqueda tokenizada no encontró Audax Italiano usando el alias del proveedor.');
    }
    await primeraSeleccion.locator('[data-rec="partido"]').selectOption(String(partidoAudax.api_id));
    await primeraSeleccion.locator('[data-rec="mercado"]:not([disabled])').waitFor();
    await primeraSeleccion.locator('[data-rec="buscar-mercado"]').fill('registradas tarjetas');
    if (await primeraSeleccion.locator('[data-rec="mercado"] option[value="tarjetas_total_over_2.5"]').count() !== 1) {
      throw new Error('La búsqueda tokenizada no encontró el mercado con las palabras en distinto orden.');
    }

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

    await pagina.setViewportSize({ width: 390, height: 844 });
    await pagina.goto('/admin.html#resumen', { waitUntil: 'networkidle' });
    for (const panel of paneles) {
      await pagina.locator(`[data-admin-panel="${panel}"]`).click();
      const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (desborde) throw new Error(`La sección ${panel} genera desborde horizontal en móvil.`);
    }
    if (errores.length) throw new Error(`Errores JavaScript: ${errores.join(' | ')}`);
    console.log('Playwright admin OK: menú, búsqueda tokenizada de Audax/mercados y creador de parlays funcional.');
  } finally {
    await navegador.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

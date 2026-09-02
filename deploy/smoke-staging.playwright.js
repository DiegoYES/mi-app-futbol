#!/usr/bin/env node
// Smoke test Playwright para STAGING: navegación real en escritorio y móvil,
// captura de errores JavaScript, respuestas 4xx/5xx inesperadas, centro de
// partido real y búsqueda del calendario sin resultados duplicados. No toca
// MongoDB directamente; el login y /api/picks/seguimiento producen escrituras
// acotadas a la cuenta de staging en la base -staging.
//
// Uso: STAGING_SMOKE_EMAIL=... STAGING_SMOKE_PASSWORD=... \
//      STAGING_BASE_URL=https://staging.data-fut.com node deploy/smoke-staging.playwright.js

const { chromium, devices } = require('playwright');

const BASE_URL = process.env.STAGING_BASE_URL || 'https://staging.data-fut.com';
const EMAIL = process.env.STAGING_SMOKE_EMAIL || '';
const PASSWORD = process.env.STAGING_SMOKE_PASSWORD || '';
// Opcional: credenciales HTTP si Nginx protege staging con auth_basic.
const BASIC_USER = process.env.STAGING_BASIC_AUTH_USER || '';
const BASIC_PASSWORD = process.env.STAGING_BASIC_AUTH_PASSWORD || '';
// Respuestas de imágenes toleradas: 404 de escudos/logos que faltan y 400 de
// IDs negativos (los datos semilla sintéticos usan api_id negativos a
// propósito y el proxy de escudos rechaza IDs <= 0).
const RUTAS_IMAGEN = /\/api\/(equipos|ligas)\/(-?\d+)\/(escudo|logo)/;
function respuestaImagenTolerada(url, estado) {
  const coincide = url.match(RUTAS_IMAGEN);
  if (!coincide) return false;
  // El calendario puede disparar cientos de imágenes en paralelo y superar el
  // burst perimetral de Nginx. Es una degradación visual recuperable; nunca se
  // tolera el mismo estado en HTML ni en endpoints de datos.
  if (estado === 429 || estado === 503) return true;
  if (estado === 404) return true;
  return estado === 400 && Number(coincide[2]) < 0;
}

if (/\/\/(www\.)?data-fut\.com/.test(BASE_URL)) {
  console.error(`BLOQUEADO: STAGING_BASE_URL apunta a producción (${BASE_URL}).`);
  process.exit(1);
}
if ((BASIC_USER && !BASIC_PASSWORD) || (!BASIC_USER && BASIC_PASSWORD)) {
  console.error('Define STAGING_BASIC_AUTH_USER y STAGING_BASIC_AUTH_PASSWORD juntos, o ninguno.');
  process.exit(1);
}
if (!EMAIL || !PASSWORD) {
  console.error('Define STAGING_SMOKE_EMAIL y STAGING_SMOKE_PASSWORD (cuenta exclusiva de staging).');
  process.exit(1);
}

// /partido.html y /competiciones.html se prueban con sus propios bloques interactivos dedicados.
const PAGINAS = ['/', '/calendario.html', '/comparador.html', '/picks.html', '/boletas.html', '/configuracion.html'];

async function recorrer(nombre, opcionesContexto) {
  const errores = [];
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    baseURL: BASE_URL,
    ...(BASIC_USER ? { httpCredentials: { username: BASIC_USER, password: BASIC_PASSWORD } } : {}),
    ...opcionesContexto
  });
  const pagina = await contexto.newPage();

  pagina.on('pageerror', (err) => errores.push(`[${nombre}] error JS: ${err.message}`));
  pagina.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // Chromium duplica cada respuesta HTTP fallida con este mensaje genérico,
    // sin incluir URL ni estado. El listener `response` de abajo conserva el
    // diagnóstico preciso y aplica la excepción estrecha para imágenes
    // sintéticas; omitir este duplicado no oculta ningún HTTP inesperado.
    if (msg.text().startsWith('Failed to load resource: the server responded with a status of')) return;
    errores.push(`[${nombre}] console.error: ${msg.text()}`);
  });
  pagina.on('response', (resp) => {
    const estado = resp.status();
    if (estado < 400) return;
    const url = resp.url();
    if (respuestaImagenTolerada(url, estado)) return;
    errores.push(`[${nombre}] HTTP ${estado} en ${url}`);
  });

  // Login mediante el formulario real.
  await pagina.goto('/login.html', { waitUntil: 'networkidle' });
  await pagina.fill('input[type="email"], input[name="email"], #email', EMAIL);
  await pagina.fill('input[type="password"], input[name="password"], #password', PASSWORD);
  await Promise.all([
    pagina.waitForResponse((r) => r.url().includes('/api/auth/login')),
    pagina.click('button[type="submit"]')
  ]);

  for (const ruta of PAGINAS) {
    const respuesta = await pagina.goto(ruta, { waitUntil: 'networkidle' });
    if (!respuesta || respuesta.status() >= 400) {
      errores.push(`[${nombre}] la página ${ruta} respondió ${respuesta ? respuesta.status() : 'sin respuesta'}`);
    }
  }

  // Centro de partido REAL: obtiene un encuentro del calendario y lo abre con
  // sus identificadores, igual que haría un usuario.
  const respProximos = await pagina.request.get('/api/calendario/proximos?dias=30');
  if (!respProximos.ok()) {
    errores.push(`[${nombre}] /api/calendario/proximos respondió ${respProximos.status()}`);
  } else {
    const datos = await respProximos.json();
    let partidoReal = null;
    for (const dia of datos.jornadas || []) {
      for (const comp of dia.competiciones || []) {
        for (const p of comp.partidos || []) {
          if (p.local?.id && p.visitante?.id && comp.liga_id) {
            partidoReal = { ...p, liga_id: comp.liga_id };
            break;
          }
        }
        if (partidoReal) break;
      }
      if (partidoReal) break;
    }
    if (!partidoReal) {
      errores.push(`[${nombre}] no hay partidos en el calendario para probar el centro de partido (¿semillas cargadas?).`);
    } else {
      const urlPartido = `/partido.html?local=${partidoReal.local.id}&visitante=${partidoReal.visitante.id}&liga=${partidoReal.liga_id}&partido=${partidoReal.api_id}`;
      const respuesta = await pagina.goto(urlPartido, { waitUntil: 'networkidle' });
      if (!respuesta || respuesta.status() >= 400) {
        errores.push(`[${nombre}] el centro de partido ${urlPartido} respondió ${respuesta ? respuesta.status() : 'sin respuesta'}`);
      }
    }
  }

  // Penales y prórroga: si staging tiene algún partido resuelto en la tanda,
  // el calendario debe rotularlo "Penales" y mostrar el marcador de la tanda
  // junto al de 120'. Sin partidos así, la comprobación se omite sin fallar.
  const respDia = await pagina.request.get('/api/calendario/proximos?dias=30');
  if (respDia.ok()) {
    const datos = await respDia.json();
    const conTanda = (datos.jornadas || [])
      .flatMap(dia => dia.competiciones || [])
      .flatMap(comp => comp.partidos || [])
      .find(p => p.estado === 'PEN' || p.penales);

    if (!conTanda) {
      console.log(`  [${nombre}] sin partidos definidos en penales en staging; se omite esa comprobación.`);
    } else {
      if (!conTanda.penales || typeof conTanda.penales.local !== 'number') {
        errores.push(`[${nombre}] el partido ${conTanda.api_id} está en PEN pero la API no expone la tanda.`);
      }
      const detalle = await pagina.request.get(`/api/partidos/${conTanda.api_id}/estadisticas`);
      if (!detalle.ok()) {
        errores.push(`[${nombre}] /api/partidos/${conTanda.api_id}/estadisticas respondió ${detalle.status()}`);
      } else {
        const ficha = await detalle.json();
        if (!ficha.penales) errores.push(`[${nombre}] el centro de partido ${conTanda.api_id} no expone la tanda de penales.`);
        const golesTotales = (ficha.equipo_local?.goles ?? 0) + (ficha.equipo_visitante?.goles ?? 0);
        const tandaTotal = (ficha.penales?.local ?? 0) + (ficha.penales?.visitante ?? 0);
        if (tandaTotal && golesTotales >= tandaTotal + 2) {
          errores.push(`[${nombre}] el marcador del partido ${conTanda.api_id} parece incluir la tanda de penales.`);
        }
      }
    }
  }

  // Banner de entorno visible en la portada.
  await pagina.goto('/', { waitUntil: 'networkidle' });
  const banner = await pagina.locator('#banner-entorno-prueba').count();
  if (banner !== 1) errores.push(`[${nombre}] banner ENTORNO DE PRUEBA ausente o duplicado (${banner}).`);

  // Búsqueda del calendario sin resultados duplicados (reproduce la búsqueda
  // "Argentina" en #busquedaCalendario).
  await pagina.goto('/calendario.html', { waitUntil: 'networkidle' });
  const buscador = pagina.locator('#busquedaCalendario');
  if (await buscador.count()) {
    await buscador.fill('Argentina');
    await pagina.waitForTimeout(1500);
    // Compara la IDENTIDAD (tipo:id) de cada resultado, no su texto: la misma
    // liga puede pintarse con textos secundarios distintos ("Liga", "Argentina").
    const identidades = await pagina
      .locator('#resultadosBusqueda .search-option')
      .evaluateAll((opciones) => opciones.map((o) => `${o.dataset.filterType}:${o.dataset.filterId}`));
    const vistos = new Set();
    for (const identidad of identidades) {
      if (vistos.has(identidad)) errores.push(`[${nombre}] resultado de búsqueda duplicado: ${identidad}`);
      vistos.add(identidad);
    }
  } else {
    errores.push(`[${nombre}] no se encontró el buscador #busquedaCalendario en el calendario.`);
  }

  // Competiciones: verificación de tarjetas reales, sin estados de error,
  // funcionamiento del buscador y botón de favoritas.
  await pagina.goto('/competiciones.html', { waitUntil: 'networkidle' });
  try {
    await pagina.waitForSelector('.competition-directory-card', { timeout: 10000 });
    const totalCards = await pagina.locator('.competition-directory-card').count();
    if (totalCards === 0) {
      errores.push(`[${nombre}] /competiciones.html cargó 0 tarjetas.`);
    }
    const erroresVisibles = await pagina.locator('.warning, .catalog-empty').count();
    if (erroresVisibles > 0) {
      const txt = await pagina.locator('.warning, .catalog-empty').first().innerText().catch(() => '');
      errores.push(`[${nombre}] /competiciones.html mostró un bloque de error visible: ${txt}`);
    }
    const inputBuscar = pagina.locator('#buscar');
    if (await inputBuscar.count()) {
      await inputBuscar.fill('México');
      await pagina.waitForTimeout(400);
      const filtradas = await pagina.locator('.competition-directory-card').count();
      if (filtradas === 0) {
        errores.push(`[${nombre}] el buscador de competiciones arrojó 0 resultados para 'México'.`);
      }
      const favBtn = pagina.locator('.competition-directory-card .favorite-button').first();
      if (await favBtn.count()) {
        await favBtn.click();
        await pagina.waitForTimeout(200);
      }
      await pagina.click('#limpiar-busqueda');
    }
  } catch (err) {
    errores.push(`[${nombre}] fallo interactuando con /competiciones.html: ${err.message}`);
  }

  // Verificación de Centro de Competición (/competicion.html):
  // Abrir la primera liga, probar el cambio entre pestañas (jornadas, jugadores, clasificacion, partidos)
  // y validar que los partidos de toda la temporada se listen y filtren correctamente.
  try {
    const enlaceLiga = pagina.locator('.competition-card-foot a').first();
    if (await enlaceLiga.count()) {
      await enlaceLiga.click();
      await pagina.waitForSelector('.competition-nav-tabs', { timeout: 10000 });

      // Probar cambio a pestaña Jugadores
      await pagina.click('[data-tab="jugadores"]');
      await pagina.waitForTimeout(200);

      // Probar cambio a pestaña Clasificación
      await pagina.click('[data-tab="clasificacion"]');
      await pagina.waitForTimeout(200);

      // Probar cambio a pestaña Partidos
      await pagina.click('[data-tab="partidos"]');
      await pagina.waitForTimeout(200);
      const totalPartidos = await pagina.locator('.match-list-item').count();
      if (totalPartidos === 0) {
        errores.push(`[${nombre}] /competicion.html no mostró ningún partido en el listado.`);
      }

      // Validar que se agrupan los partidos jornada a jornada
      const grupos = await pagina.locator('.matches-round-group').count();
      if (grupos === 0) {
        errores.push(`[${nombre}] /competicion.html no agrupó los partidos jornada a jornada.`);
      }

      // Probar selección de "Todas las jornadas" y verificar grupos múltiples
      const selJornadasPartidos = pagina.locator('#filtro-partidos-jornada');
      if (await selJornadasPartidos.count()) {
        const opciones = await selJornadasPartidos.locator('option').all();
        if (opciones.length > 1) {
          await selJornadasPartidos.selectOption({ index: 0 });
          await pagina.waitForTimeout(200);
          const gruposTodas = await pagina.locator('.matches-round-group').count();
          if (gruposTodas === 0) {
            errores.push(`[${nombre}] /competicion.html no mostró grupos en "Todas las jornadas".`);
          }
        }
      }
    }
  } catch (err) {
    errores.push(`[${nombre}] fallo interactuando con /competicion.html: ${err.message}`);
  }

  await navegador.close();
  return errores;
}

(async () => {
  const errores = [
    ...(await recorrer('escritorio', { viewport: { width: 1366, height: 900 } })),
    ...(await recorrer('móvil', { ...devices['iPhone 13'] }))
  ];
  if (errores.length) {
    console.error(`Smoke Playwright FALLÓ con ${errores.length} problema(s):`);
    for (const e of errores) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('Smoke Playwright OK: escritorio y móvil sin errores JS, sin HTTP inesperados y sin duplicados.');
})().catch((err) => {
  console.error(`Smoke Playwright abortado: ${err.message}`);
  process.exit(1);
});

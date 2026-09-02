#!/usr/bin/env node
// Validación Playwright del buscador de competición en /jugadores.html.
//
// Autocontenida: sirve `public/` con un servidor estático mínimo y responde
// /api/ con fixtures en memoria. No abre MongoDB ni consume API-Football.
//
// Comprueba que escribir "Mexico" en el selector muestre únicamente las
// competiciones mexicanas (Liga MX y Liga de Expansión), que "liga mx"
// tokenizado también encuentre Liga MX, que elegir una opción habilite sus
// temporadas y que la URL refleje league/season.
//
// Uso: node test/e2e/jugadoresBuscadorLiga.playwright.js
//      BASE_URL=https://staging.data-fut.com node test/e2e/jugadoresBuscadorLiga.playwright.js
//      (con BASE_URL se usa el servidor remoto y sus competiciones reales;
//       en ese caso sólo se exige que "Mexico" devuelva al menos una liga y
//       que ninguna opción visible pertenezca a otro país.)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const RAIZ_PUBLICA = path.join(__dirname, '..', '..', 'public');
const REMOTO = process.env.BASE_URL || '';
// Contra un servidor remoto las APIs exigen sesión: se inicia con el formulario
// real usando una cuenta de prueba (nunca hardcodeada).
const EMAIL = process.env.SMOKE_EMAIL || process.env.STAGING_SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || process.env.STAGING_SMOKE_PASSWORD || '';
const BASIC_USER = process.env.STAGING_BASIC_AUTH_USER || '';
const BASIC_PASSWORD = process.env.STAGING_BASIC_AUTH_PASSWORD || '';
if (REMOTO && (!EMAIL || !PASSWORD)) {
  console.error('Con BASE_URL define SMOKE_EMAIL y SMOKE_PASSWORD (cuenta de prueba) para iniciar sesión.');
  process.exit(1);
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const COMPETICIONES = [
  { id: 262, nombre: 'Liga MX', pais: 'Mexico', temporadas: [{ temporada: 2025, etiqueta: '2025/2026', cobertura: { jugadores: 120 } }, { temporada: 2024, etiqueta: '2024/2025', cobertura: { jugadores: 300 } }] },
  { id: 263, nombre: 'Liga de Expansión MX', pais: 'Mexico', temporadas: [{ temporada: 2025, etiqueta: '2025/2026', cobertura: { jugadores: 40 } }] },
  { id: 140, nombre: 'La Liga', pais: 'Spain', temporadas: [{ temporada: 2025, etiqueta: '2025/2026', cobertura: { jugadores: 200 } }] },
  { id: 39, nombre: 'Premier League', pais: 'England', temporadas: [{ temporada: 2025, etiqueta: '2025/2026', cobertura: { jugadores: 200 } }] },
  { id: 2, nombre: 'UEFA Champions League', pais: 'World', temporadas: [{ temporada: 2025, etiqueta: '2025/2026', cobertura: { jugadores: 50 } }] }
];

function respuestaApi(ruta) {
  if (ruta.startsWith('/api/home/competiciones')) return { competiciones: COMPETICIONES };
  if (ruta.startsWith('/api/jugadores')) return { jugadores: [{ id: 1, nombre: 'Jugador Prueba', equipos: ['Club Prueba'], posicion: 'Attacker', partidos: 10, goles: 3, tiros_puerta: 12, minutos: 900, foto: '' }] };
  if (ruta.startsWith('/api/auth/me') || ruta.startsWith('/api/auth/sesion')) return { usuario: { email: 'smoke@staging.local', nombre: 'Smoke', rol: 'usuario', tieneAcceso: true, motivo: 'suscripcion_activa' } };
  return {};
}

function crearServidor() {
  return http.createServer((req, res) => {
    const ruta = req.url.split('?')[0];
    if (ruta.startsWith('/api/')) {
      if (/\/api\/ligas\/\d+\/logo/.test(ruta)) {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(respuestaApi(req.url)));
    }
    const nombre = ruta === '/' ? '/inicio.html' : ruta;
    const destino = path.join(RAIZ_PUBLICA, path.normalize(nombre));
    if (!destino.startsWith(RAIZ_PUBLICA) || !fs.existsSync(destino) || !fs.statSync(destino).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('no encontrado');
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(destino)] || 'application/octet-stream' });
    fs.createReadStream(destino).pipe(res);
  });
}

async function opcionesVisibles(pagina) {
  return pagina.locator('#resultados-ligas [data-league-value]').evaluateAll(nodos => nodos.map(nodo => ({
    id: nodo.dataset.leagueValue,
    nombre: nodo.querySelector('strong')?.textContent.trim() || '',
    pais: (nodo.querySelector('small')?.textContent.trim() || '').split(' · ')[0]
  })));
}

async function comprobar(nombre, opcionesContexto, base) {
  const fallos = [];
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    baseURL: base,
    ...(BASIC_USER ? { httpCredentials: { username: BASIC_USER, password: BASIC_PASSWORD } } : {}),
    ...opcionesContexto
  });
  const pagina = await contexto.newPage();
  const erroresJs = [];
  pagina.on('pageerror', err => erroresJs.push(err.message));
  pagina.on('response', respuesta => {
    const estado = respuesta.status();
    if (estado < 400) return;
    if (/\/api\/(equipos|ligas)\/.+\/(escudo|logo)/.test(respuesta.url()) && [400, 404, 429, 503].includes(estado)) return;
    fallos.push(`[${nombre}] HTTP ${estado}: ${respuesta.url()}`);
  });

  if (REMOTO) {
    await pagina.goto('/login.html', { waitUntil: 'networkidle' });
    await pagina.fill('input[type="email"], input[name="email"], #email', EMAIL);
    await pagina.fill('input[type="password"], input[name="password"], #password', PASSWORD);
    const [respuestaLogin] = await Promise.all([
      pagina.waitForResponse(r => r.url().includes('/api/auth/login')),
      pagina.click('button[type="submit"]')
    ]);
    if (!respuestaLogin.ok()) fallos.push(`[${nombre}] login respondió ${respuestaLogin.status()}`);
  }

  await pagina.goto('/jugadores.html', { waitUntil: 'networkidle' });

  // El select nativo sigue existiendo (accesible y como respaldo) pero oculto.
  if (!(await pagina.locator('#liga').count())) fallos.push(`[${nombre}] falta el select #liga`);
  const boton = pagina.locator('#abrir-ligas');
  await boton.waitFor({ timeout: 15000 });
  const textoBoton = (await boton.textContent()).replace(/\s+/g, ' ').trim();
  if (!/Elige una competición/.test(textoBoton)) fallos.push(`[${nombre}] botón inicial inesperado: "${textoBoton}"`);

  await boton.click();
  const buscador = pagina.locator('#buscar-liga');
  if (!(await buscador.isVisible())) fallos.push(`[${nombre}] el buscador de competición no se mostró al abrir`);

  // 1. Buscar por país.
  await buscador.fill('Mexico');
  await pagina.waitForTimeout(150);
  const porPais = await opcionesVisibles(pagina);
  if (!porPais.length) fallos.push(`[${nombre}] "Mexico" no devolvió competiciones`);
  const ajenas = porPais.filter(o => !/mexico|méxico/i.test(o.pais) && !/mexico|méxico|mx\b/i.test(o.nombre));
  if (ajenas.length) fallos.push(`[${nombre}] "Mexico" mostró competiciones de otro país: ${ajenas.map(o => `${o.nombre} (${o.pais})`).join(', ')}`);
  if (!REMOTO) {
    const nombres = porPais.map(o => o.nombre).sort();
    const esperados = ['Liga MX', 'Liga de Expansión MX'].sort();
    if (JSON.stringify(nombres) !== JSON.stringify(esperados)) fallos.push(`[${nombre}] "Mexico" devolvió ${JSON.stringify(nombres)}, se esperaba ${JSON.stringify(esperados)}`);
  }

  // 2. Buscar por nombre tokenizado (fragmentos en cualquier orden).
  await buscador.fill('mx liga');
  await pagina.waitForTimeout(150);
  const porNombre = await opcionesVisibles(pagina);
  if (!porNombre.some(o => /liga mx/i.test(o.nombre))) fallos.push(`[${nombre}] "mx liga" no encontró Liga MX: ${JSON.stringify(porNombre.map(o => o.nombre))}`);

  // 3. Elegir la primera opción y verificar temporadas + URL.
  const primera = pagina.locator('#resultados-ligas [data-league-value]').first();
  const idElegido = await primera.getAttribute('data-league-value');
  const nombreElegido = (await primera.locator('strong').textContent()).trim();
  await primera.click();
  await pagina.waitForTimeout(300);

  if (await pagina.locator('#lista-ligas').isVisible()) fallos.push(`[${nombre}] la lista no se cerró tras elegir`);
  const valorSelect = await pagina.locator('#liga').inputValue();
  if (valorSelect !== idElegido) fallos.push(`[${nombre}] #liga vale "${valorSelect}" y se esperaba "${idElegido}"`);
  const textoElegido = (await boton.textContent()).replace(/\s+/g, ' ').trim();
  if (!textoElegido.includes(nombreElegido)) fallos.push(`[${nombre}] el botón no muestra la competición elegida: "${textoElegido}"`);
  const temporada = pagina.locator('#temporada');
  if (await temporada.isDisabled()) fallos.push(`[${nombre}] el selector de temporada sigue deshabilitado`);
  const totalTemporadas = await temporada.locator('option').count();
  if (totalTemporadas < 1) fallos.push(`[${nombre}] no se cargaron temporadas`);
  const url = new URL(pagina.url());
  if (url.searchParams.get('league') !== idElegido) fallos.push(`[${nombre}] la URL no refleja league=${idElegido}: ${url.search}`);
  if (!url.searchParams.get('season')) fallos.push(`[${nombre}] la URL no refleja season: ${url.search}`);

  // 4. Recargar con la URL debe restaurar la selección en el botón.
  await pagina.goto(`/jugadores.html${url.search}`, { waitUntil: 'networkidle' });
  const textoRestaurado = (await boton.textContent()).replace(/\s+/g, ' ').trim();
  if (!textoRestaurado.includes(nombreElegido)) fallos.push(`[${nombre}] al recargar no se restauró la competición: "${textoRestaurado}"`);

  // 5. El selector básico sigue disponible como respaldo.
  await boton.click();
  await pagina.locator('#selector-basico').click();
  if (!(await pagina.locator('#liga').isVisible())) fallos.push(`[${nombre}] el selector básico no mostró el select nativo`);

  for (const error of erroresJs) fallos.push(`[${nombre}] error JS: ${error}`);
  await navegador.close();
  return fallos;
}

(async () => {
  let servidor = null;
  let base = REMOTO;
  if (!REMOTO) {
    servidor = crearServidor();
    await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
  }
  try {
    const fallos = [
      ...(await comprobar('escritorio', { viewport: { width: 1366, height: 900 } }, base)),
      ...(await comprobar('móvil', { ...devices['iPhone 13'] }, base))
    ];
    if (fallos.length) {
      console.error(`Buscador de competición en jugadores FALLÓ con ${fallos.length} problema(s):`);
      for (const fallo of fallos) console.error(`  - ${fallo}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Buscador de competición en jugadores OK (${base}): país, nombre tokenizado, temporadas y URL en escritorio y móvil.`);
  } finally {
    if (servidor) servidor.close();
  }
})().catch(error => {
  console.error(`Buscador de competición abortado: ${error.message}`);
  process.exit(1);
});

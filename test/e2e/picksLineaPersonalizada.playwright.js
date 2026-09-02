#!/usr/bin/env node
// Test E2E de Playwright: Simulación del flujo real del usuario para líneas de mercado
// (tanto la línea 18.5 en el desplegable como el ingreso de una línea manual como 20.5).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');

const RAIZ_PUBLICA = path.join(__dirname, '..', '..', 'public');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json'
};

const PARTIDO_FLAMENGO = {
  api_id: 1492145,
  fecha: new Date(Date.now() + 86400000).toISOString(),
  hora: '19:00',
  estado: 'NS',
  liga: { id: 71, nombre: 'Brasileirão Série A', temporada: 2026 },
  equipo_local: { id: 1278, nombre: 'Flamengo', logo: '' },
  equipo_visitante: { id: 7848, nombre: 'Mirassol', logo: '' }
};

const MERCADOS_MOCK = [
  {
    id: 'tiros_local_over_13_5',
    mercado: 'Más de 13.5 tiros del local',
    categoria: 'tiros',
    tipo: 'over',
    linea: 13.5,
    alcance: 'local',
    estimacion: 60.7,
    confianza: 'media',
    muestra: 10,
    fuentes: 2,
    evidencia_parcial: false,
    guardado: false,
    detalle_fuentes: [
      { rol: 'local', aciertos: 7, total: 10, frecuencia_observada: 70, tasa_suavizada: 64.3, lectura: 'produccion_propia' }
    ]
  },
  {
    id: 'tiros_local_under_13_5',
    mercado: 'Menos de 13.5 tiros del local',
    categoria: 'tiros',
    tipo: 'under',
    linea: 13.5,
    alcance: 'local',
    estimacion: 39.3,
    confianza: 'media',
    muestra: 10,
    fuentes: 2,
    evidencia_parcial: false,
    guardado: false,
    detalle_fuentes: [
      { rol: 'local', aciertos: 3, total: 10, frecuencia_observada: 30, tasa_suavizada: 35.7, lectura: 'produccion_propia' }
    ]
  },
  {
    id: 'tiros_local_over_18_5',
    mercado: 'Más de 18.5 tiros del local',
    categoria: 'tiros',
    tipo: 'over',
    linea: 18.5,
    alcance: 'local',
    estimacion: 52.4,
    confianza: 'media',
    muestra: 10,
    fuentes: 2,
    evidencia_parcial: false,
    guardado: false,
    detalle_fuentes: [
      { rol: 'local', aciertos: 5, total: 10, frecuencia_observada: 50, tasa_suavizada: 50.0, lectura: 'produccion_propia' }
    ]
  },
  {
    id: 'tiros_local_under_18_5',
    mercado: 'Menos de 18.5 tiros del local',
    categoria: 'tiros',
    tipo: 'under',
    linea: 18.5,
    alcance: 'local',
    estimacion: 47.6,
    confianza: 'media',
    muestra: 10,
    fuentes: 2,
    evidencia_parcial: false,
    guardado: false,
    detalle_fuentes: [
      { rol: 'local', aciertos: 5, total: 10, frecuencia_observada: 50, tasa_suavizada: 50.0, lectura: 'produccion_propia' }
    ]
  }
];

let picksGuardadosEnServidor = new Set();

function crearServidor() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/api/auth/me') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ usuario: { id: 1, nombre: 'Diego', rol: 'admin', tieneAcceso: true } }));
    }

    if (url.pathname === '/api/partidos/1492145') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(PARTIDO_FLAMENGO));
    }

    if (url.pathname.startsWith('/api/equipos/') && url.pathname.endsWith('/estadisticas-detalladas')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        info: { equipo: 'Equipo', periodo: 'Partido completo', cobertura: { partidos: 10, estadisticas: 10 } },
        stats: { jugados: 10, goles_favor: 15, tiros_total: 18 }
      }));
    }

    if (url.pathname === '/api/picks/partido/1492145') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        partido: {
          api_id: 1492145,
          fecha: PARTIDO_FLAMENGO.fecha,
          estado: 'NS',
          local: PARTIDO_FLAMENGO.equipo_local,
          visitante: PARTIDO_FLAMENGO.equipo_visitante
        },
        guardable: true,
        motivo_no_guardable: null,
        periodo: 0,
        mercados: MERCADOS_MOCK.map(m => ({ ...m, guardado: picksGuardadosEnServidor.has(m.id) })),
        recomendados: ['tiros_local_over_13_5'],
        categorias: ['tiros'],
        metodologia: 'Frecuencia histórica suavizada con la muestra elegida.'
      }));
    }

    if (url.pathname === '/api/picks/partido/1492145/personalizado') {
      const linea = Number(url.searchParams.get('linea'));
      const cat = url.searchParams.get('categoria');
      const alcance = url.searchParams.get('alcance') || 'local';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        mercados: [
          {
            id: `${cat}_${alcance}_over_${String(linea).replace('.', '_')}`,
            mercado: `Más de ${linea} tiros del local`,
            categoria: cat,
            tipo: 'over',
            linea,
            alcance,
            estimacion: 38.5,
            confianza: 'media',
            muestra: 10,
            fuentes: 2,
            evidencia_parcial: false,
            guardado: picksGuardadosEnServidor.has(`${cat}_${alcance}_over_${String(linea).replace('.', '_')}`),
            detalle_fuentes: [
              { rol: 'local', aciertos: 3, total: 10, frecuencia_observada: 30, tasa_suavizada: 35.7, lectura: 'produccion_propia' }
            ]
          },
          {
            id: `${cat}_${alcance}_under_${String(linea).replace('.', '_')}`,
            mercado: `Menos de ${linea} tiros del local`,
            categoria: cat,
            tipo: 'under',
            linea,
            alcance,
            estimacion: 61.5,
            confianza: 'media',
            muestra: 10,
            fuentes: 2,
            evidencia_parcial: false,
            guardado: picksGuardadosEnServidor.has(`${cat}_${alcance}_under_${String(linea).replace('.', '_')}`),
            detalle_fuentes: [
              { rol: 'local', aciertos: 7, total: 10, frecuencia_observada: 70, tasa_suavizada: 64.3, lectura: 'produccion_propia' }
            ]
          }
        ]
      }));
    }

    if (url.pathname.includes('/explicacion/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        explicacion: {
          mercado: 'Más de 20.5 tiros del local',
          detalle_fuentes: [
            {
              rol: 'local',
              lectura: 'produccion_propia',
              aciertos: 3,
              total: 10,
              partidos: [
                { fecha: '2026-08-25', local: 'Flamengo', visitante: 'Vasco', marcador: '2-1', sujeto: 'Flamengo', valor: 22, unidad: 'tiros', cumplio: true },
                { fecha: '2026-08-18', local: 'Flamengo', visitante: 'Fluminense', marcador: '1-0', sujeto: 'Flamengo', valor: 19, unidad: 'tiros', cumplio: false },
                { fecha: '2026-08-11', local: 'Flamengo', visitante: 'Botafogo', marcador: '3-0', sujeto: 'Flamengo', valor: 24, unidad: 'tiros', cumplio: true }
              ]
            }
          ]
        }
      }));
    }

    if (url.pathname === '/api/picks/seguimiento' && req.method === 'POST') {
      let cuerpo = '';
      req.on('data', chunk => { cuerpo += chunk; });
      req.on('end', () => {
        const datos = JSON.parse(cuerpo || '{}');
        picksGuardadosEnServidor.add(datos.mercado_id);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pick: { id: 'pick_123', mercado_id: datos.mercado_id, estado: 'pendiente' } }));
      });
      return;
    }

    const archivo = path.join(RAIZ_PUBLICA, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!archivo.startsWith(RAIZ_PUBLICA) || !fs.existsSync(archivo)) {
      res.writeHead(404).end('No encontrado');
      return;
    }
    const ext = path.extname(archivo);
    res.writeHead(200, { 'Content-Type': TIPOS[ext] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(res);
  });
}

async function probarFlujo(baseURL, nombreDispositivo, opcionesContexto) {
  picksGuardadosEnServidor.clear();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(opcionesContexto);
  const page = await context.newPage();

  const erroresJs = [];
  page.on('pageerror', err => erroresJs.push(err.message));

  // 1. El usuario abre la página del partido con el hash #picks
  await page.goto(`${baseURL}/partido.html?local=1278&visitante=7848&liga=71&partido=1492145&fecha=2026-09-02#picks`, { waitUntil: 'networkidle' });

  // Esperar a que cargue el explorador de picks
  await page.waitForSelector('.market-explorer', { timeout: 10000 });

  // 2. El usuario selecciona la categoría Tiros y Alcance Equipo local
  await page.click('[data-category-tab="tiros"]');
  await page.selectOption('#alcanceMercadoPartido', 'local');

  // 3. Verificar que el desplegable contiene 18.5 (catálogo ampliado) y la opción "Otra línea personalizada…"
  const opcionesLinea = await page.locator('#lineaMercadoPartido option').allTextContents();
  assert.ok(opcionesLinea.includes('18.5'), 'El desplegable debe contener la línea 18.5 del catálogo');
  assert.ok(opcionesLinea.some(txt => txt.includes('Otra línea personalizada')), 'El desplegable debe incluir "Otra línea personalizada…"');

  // 4. El usuario selecciona 18.5 en el desplegable
  await page.selectOption('#lineaMercadoPartido', '18.5');
  await page.waitForTimeout(200);

  // Las tarjetas Over 18.5 y Under 18.5 deben ser visibles
  const tarjetas18 = await page.locator('.pick-card .pick-market').allTextContents();
  assert.ok(tarjetas18.some(t => t.includes('Más de 18.5 tiros del local')), 'Debe mostrarse Más de 18.5 tiros del local');
  assert.ok(tarjetas18.some(t => t.includes('Menos de 18.5 tiros del local')), 'Debe mostrarse Menos de 18.5 tiros del local');

  // 5. El usuario ahora prueba una línea manual: selecciona "Otra línea personalizada…"
  await page.selectOption('#lineaMercadoPartido', '__custom__');

  // El campo numérico manual debe aparecer
  const inputManual = page.locator('#inputLineaPersonalizada');
  await inputManual.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await inputManual.getAttribute('type'), 'number', 'El input debe ser de tipo number');
  assert.equal(await inputManual.getAttribute('inputmode'), 'decimal', 'El input debe tener inputmode decimal');

  // 6. El usuario escribe 20.5 y pulsa Consultar
  await inputManual.fill('20.5');
  await page.click('#btnCalcularLineaPersonalizada');
  await page.waitForTimeout(400);

  // 7. Se deben renderizar las tarjetas para Más de 20.5 y Menos de 20.5 tiros del local
  const tarjetas20 = await page.locator('.pick-card .pick-market').allTextContents();
  assert.ok(tarjetas20.some(t => t.includes('Más de 20.5 tiros del local')), 'Debe mostrarse la tarjeta Más de 20.5 tiros del local');
  assert.ok(tarjetas20.some(t => t.includes('Menos de 20.5 tiros del local')), 'Debe mostrarse la tarjeta Menos de 20.5 tiros del local');

  // 8. El usuario abre la explicación auditable ("¿Por qué 38.5%?")
  const btnExplicar = page.locator('.pick-card', { hasText: 'Más de 20.5 tiros del local' }).locator('button.pick-why');
  await btnExplicar.click();

  // El diálogo modal debe estar abierto y mostrar el desglose de partidos
  const dialog = page.locator('#match-explanation-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  const contenidoDialogo = await page.locator('#match-explanation-body').innerText();
  assert.ok(contenidoDialogo.includes('Flamengo'), 'El diálogo de auditoría debe contener el nombre del equipo local');
  assert.ok(contenidoDialogo.includes('tiros'), 'El diálogo debe detallar los tiros por partido');

  // Cerrar diálogo
  await page.click('#match-explanation-close');

  // 9. El usuario pulsa "Guardar pick" en Más de 20.5
  const btnGuardar = page.locator('.pick-card', { hasText: 'Más de 20.5 tiros del local' }).locator('button[data-guardar-pick]');
  await btnGuardar.click();
  await page.waitForTimeout(300);

  // Debe actualizarse a estado guardado
  const estadoGuardado = await page.locator('.pick-card', { hasText: 'Más de 20.5 tiros del local' }).locator('.pick-result.hit').innerText();
  assert.equal(estadoGuardado, 'Guardado', 'El pick debe quedar guardado exitosamente');

  assert.equal(erroresJs.length, 0, `No debe haber errores JS en ${nombreDispositivo}: ${erroresJs.join(', ')}`);
  console.log(`✓ Flujo de usuario probado con éxito en ${nombreDispositivo}`);

  await browser.close();
}

(async () => {
  const servidor = crearServidor();
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${servidor.address().port}`;

  try {
    // Probar en Escritorio
    await probarFlujo(baseURL, 'Escritorio (1366x900)', { viewport: { width: 1366, height: 900 } });
    // Probar en Móvil
    await probarFlujo(baseURL, 'Móvil (iPhone 13)', { ...devices['iPhone 13'] });
    console.log('\n🎉 TODAS LAS VALIDACIONES DE FLUJO DE USUARIO PASARON CORRECTAMENTE.');
  } finally {
    servidor.close();
  }
})();

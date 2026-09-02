#!/usr/bin/env node
// Validación Playwright del desglose de /jugador.html.
//
// Autocontenida: sirve `public/` con un servidor estático mínimo y responde
// /api/ con fixtures en memoria. No abre MongoDB ni consume API-Football.
//
// Reproduce el caso reportado: un defensa con 33 minutos en dos partidos y una
// amarilla mostraba "Tarjetas 2.73" sin contexto. Comprueba que la ficha:
//  - muestre faltas cometidas/recibidas y tarjetas partido a partido,
//  - marque los partidos sin minutos como tales,
//  - presente total, promedio por partido y por 90 con aviso de muestra corta,
//  - y no muestre el aviso cuando la muestra es suficiente.
//
// Uso: node test/e2e/jugadorDesglose.playwright.js

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const RAIZ_PUBLICA = path.join(__dirname, '..', '..', 'public');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function actuacion(extra) {
  return {
    partido_api_id: 1, fecha: '2026-08-29T19:00:00.000Z', liga: { id: 39, nombre: 'Premier League', temporada: 2026 }, equipo: { id: 40, nombre: 'Liverpool', local: true }, local: true,
    rival: { id: 65, nombre: 'Nottingham Forest' }, marcador: { propio: 2, rival: 1 }, estado: 'FT', posicion: 'D', numero: 4, titular: false, capitan: false,
    minutos: 0, calificacion: 0, goles: 0, asistencias: 0, tiros: 0, tiros_puerta: 0, pases: 0, pases_clave: 0, precision_pases: 0, entradas: 0, intercepciones: 0,
    duelos: 0, duelos_ganados: 0, regates: 0, regates_exitosos: 0, faltas_recibidas: 0, faltas_cometidas: 0, amarillas: 0, rojas: 0, atajadas: 0, offsides: 0, ...extra
  };
}

// Caso 1: muestra corta (33 min, 2 faltas, 1 amarilla) + un partido sin minutos.
const MUESTRA_CORTA = {
  jugador: { id: 101814, nombre: 'R. Araújo', foto: '', posicion: 'D', equipo: { id: 40, nombre: 'Liverpool' } },
  partidos: 3, partidos_jugados: 2, calificacion_promedio: 6.65,
  totales: { minutos: 33, goles: 0, asistencias: 0, tiros: 0, tiros_puerta: 0, pases: 30, pases_clave: 0, precision_pases: 27, entradas: 2, intercepciones: 1, duelos: 5, duelos_ganados: 3, regates: 0, regates_exitosos: 0, faltas_recibidas: 0, faltas_cometidas: 2, amarillas: 1, rojas: 0, atajadas: 0, offsides: 0, tarjetas: 1 },
  muestra: { minutos: 33, partidos: 3, partidos_jugados: 2, minutos_minimos: 270, suficiente: false },
  promedios_partido: { minutos: 16.5, goles: 0, asistencias: 0, tiros: 0, tiros_puerta: 0, pases: 15, pases_clave: 0, entradas: 1, intercepciones: 0.5, duelos: 2.5, duelos_ganados: 1.5, regates: 0, regates_exitosos: 0, faltas_recibidas: 0, faltas_cometidas: 1, amarillas: 0.5, rojas: 0, atajadas: 0, offsides: 0, tarjetas: 0.5 },
  promedios_90: { goles: 0, asistencias: 0, tiros: 0, tiros_puerta: 0, pases: 81.82, pases_clave: 0, entradas: 5.45, intercepciones: 2.73, duelos: 13.64, duelos_ganados: 8.18, regates: 0, regates_exitosos: 0, faltas_recibidas: 0, faltas_cometidas: 5.45, amarillas: 2.73, rojas: 0, atajadas: 0, offsides: 0, tarjetas: 2.73 },
  competiciones: [{ id: 39, nombre: 'Premier League', temporada: 2026 }],
  recientes: [
    actuacion({ partido_api_id: 3, fecha: '2026-09-01T19:00:00.000Z', rival: { id: 50, nombre: 'Manchester City' }, marcador: { propio: 0, rival: 0 }, local: false }),
    actuacion({ partido_api_id: 2, minutos: 13, calificacion: 6.09, faltas_cometidas: 2, amarillas: 1, entradas: 2, duelos: 4, duelos_ganados: 2, pases: 20, precision_pases: 18 }),
    actuacion({ partido_api_id: 1, fecha: '2026-08-23T19:00:00.000Z', rival: { id: 34, nombre: 'Newcastle' }, marcador: { propio: 3, rival: 2 }, local: false, minutos: 20, calificacion: 7.2, intercepciones: 1, duelos: 1, duelos_ganados: 1, pases: 10, precision_pases: 9 })
  ]
};

// Caso 2: muestra suficiente (1072 min).
const MUESTRA_LARGA = {
  ...MUESTRA_CORTA, partidos: 32, partidos_jugados: 24, calificacion_promedio: 6.9,
  totales: { ...MUESTRA_CORTA.totales, minutos: 1072, faltas_cometidas: 17, amarillas: 2, tarjetas: 2 },
  muestra: { minutos: 1072, partidos: 32, partidos_jugados: 24, minutos_minimos: 270, suficiente: true },
  promedios_partido: { ...MUESTRA_CORTA.promedios_partido, minutos: 44.67, faltas_cometidas: 0.71, amarillas: 0.08, tarjetas: 0.08 },
  promedios_90: { ...MUESTRA_CORTA.promedios_90, faltas_cometidas: 1.43, amarillas: 0.17, tarjetas: 0.17 }
};

function crearServidor() {
  return http.createServer((req, res) => {
    const ruta = req.url.split('?')[0];
    if (ruta.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (ruta.startsWith('/api/jugadores/1')) return res.end(JSON.stringify(MUESTRA_CORTA));
      if (ruta.startsWith('/api/jugadores/2')) return res.end(JSON.stringify(MUESTRA_LARGA));
      if (ruta.startsWith('/api/auth/me')) return res.end(JSON.stringify({ usuario: { email: 'smoke@staging.local', nombre: 'Smoke', rol: 'usuario', tieneAcceso: true, motivo: 'suscripcion_activa' } }));
      return res.end('{}');
    }
    const destino = path.join(RAIZ_PUBLICA, path.normalize(ruta === '/' ? '/inicio.html' : ruta));
    if (!destino.startsWith(RAIZ_PUBLICA) || !fs.existsSync(destino) || !fs.statSync(destino).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(destino)] || 'application/octet-stream' });
    fs.createReadStream(destino).pipe(res);
  });
}

async function comprobar(nombre, opcionesContexto, base) {
  const fallos = [];
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ baseURL: base, ...opcionesContexto });
  const pagina = await contexto.newPage();
  const erroresJs = [];
  pagina.on('pageerror', err => erroresJs.push(err.message));

  // ---- Muestra corta ----
  await pagina.goto('/jugador.html?id=1&league=39&season=2026', { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.player-matches tbody tr', { timeout: 15000 });

  const cabeceras = await pagina.locator('.player-matches thead th').allTextContents();
  for (const columna of ['FC', 'FR', 'Tarj.', 'Entr.', 'Int', 'Duelos', 'Regates', 'PC']) {
    if (!cabeceras.includes(columna)) fallos.push(`[${nombre}] falta la columna "${columna}" en partido a partido: ${JSON.stringify(cabeceras)}`);
  }
  const filas = await pagina.locator('.player-matches tbody tr').evaluateAll(nodos => nodos.map(nodo => ({
    dnp: nodo.classList.contains('player-row-dnp'),
    celdas: [...nodo.querySelectorAll('td')].map(td => td.textContent.trim()),
    amarillas: nodo.querySelectorAll('.card.yellow').length,
    rojas: nodo.querySelectorAll('.card.red').length
  })));
  if (filas.length !== 3) fallos.push(`[${nombre}] se esperaban 3 filas y hay ${filas.length}`);
  const sinMinutos = filas[0];
  if (!sinMinutos?.dnp || !/Sin minutos/.test(sinMinutos.celdas[1])) fallos.push(`[${nombre}] el partido sin minutos no se marca como tal: ${JSON.stringify(sinMinutos)}`);
  const conAmarilla = filas[1];
  if (conAmarilla?.celdas[8] !== '2') fallos.push(`[${nombre}] faltas cometidas del partido con amarilla: "${conAmarilla?.celdas[8]}" (esperado 2)`);
  if (conAmarilla?.amarillas !== 1 || conAmarilla?.rojas !== 0) fallos.push(`[${nombre}] tarjetas del partido: ${conAmarilla?.amarillas} amarillas / ${conAmarilla?.rojas} rojas`);
  if (!/2-1/.test(conAmarilla?.celdas[1] || '')) fallos.push(`[${nombre}] la fila no muestra el marcador 2-1: "${conAmarilla?.celdas[1]}"`);
  if (!/@ Newcastle/.test(filas[2]?.celdas[1] || '')) fallos.push(`[${nombre}] la visita no se marca con @: "${filas[2]?.celdas[1]}"`);

  const kpis = await pagina.locator('.player-kpis div span').allTextContents();
  for (const kpi of ['Faltas cometidas', 'Faltas recibidas', 'Amarillas', 'Rojas', 'Entradas', 'Intercepciones', 'Duelos ganados', 'Nota media', 'Jugados']) {
    if (!kpis.includes(kpi)) fallos.push(`[${nombre}] falta el KPI "${kpi}"`);
  }

  const aviso = pagina.locator('.sample-warning');
  if (!(await aviso.count())) fallos.push(`[${nombre}] no aparece el aviso de muestra corta con 33 minutos`);
  else {
    const texto = (await aviso.textContent()).replace(/\s+/g, ' ');
    if (!/33 min/.test(texto) || !/2\.73/.test(texto) || !/270/.test(texto)) fallos.push(`[${nombre}] el aviso no explica la extrapolación: "${texto}"`);
  }
  const filaTarjetas = await pagina.locator('.player-averages tbody tr', { hasText: 'Tarjetas' }).locator('td').allTextContents();
  if (JSON.stringify(filaTarjetas) !== JSON.stringify(['Tarjetas', '1', '0.50', '2.73'])) fallos.push(`[${nombre}] fila de tarjetas en promedios: ${JSON.stringify(filaTarjetas)}`);
  const filaFaltas = await pagina.locator('.player-averages tbody tr', { hasText: 'Faltas cometidas' }).locator('td').allTextContents();
  if (JSON.stringify(filaFaltas) !== JSON.stringify(['Faltas cometidas', '2', '1', '5.45'])) fallos.push(`[${nombre}] fila de faltas en promedios: ${JSON.stringify(filaFaltas)}`);
  const meta = await pagina.locator('#meta').textContent();
  if (!/2 de 3 partidos con minutos/.test(meta)) fallos.push(`[${nombre}] el encabezado no distingue convocados de jugados: "${meta}"`);

  const overflow = await pagina.evaluate(() => {
    const ancho = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= ancho + 2) return null;
    return [...document.querySelectorAll('body *')]
      .filter(el => el.getBoundingClientRect().right > ancho + 2 && !el.closest('.table-scroll'))
      .slice(0, 6).map(el => `${el.tagName.toLowerCase()}.${el.className}`).join(', ');
  });
  if (overflow !== null) fallos.push(`[${nombre}] overflow horizontal en la página: ${overflow || 'sin elemento identificable'}`);

  // ---- Muestra suficiente: sin aviso ----
  await pagina.goto('/jugador.html?id=2&league=140&season=2025', { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.player-averages tbody tr', { timeout: 15000 });
  if (await pagina.locator('.sample-warning').count()) fallos.push(`[${nombre}] aparece aviso de muestra corta con 1072 minutos`);
  if (!/1072 min en 24 partidos/.test(await pagina.locator('.player-averages ~ .method-note, aside .method-note').first().textContent())) fallos.push(`[${nombre}] la nota metodológica no describe la muestra`);

  for (const error of erroresJs) fallos.push(`[${nombre}] error JS: ${error}`);
  await navegador.close();
  return fallos;
}

(async () => {
  const servidor = crearServidor();
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const fallos = [
      ...(await comprobar('escritorio', { viewport: { width: 1366, height: 900 } }, base)),
      ...(await comprobar('móvil', { ...devices['iPhone 13'] }, base))
    ];
    if (fallos.length) {
      console.error(`Desglose de jugador FALLÓ con ${fallos.length} problema(s):`);
      for (const fallo of fallos) console.error(`  - ${fallo}`);
      process.exitCode = 1;
      return;
    }
    console.log('Desglose de jugador OK: faltas y tarjetas por partido, partidos sin minutos, total / por partido / por 90 y aviso de muestra corta (escritorio y móvil).');
  } finally {
    servidor.close();
  }
})().catch(error => {
  console.error(`Desglose de jugador abortado: ${error.message}`);
  process.exit(1);
});

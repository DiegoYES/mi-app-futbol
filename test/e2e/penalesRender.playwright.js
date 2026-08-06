#!/usr/bin/env node
// Validación Playwright del render de penales y prórroga.
//
// Es autocontenida a propósito: sirve `public/` con un servidor estático
// mínimo y responde toda llamada /api/ con fixtures en memoria. NO abre
// ninguna conexión a MongoDB ni consume API-Football, así que puede ejecutarse
// en cualquier máquina sin credenciales y sin riesgo para producción.
//
// Reproduce el caso reportado: Los Angeles FC 1-1 Guadalajara Chivas,
// resuelto 3-4 en la tanda, que el calendario mostraba como "Final 1 - 1".
//
// Uso: node test/e2e/penalesRender.playwright.js

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const RAIZ_PUBLICA = path.join(__dirname, '..', '..', 'public');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const HOY = new Date();
const FECHA_ISO = `${HOY.getFullYear()}-${String(HOY.getMonth() + 1).padStart(2, '0')}-${String(HOY.getDate()).padStart(2, '0')}`;

// Tres partidos que cubren los tres finales posibles.
const PARTIDOS = [
  {
    api_id: 9001, fecha: `${FECHA_ISO}T02:00:00.000Z`, hora: '20:00', estado: 'PEN', finalizado: true,
    jornada: 'Round of 16',
    penales: { local: 3, visitante: 4 }, goles_prorroga: { local: 0, visitante: 0 }, ganador_penales: 'visitante',
    local: { id: 1, nombre: 'Los Angeles FC', logo: '', goles: 1 },
    visitante: { id: 2, nombre: 'Guadalajara Chivas', logo: '', goles: 1 }
  },
  {
    api_id: 9002, fecha: `${FECHA_ISO}T04:00:00.000Z`, hora: '22:00', estado: 'AET', finalizado: true,
    jornada: 'Round of 16',
    penales: null, goles_prorroga: { local: 2, visitante: 0 }, ganador_penales: null,
    local: { id: 3, nombre: 'Toluca', logo: '', goles: 3 },
    visitante: { id: 4, nombre: 'Seattle Sounders', logo: '', goles: 1 }
  },
  {
    api_id: 9003, fecha: `${FECHA_ISO}T06:00:00.000Z`, hora: '23:00', estado: 'FT', finalizado: true,
    jornada: 'Round of 16',
    penales: null, goles_prorroga: null, ganador_penales: null,
    local: { id: 5, nombre: 'Monterrey', logo: '', goles: 1 },
    visitante: { id: 6, nombre: 'Orlando City SC', logo: '', goles: 2 }
  }
];

const COMPETICION = { liga_id: 16, liga: 'Leagues Cup', pais: 'CONCACAF', partidos: PARTIDOS };

function respuestaApi(ruta) {
  if (ruta.startsWith('/api/calendario/proximos')) {
    return {
      desde: FECHA_ISO, dias: 7, zona_horaria: 'America/Mexico_City', total: PARTIDOS.length,
      catalogo: [{ id: 16, nombre: 'Leagues Cup', pais: 'CONCACAF' }],
      jornadas: [{ fecha: FECHA_ISO, etiqueta: 'Hoy', total: PARTIDOS.length, competiciones: [COMPETICION] }]
    };
  }
  if (ruta.startsWith('/api/calendario/dia')) {
    return { fecha: FECHA_ISO, zona_horaria: 'America/Mexico_City', total: PARTIDOS.length, competiciones: [COMPETICION] };
  }
  if (ruta.startsWith('/api/calendario/rango')) return { desde: FECHA_ISO, hasta: FECHA_ISO };
  if (ruta.startsWith('/api/calendario/picks')) return { competiciones: [] };
  if (ruta.startsWith('/api/partidos/9001/estadisticas')) {
    return {
      fecha: PARTIDOS[0].fecha, estado: 'PEN',
      penales: { local: 3, visitante: 4 },
      goles_prorroga: { local: 0, visitante: 0 },
      ganador_penales: 'visitante',
      jornada: 'Round of 16', arbitro: null, liga: 'Leagues Cup', liga_id: 16, temporada: 2026,
      cobertura: { estadisticas: false, eventos: false, alineaciones: false },
      equipo_local: { id: 1, nombre: 'Los Angeles FC', logo: '', goles: 1 },
      equipo_visitante: { id: 2, nombre: 'Guadalajara Chivas', logo: '', goles: 1 },
      eventos: [], jugadores: [], jugador_destacado: null, mercados: {}
    };
  }
  if (ruta.startsWith('/api/auth/me') || ruta.startsWith('/api/auth/sesion')) {
    return { usuario: { email: 'smoke@staging.local', rol: 'usuario' } };
  }
  // El centro de partido compara ambos equipos; sin esta forma mínima el
  // comparador falla por datos ausentes del stub, no por el código bajo prueba.
  if (ruta.includes('/estadisticas-detalladas')) {
    return { info: { equipo: 'Equipo', liga: 'Leagues Cup' }, stats: { jugados: 0 }, partidos: [] };
  }
  if (ruta.startsWith('/api/equipos/h2h')) return { partidos: [], resumen: null };
  return {};
}

function crearServidor() {
  return http.createServer((req, res) => {
    const ruta = req.url.split('?')[0];

    if (ruta.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(respuestaApi(req.url)));
    }

    const nombre = ruta === '/' ? '/inicio.html' : ruta;
    // Sirve sólo dentro de public/: evita que una ruta con .. escape del árbol.
    const destino = path.join(RAIZ_PUBLICA, path.normalize(nombre));
    if (!destino.startsWith(RAIZ_PUBLICA) || !fs.existsSync(destino) || !fs.statSync(destino).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('no encontrado');
    }

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

  // ---------- Calendario ----------
  await pagina.goto('/calendario.html', { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.match', { timeout: 15000 });

  const filas = await pagina.locator('.match').evaluateAll(nodos => nodos.map(nodo => ({
    estado: nodo.querySelector('.hora')?.textContent.trim() || '',
    marcador: nodo.querySelector('.marcador')?.textContent.trim().replace(/\s+/g, ' ') || '',
    aria: nodo.querySelector('.marcador')?.getAttribute('aria-label') || '',
    equipos: [...nodo.querySelectorAll('.equipo span')].map(s => s.textContent.trim())
  })));

  const chivas = filas.find(f => f.equipos.includes('Guadalajara Chivas'));
  if (!chivas) {
    fallos.push(`[${nombre}] no se pintó el partido de Chivas en el calendario`);
  } else {
    if (chivas.estado !== 'Penales') fallos.push(`[${nombre}] estado del partido de penales: "${chivas.estado}" (esperado "Penales")`);
    if (!chivas.marcador.includes('1 - 1')) fallos.push(`[${nombre}] falta el marcador de 120': "${chivas.marcador}"`);
    if (!chivas.marcador.includes('(3 - 4 pen.)')) fallos.push(`[${nombre}] falta la tanda en el marcador: "${chivas.marcador}"`);
    if (!chivas.aria.includes('3 - 4 en penales')) fallos.push(`[${nombre}] aria-label sin la tanda: "${chivas.aria}"`);
  }

  const prorroga = filas.find(f => f.equipos.includes('Toluca'));
  if (!prorroga) fallos.push(`[${nombre}] no se pintó el partido de prórroga`);
  else {
    if (prorroga.estado !== 'Final (pró.)') fallos.push(`[${nombre}] estado AET: "${prorroga.estado}" (esperado "Final (pró.)")`);
    if (prorroga.marcador.includes('pen.')) fallos.push(`[${nombre}] un AET sin tanda no debe mostrar penales: "${prorroga.marcador}"`);
  }

  const normal = filas.find(f => f.equipos.includes('Monterrey'));
  if (!normal) fallos.push(`[${nombre}] no se pintó el partido normal`);
  else {
    if (normal.estado !== 'Final') fallos.push(`[${nombre}] estado FT: "${normal.estado}" (esperado "Final")`);
    if (normal.marcador.includes('pen.')) fallos.push(`[${nombre}] un FT no debe mostrar penales: "${normal.marcador}"`);
  }

  // ---------- Centro de partido ----------
  await pagina.goto('/partido.html?local=1&visitante=2&liga=16&partido=9001', { waitUntil: 'networkidle' });
  await pagina.waitForSelector('#cabecera .centro', { timeout: 15000 });
  const cabecera = (await pagina.locator('#cabecera .centro').textContent()).replace(/\s+/g, ' ').trim();

  if (!cabecera.includes('1 - 1')) fallos.push(`[${nombre}] centro de partido sin marcador de 120': "${cabecera}"`);
  if (!cabecera.includes('3 - 4 en penales')) fallos.push(`[${nombre}] centro de partido sin la tanda: "${cabecera}"`);
  if (!cabecera.includes('Definido en penales')) fallos.push(`[${nombre}] centro de partido no explica que se definió en penales: "${cabecera}"`);
  if (/\b4 - 3\b|\b1 - 5\b/.test(cabecera)) fallos.push(`[${nombre}] la tanda se sumó al marcador principal: "${cabecera}"`);

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
      console.error(`Render de penales FALLÓ con ${fallos.length} problema(s):`);
      for (const fallo of fallos) console.error(`  - ${fallo}`);
      process.exitCode = 1;
      return;
    }
    console.log('Render de penales OK: calendario y centro de partido distinguen penales, prórroga y final normal (escritorio y móvil).');
  } finally {
    servidor.close();
  }
})().catch(error => {
  console.error(`Render de penales abortado: ${error.message}`);
  process.exit(1);
});

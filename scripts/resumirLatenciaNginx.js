#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

function normalizarRuta(objetivo) {
  let ruta;
  try {
    ruta = new URL(objetivo, 'http://localhost').pathname;
  } catch {
    ruta = String(objetivo || '').split('?')[0];
  }
  const segmentos = ruta.split('/').map(segmento => {
    if (/^-?\d+$/.test(segmento)) return ':id';
    if (/^[a-f\d]{24}$/i.test(segmento)) return ':id';
    if (/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(segmento)) return ':id';
    if (/^[a-z\d_-]{20,}$/i.test(segmento) && !segmento.includes('.')) return ':token';
    return segmento;
  });
  return segmentos.join('/') || '/';
}

function sumarTiempos(valor) {
  if (!valor || valor === '-') return null;
  const tiempos = valor.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  return tiempos.length ? tiempos.reduce((total, item) => total + item, 0) : null;
}

function analizarLinea(linea) {
  const coincidencia = linea.match(
    /"([A-Z]+)\s+(\S+)\s+HTTP\/[^\"]+"\s+(\d{3})\s+\S+.*\srt=([0-9.]+)\s+urt=(.*?)\s+uaddr=(.*?)\s+ustatus=(.*?)\s*$/
  );
  if (!coincidencia) return null;
  const duracion = Number(coincidencia[4]);
  if (!Number.isFinite(duracion)) return null;
  return {
    metodo: coincidencia[1],
    ruta: normalizarRuta(coincidencia[2]),
    estado: Number(coincidencia[3]),
    duracion_ms: duracion * 1000,
    upstream_ms: sumarTiempos(coincidencia[5]) === null ? null : sumarTiempos(coincidencia[5]) * 1000,
    upstream: coincidencia[6]
  };
}

function percentil(ordenados, proporcion) {
  if (!ordenados.length) return 0;
  return ordenados[Math.max(0, Math.ceil(ordenados.length * proporcion) - 1)];
}

function redondear(valor) {
  return Number(valor.toFixed(2));
}

function resumir(filas) {
  const grupos = new Map();
  for (const fila of filas) {
    const clave = `${fila.metodo} ${fila.ruta}`;
    if (!grupos.has(clave)) grupos.set(clave, { duraciones: [], upstream: [], instancias: new Set(), errores5xx: 0 });
    const grupo = grupos.get(clave);
    grupo.duraciones.push(fila.duracion_ms);
    if (fila.upstream_ms !== null) grupo.upstream.push(fila.upstream_ms);
    if (fila.upstream && fila.upstream !== '-') grupo.instancias.add(fila.upstream);
    if (fila.estado >= 500) grupo.errores5xx += 1;
  }
  return [...grupos.entries()].map(([ruta, grupo]) => {
    const tiempos = grupo.duraciones.sort((a, b) => a - b);
    const upstreamPromedio = grupo.upstream.length
      ? grupo.upstream.reduce((total, item) => total + item, 0) / grupo.upstream.length
      : 0;
    return {
      ruta,
      solicitudes: tiempos.length,
      promedio_ms: redondear(tiempos.reduce((total, item) => total + item, 0) / tiempos.length),
      p95_ms: redondear(percentil(tiempos, 0.95)),
      p99_ms: redondear(percentil(tiempos, 0.99)),
      max_ms: redondear(tiempos.at(-1)),
      upstream_promedio_ms: redondear(upstreamPromedio),
      errores_5xx: grupo.errores5xx,
      instancias: [...grupo.instancias].sort().join(',') || '-'
    };
  }).sort((a, b) => b.p95_ms - a.p95_ms || b.solicitudes - a.solicitudes || a.ruta.localeCompare(b.ruta));
}

function opciones(argv) {
  let archivo = '/var/log/nginx/access.log';
  let limite = 25;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') json = true;
    else if (argv[i] === '--top') limite = Math.max(1, Number.parseInt(argv[++i], 10) || limite);
    else if (!argv[i].startsWith('--')) archivo = argv[i];
  }
  return { archivo, limite, json };
}

async function main() {
  const { archivo, limite, json } = opciones(process.argv.slice(2));
  const entrada = archivo === '-' ? process.stdin : fs.createReadStream(archivo, { encoding: 'utf8' });
  const lector = readline.createInterface({ input: entrada, crlfDelay: Infinity });
  const filas = [];
  for await (const linea of lector) {
    const fila = analizarLinea(linea);
    if (fila) filas.push(fila);
  }
  const resultado = resumir(filas).slice(0, limite);
  if (json) console.log(JSON.stringify({ lineas_con_tiempo: filas.length, rutas: resultado }, null, 2));
  else {
    console.log(`Líneas con métricas: ${filas.length}. Rutas más lentas por p95:`);
    console.table(resultado);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`No se pudo resumir el log: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { analizarLinea, normalizarRuta, percentil, resumir };

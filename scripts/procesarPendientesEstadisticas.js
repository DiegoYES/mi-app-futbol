require('dotenv').config({ quiet: true });

const axios = require('axios');
const https = require('https');
const mongoose = require('mongoose');
const Partido = require('../models/partido');
const { instalarControlCuotaAxios } = require('../services/apiQuota');
const { guardarDetalleFixture } = require('../services/fixtureDetail');
const { resolverCoberturaEstadisticas } = require('../services/statisticsCoverage');
const { invalidarCacheDatosPartidos } = require('../services/syncCache');

const CONFIRMACION = 'PROCESAR_ESTADISTICAS_SIN_BORRAR';
const cliente = axios.create({ baseURL: 'https://v3.football.api-sports.io', httpsAgent: new https.Agent({ family: 4 }), timeout: 30000 });
instalarControlCuotaAxios(cliente);

function numeroArg(nombre, defecto) {
  const valor = process.argv.find(arg => arg.startsWith(`--${nombre}=`))?.split('=')[1];
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : defecto;
}

function partir(items, tamano = 20) {
  const lotes = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

function filtroPendientes(ahora = new Date()) {
  return {
    fecha: { $gte: new Date(ahora.getTime() - 30 * 86400000), $lt: ahora },
    estado: { $in: ['FT', 'AET', 'PEN'] },
    estadisticas_completas: { $ne: true },
    estadisticas_no_disponibles: { $ne: true },
    $or: [{ estadisticas_intentos: { $lt: 3 } }, { estadisticas_intentos: { $exists: false } }]
  };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  const ejecutar = process.argv.includes('--execute');
  if (ejecutar && !process.env.API_FOOTBALL_KEY) throw new Error('Falta API_FOOTBALL_KEY.');
  const confirmacion = process.argv.find(arg => arg.startsWith('--confirm='))?.split('=').slice(1).join('=');
  if (ejecutar && confirmacion !== CONFIRMACION) throw new Error(`Para ejecutar usa --confirm=${CONFIRMACION}`);
  const maximo = Math.min(100, numeroArg('max-partidos', 100));

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const filtro = filtroPendientes();
    const total = await Partido.countDocuments(filtro);
    const partidos = await Partido.find(filtro).sort({ estadisticas_intentos: 1, fecha: 1 }).limit(maximo).lean();
    console.log(JSON.stringify({ modo: ejecutar ? 'execute' : 'dry-run', pendientes: total, seleccionados: partidos.length, llamadas_maximas: Math.ceil(partidos.length / 20) }, null, 2));
    if (!ejecutar || !partidos.length) return;

    let recibidos = 0;
    let completos = 0;
    let parciales = 0;
    for (const lote of partir(partidos)) {
      const porId = new Map(lote.map(partido => [partido.api_id, partido]));
      const { data } = await cliente.get('/fixtures', { params: { ids: lote.map(partido => partido.api_id).join('-') } });
      for (const detalle of data.response || []) {
        const partido = porId.get(detalle.fixture?.id);
        if (!partido) continue;
        const cobertura = await guardarDetalleFixture(detalle, partido);
        porId.delete(partido.api_id);
        recibidos++;
        if (cobertura.estadisticas) completos++;
        else parciales++;
      }
      for (const partido of porId.values()) {
        await Partido.updateOne({ api_id: partido.api_id }, { $set: resolverCoberturaEstadisticas(partido, false) });
        parciales++;
      }
    }
    await invalidarCacheDatosPartidos();
    console.log(JSON.stringify({ consultados: partidos.length, recibidos, completos, parciales, eliminados: 0 }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { CONFIRMACION, filtroPendientes, partir };

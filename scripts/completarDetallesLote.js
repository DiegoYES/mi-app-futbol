require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const axios = require('axios');
const https = require('https');
const Partido = require('../models/partido');
const config = require('../config/leagues');
const { guardarDetalleFixture } = require('../services/fixtureDetail');
const { instalarControlCuotaAxios } = require('../services/apiQuota');

const cliente = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  httpsAgent: new https.Agent({ family: 4 }),
  timeout: 30000
});
instalarControlCuotaAxios(cliente);

const TAMANO_LOTE = 20;
const RETARDO = Number(process.env.SYNC_DELAY_MS) >= 0
  ? Number(process.env.SYNC_DELAY_MS)
  : 7000;
const MAXIMO = Number.isInteger(Number(process.env.SYNC_MAX_REQUESTS))
  && Number(process.env.SYNC_MAX_REQUESTS) > 0
  ? Number(process.env.SYNC_MAX_REQUESTS)
  : Infinity;
const VERBOSE = /^(1|true|yes|si|sí)$/i.test(String(process.env.SYNC_VERBOSE || ''));
const REINTENTAR_HUECOS = /^(1|true|yes|si|sí)$/i.test(String(process.env.SYNC_RETRY_GAPS || ''));

function partir(items, tamano = TAMANO_LOTE) {
  const lotes = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

function esperar(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

async function completarLiga(leagueId, season) {
  const coberturaPendiente = REINTENTAR_HUECOS
    ? {
        $or: [
          { detalle_completo: { $ne: true } },
          { estadisticas_completas: { $ne: true } },
          { eventos_completos: { $ne: true } },
          { jugadores_completos: { $ne: true } }
        ]
      }
    : { detalle_completo: { $ne: true } };
  const pendientes = await Partido.find({
    'liga.id': leagueId,
    'liga.temporada': season,
    estado: { $in: ['FT', 'AET', 'PEN'] },
    ...coberturaPendiente
  }).sort({ fecha: -1 }).lean();
  const lotes = partir(pendientes).slice(0, MAXIMO);
  console.log(`⚽ ${config.ligas[leagueId]?.nombre || leagueId}: ${pendientes.length} partidos pendientes, ${lotes.length} llamada(s) de hasta ${TAMANO_LOTE}.`);

  let procesados = 0;
  let conEstadisticas = 0;
  let conEventos = 0;
  let conJugadores = 0;
  for (let indice = 0; indice < lotes.length; indice += 1) {
    if (indice > 0) await esperar(RETARDO);
    const lote = lotes[indice];
    const porId = new Map(lote.map(partido => [partido.api_id, partido]));
    const { data } = await cliente.get('/fixtures', {
      params: { ids: lote.map(partido => partido.api_id).join('-') }
    });
    for (const detalle of data.response || []) {
      const partido = porId.get(detalle.fixture?.id);
      if (!partido) continue;
      const resultado = await guardarDetalleFixture(detalle, partido);
      procesados += 1;
      if (resultado.estadisticas) conEstadisticas += 1;
      if (resultado.eventos) conEventos += 1;
      if (resultado.jugadores) conJugadores += 1;
      if (VERBOSE) console.log(`  ✓ ${partido.api_id}: stats ${resultado.estadisticas ? 'sí' : 'no'}, eventos ${resultado.eventos ? 'sí' : 'no'}, jugadores ${resultado.jugadores}`);
    }
    if (!VERBOSE) console.log(`  ✓ lote ${indice + 1}/${lotes.length}: ${lote.length} solicitados · ${data.response?.length || 0} recibidos`);
  }
  const resumen = { pendientes: pendientes.length, llamadas: lotes.length, procesados, conEstadisticas, conEventos, conJugadores };
  console.log(`  📊 ${JSON.stringify(resumen)}`);
  return resumen;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  if (!process.env.API_FOOTBALL_KEY) throw new Error('Falta API_FOOTBALL_KEY.');
  const season = Number(process.env.FOOTBALL_SEASON || config.seasonDefault);
  const ligas = (process.env.SYNC_LEAGUES || '39')
    .split(',').map(Number).filter(Number.isInteger);

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    console.log(`📦 Sincronización por lotes · temporada ${season} · máximo ${MAXIMO === Infinity ? 'cuota disponible' : MAXIMO + ' llamadas'}\n`);
    for (const liga of ligas) await completarLiga(liga, season);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    if (error.code === 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED') {
      console.error(`⚠️ ${error.message}`);
    } else {
      console.error(`❌ Sincronización fallida: ${error.message}`);
    }
    process.exitCode = 1;
  });
}

module.exports = { completarLiga, partir };

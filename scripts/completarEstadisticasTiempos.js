require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const axios = require('axios');
const https = require('https');
const Partido = require('../models/partido');
const config = require('../config/leagues');
const { instalarControlCuotaAxios } = require('../services/apiQuota');
instalarControlCuotaAxios(axios);

console.log('🔑 API Key cargada:', process.env.API_FOOTBALL_KEY ? 'Sí' : 'No');
console.log('🗄️ Mongo configurado:', process.env.MONGODB_URI ? 'Sí' : 'No');

const PETICIONES_MAXIMAS = Number.isInteger(Number(process.env.SYNC_MAX_REQUESTS))
  && Number(process.env.SYNC_MAX_REQUESTS) > 0
  ? Number(process.env.SYNC_MAX_REQUESTS)
  : Infinity;
const RETARDO = Number(process.env.SYNC_DELAY_MS) >= 0
  ? Number(process.env.SYNC_DELAY_MS)
  : 500;                         // 2 req/s, por debajo del límite Pro de 5 req/s
const TEMPORADA = Number(process.env.FOOTBALL_SEASON || config.seasonDefault);
let peticionesRealizadas = 0;
let detener = false;

const httpsAgent = new https.Agent({ family: 4 });

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Extrae un valor numérico de las estadísticas de un equipo
function obtenerValor(stats, tipo) {
  const stat = stats?.find(s => s.type === tipo);
  return parseInt(stat?.value) || 0;
}

async function completarTiemposLiga(leagueId) {
  // Buscar partidos que ya tengan estadísticas completas (tiros_total > 0) 
  // pero que aún NO tengan los datos de 1T y 2T
  const partidosFaltantes = await Partido.find({
    'liga.id': leagueId,
    'liga.temporada': TEMPORADA,
    estado: { $in: ['FT', 'AET', 'PEN'] },
    estadisticas_completas: true,
    tiempos_completos: { $ne: true }
  }).lean();

  console.log(`   ⚽ Liga ${leagueId}: ${partidosFaltantes.length} partidos sin datos por tiempo.`);

  for (let p of partidosFaltantes) {
    if (detener || peticionesRealizadas + 2 > PETICIONES_MAXIMAS) break;

    try {
      // Obtener 1T
      await esperar(RETARDO);
      const { data: data1 } = await axios.get('https://v3.football.api-sports.io/fixtures/statistics', {
        params: { fixture: p.api_id, half: '1st' },
        httpsAgent, timeout: 10000
      });
      peticionesRealizadas++;

      // Obtener 2T
      await esperar(RETARDO);
      const { data: data2 } = await axios.get('https://v3.football.api-sports.io/fixtures/statistics', {
        params: { fixture: p.api_id, half: '2nd' },
        httpsAgent, timeout: 10000
      });
      peticionesRealizadas++;

      const stats1T = data1.response;
      const stats2T = data2.response;

      const update = {};

      function rellenarHalf(halfKey, statsArray) {
        if (!statsArray) return;
        const homeStats = statsArray.find(s => s.team.id === p.equipo_local.id);
        const awayStats = statsArray.find(s => s.team.id === p.equipo_visitante.id);

        if (homeStats) {
          const s = homeStats.statistics;
          update[`equipo_local.${halfKey}.goles`] = halfKey === 'estadisticas_1t'
            ? (p.equipo_local.goles_primer_tiempo || 0)
            : Math.max(0, (p.equipo_local.goles || 0) - (p.equipo_local.goles_primer_tiempo || 0));
          update[`equipo_local.${halfKey}.tiros_total`] = obtenerValor(s, 'Total Shots');
          update[`equipo_local.${halfKey}.tiros_puerta`] = obtenerValor(s, 'Shots on Goal');
          update[`equipo_local.${halfKey}.corners`] = obtenerValor(s, 'Corner Kicks');
          update[`equipo_local.${halfKey}.faltas`] = obtenerValor(s, 'Fouls');
          update[`equipo_local.${halfKey}.tarjetas_amarillas`] = obtenerValor(s, 'Yellow Cards');
          update[`equipo_local.${halfKey}.tarjetas_rojas`] = obtenerValor(s, 'Red Cards');
          update[`equipo_local.${halfKey}.offsides`] = obtenerValor(s, 'Offsides');
        }
        if (awayStats) {
          const s = awayStats.statistics;
          update[`equipo_visitante.${halfKey}.goles`] = halfKey === 'estadisticas_1t'
            ? (p.equipo_visitante.goles_primer_tiempo || 0)
            : Math.max(0, (p.equipo_visitante.goles || 0) - (p.equipo_visitante.goles_primer_tiempo || 0));
          update[`equipo_visitante.${halfKey}.tiros_total`] = obtenerValor(s, 'Total Shots');
          update[`equipo_visitante.${halfKey}.tiros_puerta`] = obtenerValor(s, 'Shots on Goal');
          update[`equipo_visitante.${halfKey}.corners`] = obtenerValor(s, 'Corner Kicks');
          update[`equipo_visitante.${halfKey}.faltas`] = obtenerValor(s, 'Fouls');
          update[`equipo_visitante.${halfKey}.tarjetas_amarillas`] = obtenerValor(s, 'Yellow Cards');
          update[`equipo_visitante.${halfKey}.tarjetas_rojas`] = obtenerValor(s, 'Red Cards');
          update[`equipo_visitante.${halfKey}.offsides`] = obtenerValor(s, 'Offsides');
        }
      }

      rellenarHalf('estadisticas_1t', stats1T);
      rellenarHalf('estadisticas_2t', stats2T);

      if (Object.keys(update).length > 0) {
        update.tiempos_completos = true;
        await Partido.updateOne({ api_id: p.api_id }, { $set: update });
        console.log(`      ✅ Partido ${p.api_id} actualizado (1T/2T).`);
      }
    } catch (err) {
      if (err.code === 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED') {
        console.error('   ⚠️ Cupo diario seguro agotado. Deteniendo.');
        detener = true;
        break;
      } else if (err.response && err.response.status === 429) {
        console.error('   ⚠️ Límite de peticiones (HTTP 429). Deteniendo.');
        detener = true;
        break;
      } else {
        console.error(`   ❌ Error actualizando tiempos partido ${p.api_id}: ${err.message}`);
      }
    }
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado a MongoDB\n');

  const ligas = (process.env.SYNC_LEAGUES || '39').split(',').map(Number).filter(Number.isInteger);
  console.log(`📦 Temporada ${TEMPORADA} · máximo ${PETICIONES_MAXIMAS === Infinity ? 'cuota disponible' : PETICIONES_MAXIMAS + ' llamadas'} · pausa ${RETARDO} ms\n`);
  for (let leagueId of ligas) {
    if (detener || peticionesRealizadas >= PETICIONES_MAXIMAS) break;
    console.log(`📡 Completando tiempos en ${config.ligas[leagueId]?.nombre || leagueId}...`);
    await completarTiemposLiga(leagueId);
    if (!detener) {
      console.log('⏳ Pausa de 5 segundos...');
      await esperar(5000);
    }
  }

  console.log('\n🎉 Completado (o detenido por límite).');
  await mongoose.disconnect();
}

main().catch(console.error);

require('dotenv').config();
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
const RETARDO = 7000;
let peticionesRealizadas = 0;
let detener = false;

const httpsAgent = new https.Agent({ family: 4 });

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function completarLiga(leagueId) {
  const partidosFaltantes = await Partido.find({
    'liga.id': leagueId,
    'liga.temporada': Number(config.seasonDefault),
    estado: 'FT',
    estadisticas_completas: { $ne: true }
  }).lean();

  console.log(`   ⚽ Liga ${leagueId}: ${partidosFaltantes.length} partidos sin estadísticas.`);

  for (let p of partidosFaltantes) {
    if (detener || peticionesRealizadas >= PETICIONES_MAXIMAS) break;

    try {
      await esperar(RETARDO);
      const { data } = await axios.get('https://v3.football.api-sports.io/fixtures', {
        params: { id: p.api_id },
        httpsAgent,
        timeout: 10000
      });
      peticionesRealizadas++;

      const fullFixture = data.response[0];
      if (fullFixture && fullFixture.statistics) {
        const homeStats = fullFixture.statistics.find(s => s.team.id === p.equipo_local.id);
        const awayStats = fullFixture.statistics.find(s => s.team.id === p.equipo_visitante.id);

        const update = {};
        if (homeStats) {
          const s = homeStats.statistics;
          update['equipo_local.tiros_total'] = parseInt(s.find(x => x.type === 'Total Shots')?.value) || 0;
          update['equipo_local.tiros_puerta'] = parseInt(s.find(x => x.type === 'Shots on Goal')?.value) || 0;
          update['equipo_local.corners'] = parseInt(s.find(x => x.type === 'Corner Kicks')?.value) || 0;
          update['equipo_local.faltas'] = parseInt(s.find(x => x.type === 'Fouls')?.value) || 0;
          update['equipo_local.tarjetas_amarillas'] = parseInt(s.find(x => x.type === 'Yellow Cards')?.value) || 0;
          update['equipo_local.tarjetas_rojas'] = parseInt(s.find(x => x.type === 'Red Cards')?.value) || 0;
          update['equipo_local.offsides'] = parseInt(s.find(x => x.type === 'Offsides')?.value) || 0;
          update['equipo_local.entradas'] = parseInt(s.find(x => x.type === 'Tackles')?.value) || 0;
        }
        if (awayStats) {
          const s = awayStats.statistics;
          update['equipo_visitante.tiros_total'] = parseInt(s.find(x => x.type === 'Total Shots')?.value) || 0;
          update['equipo_visitante.tiros_puerta'] = parseInt(s.find(x => x.type === 'Shots on Goal')?.value) || 0;
          update['equipo_visitante.corners'] = parseInt(s.find(x => x.type === 'Corner Kicks')?.value) || 0;
          update['equipo_visitante.faltas'] = parseInt(s.find(x => x.type === 'Fouls')?.value) || 0;
          update['equipo_visitante.tarjetas_amarillas'] = parseInt(s.find(x => x.type === 'Yellow Cards')?.value) || 0;
          update['equipo_visitante.tarjetas_rojas'] = parseInt(s.find(x => x.type === 'Red Cards')?.value) || 0;
          update['equipo_visitante.offsides'] = parseInt(s.find(x => x.type === 'Offsides')?.value) || 0;
          update['equipo_visitante.entradas'] = parseInt(s.find(x => x.type === 'Tackles')?.value) || 0;
        }

        if (Object.keys(update).length > 0) {
          update.estadisticas_completas = true;
          await Partido.updateOne({ api_id: p.api_id }, { $set: update });
          console.log(`      ✅ Partido ${p.api_id} actualizado.`);
        }
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
        console.error(`   ❌ Error actualizando partido ${p.api_id}: ${err.message}`);
      }
    }
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado a MongoDB\n');

  const ligas = (process.env.SYNC_LEAGUES || '39').split(',').map(Number).filter(Number.isInteger);
  for (let leagueId of ligas) {
    if (detener || peticionesRealizadas >= PETICIONES_MAXIMAS) break;
    console.log(`📡 Completando ${config.ligas[leagueId]?.nombre || leagueId}...`);
    await completarLiga(leagueId);
    if (!detener) {
      console.log('⏳ Pausa de 5 segundos...');
      await esperar(5000);
    }
  }

  console.log('\n🎉 Completado (o detenido por límite).');
  await mongoose.disconnect();
}

main().catch(console.error);

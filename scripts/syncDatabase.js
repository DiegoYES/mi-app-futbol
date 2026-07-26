require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const https = require('https');
const apiService = require('../services/apiFootball');
const Partido = require('../models/partido');
const Equipo = require('../models/Equipo');
const config = require('../config/leagues');
const { instalarControlCuotaAxios } = require('../services/apiQuota');
instalarControlCuotaAxios(axios);

console.log('🔑 API Key cargada:', process.env.API_FOOTBALL_KEY ? 'Sí' : 'No');
console.log('🗄️ Mongo configurado:', process.env.MONGODB_URI ? 'Sí' : 'No');

const PETICIONES_MAXIMAS_DIA = Number.isInteger(Number(process.env.SYNC_MAX_REQUESTS))
  && Number(process.env.SYNC_MAX_REQUESTS) > 0
  ? Number(process.env.SYNC_MAX_REQUESTS)
  : Infinity; // el control compartido usa el límite real del proveedor
const RETARDO_ENTRE_DETALLES = 7000; // 7 segundos para respetar el límite por minuto
let peticionesRealizadas = 0;
let detenerPorLimite = false;

// Función para hacer una petición contabilizándola siempre
async function hacerPeticion(config) {
  if (detenerPorLimite || peticionesRealizadas >= PETICIONES_MAXIMAS_DIA) {
    detenerPorLimite = true;
    throw new Error('Límite de peticiones alcanzado, deteniendo.');
  }
  peticionesRealizadas++;
  return axios(config);
}

const httpsAgent = new https.Agent({ family: 4 });

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function completarPartidosPendientes(leagueId, season) {
  const pendientes = await Partido.find({
    'liga.id': leagueId,
    'liga.temporada': Number(season),
    estado: 'FT',
    estadisticas_completas: { $ne: true }
  }).lean();

  if (pendientes.length === 0) return;
  console.log(`   🔄 ${pendientes.length} partidos FT sin estadísticas en liga ${leagueId}, completando...`);

  for (let p of pendientes) {
    if (detenerPorLimite || peticionesRealizadas >= PETICIONES_MAXIMAS_DIA) break;
    await procesarDetallePartido(p.api_id, p.equipo_local.id, p.equipo_visitante.id);
  }
}

async function sincronizarEquipos(leagueId, season) {
  try {
    console.log(`   📋 Solicitando equipos de liga ${leagueId}...`);
    const response = await hacerPeticion({
      method: 'get',
      url: 'https://v3.football.api-sports.io/teams',
      params: { league: leagueId, season },
      httpsAgent,
      timeout: 10000
    });
    const equipos = response.data.response;
    for (let e of equipos) {
      await Equipo.updateOne(
        { api_id: e.team.id },
        {
          $set: {
            nombre: e.team.name,
            pais: e.team.country,
            logo: e.team.logo,
            fundacion: e.team.founded,
            estadio: {
              nombre: e.venue.name,
              capacidad: e.venue.capacity,
              ciudad: e.venue.city
            },
            ultima_actualizacion: new Date()
          },
          $setOnInsert: { api_id: e.team.id, liga: Number(leagueId) },
          $addToSet: { ligas: Number(leagueId) }
        },
        { upsert: true }
      );
    }
    console.log(`   ✅ ${equipos.length} equipos guardados.`);
    return equipos;
  } catch (err) {
    if (err.code === 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED') {
      console.error('   ⚠️ Cupo diario seguro agotado. Se detendrá la sincronización.');
      detenerPorLimite = true;
    } else if (err.response && err.response.status === 429) {
      console.error('   ⚠️ Límite de peticiones (HTTP 429). Se detendrá la sincronización.');
      detenerPorLimite = true;
    } else {
      console.error(`   ❌ Error equipos: ${err.message}`);
    }
    return [];
  }
}

async function sincronizarPartidos(leagueId, season) {
  try {
    console.log(`   ⚽ Solicitando partidos de liga ${leagueId}...`);
    const response = await hacerPeticion({
      method: 'get',
      url: 'https://v3.football.api-sports.io/fixtures',
      params: { league: leagueId, season },
      httpsAgent,
      timeout: 10000
    });
    const partidos = response.data.response || [];
    console.log(`   📦 Procesando ${partidos.length} partidos...`);

    for (let p of partidos) {
      const doc = {
        fecha: p.fixture.date,
        estado: p.fixture.status.short,
        arbitro: p.fixture.referee || null,
        liga: {
          id: leagueId,
          nombre: config.ligas[leagueId]?.nombre,
          temporada: season,
          jornada: p.league.round
        },
        equipo_local: {
          id: p.teams.home.id,
          nombre: p.teams.home.name,
          logo: p.teams.home.logo,
          goles: p.goals.home,
          goles_primer_tiempo: p.score?.halftime?.home ?? 0
        },
        equipo_visitante: {
          id: p.teams.away.id,
          nombre: p.teams.away.name,
          logo: p.teams.away.logo,
          goles: p.goals.away,
          goles_primer_tiempo: p.score?.halftime?.away ?? 0
        },
        total_goles: (p.goals.home ?? 0) + (p.goals.away ?? 0),
        ambos_anotan: p.goals.home > 0 && p.goals.away > 0,
        resultado: p.fixture.status.short === 'FT'
          ? (p.goals.home > p.goals.away ? 'local' : (p.goals.home < p.goals.away ? 'visitante' : 'empate'))
          : null
      };

      // Actualiza estado y marcador sin reemplazar las estadísticas avanzadas.
      await Partido.updateOne(
        { api_id: p.fixture.id },
        {
          $set: {
            fecha: doc.fecha,
            estado: doc.estado,
            arbitro: doc.arbitro,
            liga: doc.liga,
            'equipo_local.id': doc.equipo_local.id,
            'equipo_local.nombre': doc.equipo_local.nombre,
            'equipo_local.logo': doc.equipo_local.logo,
            'equipo_local.goles': doc.equipo_local.goles,
            'equipo_local.goles_primer_tiempo': doc.equipo_local.goles_primer_tiempo,
            'equipo_visitante.id': doc.equipo_visitante.id,
            'equipo_visitante.nombre': doc.equipo_visitante.nombre,
            'equipo_visitante.logo': doc.equipo_visitante.logo,
            'equipo_visitante.goles': doc.equipo_visitante.goles,
            'equipo_visitante.goles_primer_tiempo': doc.equipo_visitante.goles_primer_tiempo,
            total_goles: doc.total_goles,
            ambos_anotan: doc.ambos_anotan,
            resultado: doc.resultado,
            fecha_actualizacion: new Date()
          },
          $setOnInsert: { api_id: p.fixture.id }
        },
        { upsert: true }
      );

      // Si es FT y no tiene stats, procesamos el detalle
      if (p.fixture.status.short === 'FT') {
        await procesarDetallePartido(p.fixture.id, p.teams.home.id, p.teams.away.id);
      }
    }
    console.log(`   ✅ ${partidos.length} partidos procesados.`);
  } catch (err) {
    if (err.code === 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED') {
      console.error('   ⚠️ Cupo diario seguro agotado. Deteniendo.');
      detenerPorLimite = true;
    } else if (err.response && err.response.status === 429) {
      console.error('   ⚠️ Límite de peticiones (HTTP 429). Deteniendo.');
      detenerPorLimite = true;
    } else if (err.message.includes('Límite de peticiones alcanzado')) {
      console.error('   ⚠️ Límite diario autoimpuesto alcanzado.');
    } else {
      console.error(`   ❌ Error partidos: ${err.message}`);
    }
  }
}

async function procesarDetallePartido(fixtureId, homeTeamId, awayTeamId) {
  if (detenerPorLimite || peticionesRealizadas >= PETICIONES_MAXIMAS_DIA) return;

  // Verificar si ya tiene estadísticas completas
  const yaCompleto = await Partido.findOne({ api_id: fixtureId, estadisticas_completas: true }).lean();
  if (yaCompleto) return;

  try {
    await esperar(RETARDO_ENTRE_DETALLES);
    const detailResponse = await hacerPeticion({
      method: 'get',
      url: 'https://v3.football.api-sports.io/fixtures',
      params: { id: fixtureId },
      httpsAgent,
      timeout: 10000
    });
    const fullFixture = detailResponse.data.response[0];
    if (!fullFixture?.statistics) return;

    const homeStats = fullFixture.statistics.find(s => s.team.id === homeTeamId);
    const awayStats = fullFixture.statistics.find(s => s.team.id === awayTeamId);
    const update = { estadisticas_completas: true };

    function extraerStats(statsObj, prefijo) {
      const s = statsObj.statistics;
      update[`${prefijo}.tiros_total`] = parseInt(s.find(x => x.type === 'Total Shots')?.value) || 0;
      update[`${prefijo}.tiros_puerta`] = parseInt(s.find(x => x.type === 'Shots on Goal')?.value) || 0;
      update[`${prefijo}.corners`] = parseInt(s.find(x => x.type === 'Corner Kicks')?.value) || 0;
      update[`${prefijo}.faltas`] = parseInt(s.find(x => x.type === 'Fouls')?.value) || 0;
      update[`${prefijo}.tarjetas_amarillas`] = parseInt(s.find(x => x.type === 'Yellow Cards')?.value) || 0;
      update[`${prefijo}.tarjetas_rojas`] = parseInt(s.find(x => x.type === 'Red Cards')?.value) || 0;
      update[`${prefijo}.offsides`] = parseInt(s.find(x => x.type === 'Offsides')?.value) || 0;
    }

    if (homeStats) extraerStats(homeStats, 'equipo_local');
    if (awayStats) extraerStats(awayStats, 'equipo_visitante');

    await Partido.updateOne({ api_id: fixtureId }, { $set: update });
    console.log(`      ✅ Stats completas: partido ${fixtureId}`);
  } catch (e) {
    if (e.code === 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED') {
      console.error('   ⚠️ Cupo diario seguro agotado. Deteniendo.');
      detenerPorLimite = true;
    } else if (e.response?.status === 429) {
      console.error('   ⚠️ Límite por minuto (HTTP 429). Deteniendo.');
      detenerPorLimite = true;
    } else {
      console.error(`   ⚠️ Error detalle partido ${fixtureId}: ${e.message}`);
    }
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado a MongoDB\n');

  const ligasExistentes = await Partido.distinct('liga.id', {
    'liga.temporada': Number(config.seasonDefault)
  });
  const ligas = (process.env.SYNC_LEAGUES
    ? process.env.SYNC_LEAGUES.split(',').map(id => id.trim()).filter(Boolean)
    : ligasExistentes.map(String))
    .filter(id => config.ligas[id]);
  console.log(`🚀 Sincronizando ${ligas.length} ligas...`);

  for (let i = 0; i < ligas.length; i++) {
    if (detenerPorLimite || peticionesRealizadas >= PETICIONES_MAXIMAS_DIA) {
      console.log(`\n⚠️ Deteniendo sincronización.`);
      break;
    }

    const leagueId = ligas[i];
    const season = config.seasonDefault;
    const nombre = config.ligas[leagueId].nombre;

    console.log(`\n📡 ${nombre} (${leagueId})`);

    // Refrescamos el listado cada ejecución: una liga puede existir en MongoDB
    // pero pertenecer a otra temporada o contener fixtures aún no finalizados.
    await sincronizarEquipos(leagueId, season);
    if (detenerPorLimite) continue;
    await sincronizarPartidos(leagueId, season);
    if (!detenerPorLimite) await completarPartidosPendientes(leagueId, season);

    if (!detenerPorLimite) {
      console.log('⏳ Pausa de 5 segundos...');
      await esperar(5000);
    }
  }

  console.log('\n🎉 Sincronización finalizada (o detenida por límites).');
  await mongoose.disconnect();
}

main().catch(console.error);

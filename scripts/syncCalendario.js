require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const https = require('https');
const Partido = require('../models/partido');
const config = require('../config/leagues');
const { instalarControlCuotaAxios, obtenerApiKeys } = require('../services/apiQuota');
instalarControlCuotaAxios(axios);

const httpsAgent = new https.Agent({ family: 4 });
const LIGAS_SEGUIDAS = new Set(Object.keys(config.ligas).map(Number));

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatearFecha(fecha) {
  return fecha.toISOString().slice(0, 10);
}

// Construye la lista de fechas UTC a consultar. Por defecto se incluyen ayer y
// hoy porque un día de México/Sudamérica cruza la medianoche UTC.
function resolverFechas(args = process.argv.slice(2), hoy = new Date()) {

  const argFecha = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (argFecha) return [argFecha];

  const argDias = args.find(a => /^--dias=\d+$/.test(a));
  if (argDias) {
    const dias = parseInt(argDias.split('=')[1]);
    return Array.from({ length: Math.min(dias, 10) }, (_, i) => {
      const f = new Date(hoy);
      f.setUTCDate(hoy.getUTCDate() + i);
      return formatearFecha(f);
    });
  }

  return [-1, 0].map(desplazamiento => {
    const f = new Date(hoy);
    f.setUTCDate(hoy.getUTCDate() + desplazamiento);
    return formatearFecha(f);
  });
}

async function sincronizarFecha(fecha) {
  console.log(`\n📅 Consultando partidos del ${fecha}...`);

  const { data } = await axios.get('https://v3.football.api-sports.io/fixtures', {
    params: { date: fecha },
    httpsAgent,
    timeout: 15000
  });

  const todos = data.response || [];
  const relevantes = todos.filter(f => LIGAS_SEGUIDAS.has(f.league?.id));

  console.log(`   🌍 ${todos.length} partidos en el mundo, ${relevantes.length} de tus ligas.`);

  let nuevos = 0;
  let actualizados = 0;
  const finalizados = [];

  for (const f of relevantes) {
    const finalizado = ['FT', 'AET', 'PEN'].includes(f.fixture.status.short);

    const doc = {
      api_id: f.fixture.id,
      fecha: f.fixture.date,
      estado: f.fixture.status.short,
      arbitro: f.fixture.referee || null,
      minuto_juego: f.fixture.status.elapsed || 0,
      liga: {
        id: f.league.id,
        nombre: config.ligas[f.league.id]?.nombre || f.league.name,
        temporada: f.league.season,
        jornada: f.league.round
      },
      'equipo_local.id': f.teams.home.id,
      'equipo_local.nombre': f.teams.home.name,
      'equipo_local.logo': f.teams.home.logo,
      'equipo_local.goles': f.goals.home,
      'equipo_local.goles_primer_tiempo': f.score?.halftime?.home ?? 0,
      'equipo_visitante.id': f.teams.away.id,
      'equipo_visitante.nombre': f.teams.away.name,
      'equipo_visitante.logo': f.teams.away.logo,
      'equipo_visitante.goles': f.goals.away,
      'equipo_visitante.goles_primer_tiempo': f.score?.halftime?.away ?? 0,
      fecha_actualizacion: new Date()
    };

    if (finalizado) {
      doc.total_goles = (f.goals.home ?? 0) + (f.goals.away ?? 0);
      doc.ambos_anotan = f.goals.home > 0 && f.goals.away > 0;
      doc.resultado = f.goals.home > f.goals.away
        ? 'local'
        : (f.goals.home < f.goals.away ? 'visitante' : 'empate');
      finalizados.push({ api_id: f.fixture.id, homeId: f.teams.home.id, awayId: f.teams.away.id });
    }

    const resultado = await Partido.updateOne({ api_id: f.fixture.id }, { $set: doc }, { upsert: true });
    if (resultado.upsertedCount) nuevos++;
    else if (resultado.modifiedCount) actualizados++;
  }

  console.log(`   ✅ ${nuevos} nuevos, ${actualizados} actualizados.`);
  return { total: relevantes.length, finalizados };
}

async function completarEstadisticasDePartidos(finalizados) {
  // Filtra los que ya tienen estadísticas o están marcados como no disponibles
  const apiIds = finalizados.map(f => f.api_id);
  const sinStats = await Partido.find(
    { api_id: { $in: apiIds }, estadisticas_completas: { $ne: true }, estadisticas_no_disponibles: { $ne: true } },
    { api_id: 1 }
  ).lean();

  if (!sinStats.length) {
    console.log('\n📊 Todos los partidos finalizados ya tienen estadísticas.');
    return;
  }

  const pendientes = new Set(sinStats.map(p => p.api_id));
  const porCompletar = finalizados.filter(f => pendientes.has(f.api_id));
  console.log(`\n📊 Completando estadísticas de ${porCompletar.length} partidos finalizados...`);

  const RETARDO_STATS = Number(process.env.SYNC_DELAY_MS) >= 0 ? Number(process.env.SYNC_DELAY_MS) : 500;
  let completados = 0;
  let sinDisponibles = 0;

  for (const p of porCompletar) {
    try {
      await esperar(RETARDO_STATS);
      const { data } = await axios.get('https://v3.football.api-sports.io/fixtures', {
        params: { id: p.api_id },
        httpsAgent,
        timeout: 10000
      });

      const fullFixture = data.response?.[0];
      const stats = fullFixture?.statistics || [];
      const homeStats = stats.find(s => s.team.id === p.homeId);
      const awayStats = stats.find(s => s.team.id === p.awayId);

      const update = {};
      if (homeStats) {
        const s = homeStats.statistics;
        update['equipo_local.tiros_total']         = parseInt(s.find(x => x.type === 'Total Shots')?.value)  || 0;
        update['equipo_local.tiros_puerta']         = parseInt(s.find(x => x.type === 'Shots on Goal')?.value) || 0;
        update['equipo_local.corners']              = parseInt(s.find(x => x.type === 'Corner Kicks')?.value)  || 0;
        update['equipo_local.faltas']               = parseInt(s.find(x => x.type === 'Fouls')?.value)         || 0;
        update['equipo_local.tarjetas_amarillas']   = parseInt(s.find(x => x.type === 'Yellow Cards')?.value)  || 0;
        update['equipo_local.tarjetas_rojas']       = parseInt(s.find(x => x.type === 'Red Cards')?.value)     || 0;
        update['equipo_local.offsides']             = parseInt(s.find(x => x.type === 'Offsides')?.value)      || 0;
      }
      if (awayStats) {
        const s = awayStats.statistics;
        update['equipo_visitante.tiros_total']       = parseInt(s.find(x => x.type === 'Total Shots')?.value)  || 0;
        update['equipo_visitante.tiros_puerta']      = parseInt(s.find(x => x.type === 'Shots on Goal')?.value) || 0;
        update['equipo_visitante.corners']           = parseInt(s.find(x => x.type === 'Corner Kicks')?.value)  || 0;
        update['equipo_visitante.faltas']            = parseInt(s.find(x => x.type === 'Fouls')?.value)         || 0;
        update['equipo_visitante.tarjetas_amarillas']= parseInt(s.find(x => x.type === 'Yellow Cards')?.value)  || 0;
        update['equipo_visitante.tarjetas_rojas']   = parseInt(s.find(x => x.type === 'Red Cards')?.value)     || 0;
        update['equipo_visitante.offsides']         = parseInt(s.find(x => x.type === 'Offsides')?.value)      || 0;
      }

      if (Object.keys(update).length > 0) {
        update.estadisticas_completas = true;
        await Partido.updateOne({ api_id: p.api_id }, { $set: update });
        completados++;
        console.log(`   ✅ ${p.api_id} con estadísticas.`);
      } else {
        await Partido.updateOne({ api_id: p.api_id }, { $set: { estadisticas_no_disponibles: true }, $inc: { estadisticas_intentos: 1 } });
        sinDisponibles++;
      }
    } catch (err) {
      if (err.code === 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED') {
        console.error('   ⚠️ Cupo diario seguro agotado. Deteniendo estadísticas.');
        break;
      } else if (err.response?.status === 429) {
        console.error('   ⚠️ Límite de peticiones (HTTP 429). Deteniendo estadísticas.');
        break;
      } else {
        console.error(`   ❌ Error en partido ${p.api_id}: ${err.message}`);
      }
    }
  }

  console.log(`   ✅ ${completados} completados · 🚫 ${sinDisponibles} sin estadísticas disponibles.`);
}

function obtenerValor(stats, tipo, valorNulo = 0) {
  const stat = stats?.find(s => s.type === tipo);
  if (stat?.value === null || stat?.value === undefined || stat?.value === '') return valorNulo;
  const valor = Number.parseFloat(String(stat.value).replace('%', ''));
  return Number.isFinite(valor) ? valor : valorNulo;
}

async function completarTiemposDePartidos(finalizados) {
  const apiIds = finalizados.map(f => f.api_id);
  const sinTiempos = await Partido.find(
    { api_id: { $in: apiIds }, estadisticas_completas: true, tiempos_completos: { $ne: true }, tiempos_disponibles: { $ne: false } },
    { api_id: 1, equipo_local: 1, equipo_visitante: 1 }
  ).lean();

  if (!sinTiempos.length) {
    console.log('\n⏱️  Todos los partidos finalizados ya tienen datos por tiempo.');
    return;
  }

  console.log(`\n⏱️  Completando estadísticas 1T/2T de ${sinTiempos.length} partidos...`);

  const RETARDO_TIEMPOS = Number(process.env.SYNC_DELAY_MS) >= 0 ? Number(process.env.SYNC_DELAY_MS) : 500;
  let completados = 0;
  let sinCobertura = 0;

  for (const p of sinTiempos) {
    try {
      await esperar(RETARDO_TIEMPOS);
      const { data } = await axios.get('https://v3.football.api-sports.io/fixtures/statistics', {
        params: { fixture: p.api_id, half: true },
        httpsAgent,
        timeout: 10000
      });

      const respuesta = data.response || [];
      const stats1T = respuesta.map(item => ({ team: item.team, statistics: item.statistics_1h || [] }));
      const stats2T = respuesta.map(item => ({ team: item.team, statistics: item.statistics_2h || [] }));
      const tieneAmbosTiempos = stats1T.length === 2 && stats2T.length === 2
        && stats1T.every(i => i.statistics.length) && stats2T.every(i => i.statistics.length);

      if (!tieneAmbosTiempos) {
        await Partido.updateOne({ api_id: p.api_id }, { $set: { tiempos_consultados_en: new Date(), tiempos_disponibles: false } });
        sinCobertura++;
        continue;
      }

      const update = {};
      function rellenarHalf(halfKey, statsArray) {
        const homeStats = statsArray.find(s => s.team.id === p.equipo_local.id);
        const awayStats = statsArray.find(s => s.team.id === p.equipo_visitante.id);
        if (homeStats) {
          const s = homeStats.statistics;
          update[`equipo_local.${halfKey}.goles`] = halfKey === 'estadisticas_1t'
            ? (p.equipo_local.goles_primer_tiempo || 0)
            : Math.max(0, (p.equipo_local.goles || 0) - (p.equipo_local.goles_primer_tiempo || 0));
          update[`equipo_local.${halfKey}.tiros_total`]       = obtenerValor(s, 'Total Shots');
          update[`equipo_local.${halfKey}.tiros_puerta`]      = obtenerValor(s, 'Shots on Goal');
          update[`equipo_local.${halfKey}.corners`]           = obtenerValor(s, 'Corner Kicks');
          update[`equipo_local.${halfKey}.faltas`]            = obtenerValor(s, 'Fouls', null);
          update[`equipo_local.${halfKey}.tarjetas_amarillas`]= obtenerValor(s, 'Yellow Cards');
          update[`equipo_local.${halfKey}.tarjetas_rojas`]    = obtenerValor(s, 'Red Cards');
          update[`equipo_local.${halfKey}.offsides`]          = obtenerValor(s, 'Offsides');
        }
        if (awayStats) {
          const s = awayStats.statistics;
          update[`equipo_visitante.${halfKey}.goles`] = halfKey === 'estadisticas_1t'
            ? (p.equipo_visitante.goles_primer_tiempo || 0)
            : Math.max(0, (p.equipo_visitante.goles || 0) - (p.equipo_visitante.goles_primer_tiempo || 0));
          update[`equipo_visitante.${halfKey}.tiros_total`]       = obtenerValor(s, 'Total Shots');
          update[`equipo_visitante.${halfKey}.tiros_puerta`]      = obtenerValor(s, 'Shots on Goal');
          update[`equipo_visitante.${halfKey}.corners`]           = obtenerValor(s, 'Corner Kicks');
          update[`equipo_visitante.${halfKey}.faltas`]            = obtenerValor(s, 'Fouls', null);
          update[`equipo_visitante.${halfKey}.tarjetas_amarillas`]= obtenerValor(s, 'Yellow Cards');
          update[`equipo_visitante.${halfKey}.tarjetas_rojas`]    = obtenerValor(s, 'Red Cards');
          update[`equipo_visitante.${halfKey}.offsides`]          = obtenerValor(s, 'Offsides');
        }
      }

      rellenarHalf('estadisticas_1t', stats1T);
      rellenarHalf('estadisticas_2t', stats2T);

      if (Object.keys(update).length > 0) {
        update.tiempos_completos = true;
        update.tiempos_disponibles = true;
        update.tiempos_consultados_en = new Date();
        await Partido.updateOne({ api_id: p.api_id }, { $set: update });
        completados++;
        console.log(`   ✅ ${p.api_id} con 1T/2T.`);
      }
    } catch (err) {
      if (err.code === 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED') {
        console.error('   ⚠️ Cupo diario seguro agotado. Deteniendo tiempos.');
        break;
      } else if (err.response?.status === 429) {
        console.error('   ⚠️ HTTP 429. Deteniendo tiempos.');
        break;
      } else {
        console.error(`   ❌ Error en partido ${p.api_id}: ${err.message}`);
      }
    }
  }

  console.log(`   ✅ ${completados} con 1T/2T · 🚫 ${sinCobertura} sin cobertura.`);
}

async function main() {
  if (obtenerApiKeys().length === 0) {
    console.error('❌ Falta API_FOOTBALL_KEY (o API_FOOTBALL_KEY_2 / API_FOOTBALL_KEYS) en el .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado a MongoDB');

  const fechas = resolverFechas();
  console.log(`🗓️ Se consultarán ${fechas.length} fecha(s) → ${fechas.length} petición(es) a la API.`);

  const todosFinalizados = [];
  for (const fecha of fechas) {
    try {
      const { finalizados } = await sincronizarFecha(fecha);
      todosFinalizados.push(...finalizados);
    } catch (err) {
      if (err.code === 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED') {
        console.error('⚠️ Cupo diario seguro agotado. Deteniendo.');
        break;
      }
      if (err.response?.status === 429) {
        console.error('⚠️ Límite de peticiones alcanzado. Deteniendo.');
        break;
      }
      console.error(`❌ Error en ${fecha}: ${err.message}`);
    }
    if (fechas.length > 1) await esperar(7000);
  }

  await completarEstadisticasDePartidos(todosFinalizados);
  await completarTiemposDePartidos(todosFinalizados);

  console.log('\n🎉 Calendario sincronizado.');
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async err => {
    console.error('❌ Error:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = { formatearFecha, resolverFechas, sincronizarFecha };

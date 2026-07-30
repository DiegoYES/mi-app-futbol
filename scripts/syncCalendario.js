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
    }

    const resultado = await Partido.updateOne({ api_id: f.fixture.id }, { $set: doc }, { upsert: true });
    if (resultado.upsertedCount) nuevos++;
    else if (resultado.modifiedCount) actualizados++;
  }

  console.log(`   ✅ ${nuevos} nuevos, ${actualizados} actualizados.`);
  return relevantes.length;
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

  for (const fecha of fechas) {
    try {
      await sincronizarFecha(fecha);
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

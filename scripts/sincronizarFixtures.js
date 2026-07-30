require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const axios = require('axios');
const https = require('https');
const Partido = require('../models/partido');
const Equipo = require('../models/Equipo');
const config = require('../config/leagues');
const { instalarControlCuotaAxios } = require('../services/apiQuota');
const { documentoEquipo, documentoFixture, ESTADOS_FINALIZADOS } = require('../services/fixtureCatalog');

const cliente = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  httpsAgent: new https.Agent({ family: 4 }),
  timeout: 30000
});
instalarControlCuotaAxios(cliente);

const temporada = Number(process.env.FOOTBALL_SEASON || config.seasonDefault);
const ligas = (process.env.SYNC_LEAGUES || '262').split(',').map(Number).filter(Number.isInteger);
const retraso = Number.isFinite(Number(process.env.SYNC_DELAY_MS)) ? Math.max(0, Number(process.env.SYNC_DELAY_MS)) : 1000;
const esperar = ms => ms ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();

async function sincronizarLiga(leagueId) {
  const nombre = config.ligas[leagueId]?.nombre || String(leagueId);
  console.log(`\n📡 ${nombre} · temporada API ${temporada}`);
  const [{ data: datosEquipos }, { data: datosFixtures }] = await Promise.all([
    cliente.get('/teams', { params: { league: leagueId, season: temporada } }),
    cliente.get('/fixtures', { params: { league: leagueId, season: temporada } })
  ]);
  const equipos = datosEquipos.response || [];
  const fixtures = datosFixtures.response || [];
  if (!equipos.length && !fixtures.length) {
    console.log(`   ↷ sin equipos ni fixtures disponibles; se continúa con la siguiente liga.`);
    return { leagueId, nombre, temporada, equipos: 0, fixtures: 0, finalizados: 0 };
  }

  if (equipos.length) {
    await Equipo.bulkWrite(equipos.map(item => ({ updateOne: {
      filter: { api_id: item.team.id },
      update: {
        $set: documentoEquipo(item, leagueId),
        $setOnInsert: { api_id: item.team.id },
        $addToSet: { ligas: leagueId }
      },
      upsert: true
    } })));
  }
  if (fixtures.length) {
    await Partido.bulkWrite(fixtures.map(item => ({ updateOne: {
      filter: { api_id: item.fixture.id },
      update: {
        $set: documentoFixture(item, config.ligas)
      },
      upsert: true
    } })));
  }
  const finalizados = fixtures.filter(item => ESTADOS_FINALIZADOS.has(item.fixture.status.short)).length;
  console.log(`   ✓ ${equipos.length} equipos · ${fixtures.length} fixtures · ${finalizados} finalizados`);
  return { leagueId, nombre, temporada, equipos: equipos.length, fixtures: fixtures.length, finalizados };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  if (!Number.isInteger(temporada)) throw new Error('FOOTBALL_SEASON debe ser un año válido.');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const resumen = [];
    for (let indice = 0; indice < ligas.length; indice += 1) {
      if (indice) await esperar(retraso);
      resumen.push(await sincronizarLiga(ligas[indice]));
    }
    console.log(`\n${JSON.stringify({ llamadas_estimadas: ligas.length * 2, resumen }, null, 2)}`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().catch(error => {
  console.error(`❌ Sincronización de fixtures fallida: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { sincronizarLiga };

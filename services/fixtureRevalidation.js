const axios = require('axios');
const https = require('https');
const Partido = require('../models/partido');
const { instalarControlCuotaAxios } = require('./apiQuota');
const { documentoFixture, ESTADOS_FINALIZADOS } = require('./fixtureCatalog');
const { guardarDetalleFixture } = require('./fixtureDetail');
const { invalidarCacheDatosPartidos } = require('./syncCache');

const cliente = axios.create({ baseURL: 'https://v3.football.api-sports.io', httpsAgent: new https.Agent({ family: 4 }), timeout: 30000 });
instalarControlCuotaAxios(cliente);

async function revalidarPartidoPorId(apiId) {
  const partido = await Partido.findOne({ api_id: apiId }).lean();
  if (!partido) return { encontrado: false };
  const { data } = await cliente.get('/fixtures', { params: { id: apiId } });
  const fixture = data.response?.[0];
  if (!fixture) {
    await Partido.updateOne({ api_id: apiId }, { $set: { estado_consultado_en: new Date() } });
    return { encontrado: true, recibido: false, estado_anterior: partido.estado };
  }
  const cambios = { ...documentoFixture(fixture), estado_consultado_en: new Date() };
  await Partido.updateOne({ api_id: apiId }, { $set: cambios });
  if (ESTADOS_FINALIZADOS.has(fixture.fixture.status.short)) await guardarDetalleFixture(fixture, partido);
  await invalidarCacheDatosPartidos();
  return { encontrado: true, recibido: true, estado_anterior: partido.estado, estado: fixture.fixture.status.short };
}

module.exports = { revalidarPartidoPorId };

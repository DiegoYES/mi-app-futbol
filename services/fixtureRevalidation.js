const axios = require('axios');
const https = require('https');
const Partido = require('../models/partido');
const { instalarControlCuotaAxios } = require('./apiQuota');
const { documentoFixture, ESTADOS_FINALIZADOS } = require('./fixtureCatalog');
const { guardarDetalleFixture } = require('./fixtureDetail');
const { invalidarCacheDatosPartidos } = require('./syncCache');
const { filtroPartidosPasadosSinResultado } = require('./dataQuality');

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
  let cobertura = null;
  if (ESTADOS_FINALIZADOS.has(fixture.fixture.status.short)) {
    cobertura = await guardarDetalleFixture(fixture, partido);
    if (cobertura.estadisticas) {
      await Partido.updateOne({ api_id: apiId }, { $set: { estadisticas_no_disponibles: false } });
    } else {
      const intentos = (partido.estadisticas_intentos || 0) + 1;
      await Partido.updateOne({ api_id: apiId }, { $set: { estadisticas_intentos: intentos, estadisticas_no_disponibles: intentos >= 3 } });
    }
  }
  await invalidarCacheDatosPartidos();
  return { encontrado: true, recibido: true, estado_anterior: partido.estado, estado: fixture.fixture.status.short, cobertura };
}

async function revalidarLote(filtro, { limite = 10, modelo = Partido, revalidar = revalidarPartidoPorId } = {}) {
  const partidos = await modelo.find(filtro).select('api_id fecha').sort({ fecha: 1 }).limit(Math.min(10, Math.max(1, limite))).lean();
  const resultados = [];
  for (const partido of partidos) resultados.push({ api_id: partido.api_id, ...(await revalidar(partido.api_id)) });
  return { encontrados: partidos.length, consultados: resultados.length, resultados };
}

function revalidarPendientesLiga(ligaId, temporada, opciones = {}) {
  return revalidarLote({ ...filtroPartidosPasadosSinResultado(opciones.ahora || new Date()), 'liga.id': ligaId, 'liga.temporada': temporada }, opciones);
}

function reintentarEstadisticasPendientes(opciones = {}) {
  const ahora = opciones.ahora || new Date();
  return revalidarLote({
    fecha: { $gte: new Date(ahora.getTime() - 30 * 86400000), $lt: ahora },
    estado: { $in: [...ESTADOS_FINALIZADOS] },
    estadisticas_completas: { $ne: true },
    estadisticas_no_disponibles: { $ne: true },
    $or: [{ estadisticas_intentos: { $lt: 3 } }, { estadisticas_intentos: { $exists: false } }]
  }, opciones);
}

module.exports = { reintentarEstadisticasPendientes, revalidarLote, revalidarPartidoPorId, revalidarPendientesLiga };

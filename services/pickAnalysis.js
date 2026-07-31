const Partido = require('../models/partido');
const config = require('../config/leagues');
const { generarPicks } = require('./pickEngine');

async function resolverTemporadaPicks(leagueId, solicitada) {
  if (solicitada !== undefined && solicitada !== null) {
    const temporada = Number.parseInt(solicitada, 10);
    return Number.isInteger(temporada) ? temporada : null;
  }
  const partido = await Partido.findOne({ 'liga.id': leagueId, estado: { $in: ['FT', 'AET', 'PEN'] } })
    .sort({ 'liga.temporada': -1, fecha: -1 })
    .select('liga.temporada').lean();
  return partido?.liga?.temporada ?? null;
}

function nombreEquipo(partidos, teamId) {
  const partido = partidos.find(item => (
    item.equipo_local?.id === teamId || item.equipo_visitante?.id === teamId
  ));
  return partido?.equipo_local?.id === teamId
    ? partido.equipo_local.nombre
    : partido?.equipo_visitante?.nombre || `Equipo ${teamId}`;
}

function filtroEquipo(base, teamId, condicion) {
  if (condicion === 'general') return { ...base, $or: [{ 'equipo_local.id': teamId }, { 'equipo_visitante.id': teamId }] };
  return { ...base, [condicion === 'local' ? 'equipo_local.id' : 'equipo_visitante.id']: teamId };
}

async function analizarCruce({
  teamLocal,
  teamVisitante,
  leagueId,
  leagueLocal = leagueId,
  leagueVisitante = leagueId,
  temporada,
  temporadaLocal = temporada,
  temporadaVisitante = temporada,
  limite = 10,
  limiteLocal = limite,
  limiteVisitante = limite,
  condicionLocal = 'local',
  condicionVisitante = 'visitante',
  halfLocal = 0,
  halfVisitante = 0
}) {
  const [seasonLocal, seasonVisitante] = await Promise.all([
    resolverTemporadaPicks(leagueLocal, temporadaLocal),
    resolverTemporadaPicks(leagueVisitante, temporadaVisitante)
  ]);
  if (seasonLocal === null || seasonVisitante === null) return null;
  const filtroLocal = { 'liga.id': leagueLocal, 'liga.temporada': seasonLocal, estado: { $in: ['FT', 'AET', 'PEN'] } };
  const filtroVisitante = { 'liga.id': leagueVisitante, 'liga.temporada': seasonVisitante, estado: { $in: ['FT', 'AET', 'PEN'] } };
  const [partidosLocal, partidosVisitante] = await Promise.all([
    Partido.find(filtroEquipo(filtroLocal, teamLocal, condicionLocal)).sort({ fecha: -1 }).lean(),
    Partido.find(filtroEquipo(filtroVisitante, teamVisitante, condicionVisitante)).sort({ fecha: -1 }).lean()
  ]);
  const resultado = generarPicks({
    partidosLocal,
    teamLocal,
    partidosVisitante,
    teamVisitante,
    limiteLocal,
    limiteVisitante,
    condicionLocal,
    condicionVisitante,
    halfLocal,
    halfVisitante
  });
  const ligaLocal = { id: leagueLocal, nombre: config.ligas[leagueLocal]?.nombre || String(leagueLocal) };
  const ligaVisitante = { id: leagueVisitante, nombre: config.ligas[leagueVisitante]?.nombre || String(leagueVisitante) };
  return {
    temporada: seasonLocal,
    temporadas: { local: seasonLocal, visitante: seasonVisitante },
    liga: {
      id: leagueLocal,
      nombre: leagueLocal === leagueVisitante
        ? ligaLocal.nombre
        : `${ligaLocal.nombre} / ${ligaVisitante.nombre}`
    },
    ligas: { local: ligaLocal, visitante: ligaVisitante },
    local: { id: teamLocal, nombre: nombreEquipo(partidosLocal, teamLocal) },
    visitante: { id: teamVisitante, nombre: nombreEquipo(partidosVisitante, teamVisitante) },
    ...resultado
  };
}

module.exports = { analizarCruce, resolverTemporadaPicks };

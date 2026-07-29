const Partido = require('../models/partido');
const { generarPicks } = require('./pickEngine');

const FINALIZADOS = ['FT', 'AET', 'PEN'];

function familiaMercado(pick) {
  return `${pick.categoria}:${pick.alcance || 'total'}:${pick.tipo || pick.id}`;
}

function seleccionarPicksDiversos(mercados, limite = 5) {
  const candidatos = mercados.filter(pick => (
    pick.id !== 'over_0_5'
    && pick.estimacion >= 65
    && pick.muestra >= 5
    && pick.fuentes === 2
  ));
  const elegidos = [];
  const familias = new Set();
  const categorias = new Set();

  for (const pick of candidatos) {
    if (categorias.has(pick.categoria)) continue;
    elegidos.push(pick);
    categorias.add(pick.categoria);
    familias.add(familiaMercado(pick));
    if (elegidos.length === limite) return elegidos;
  }
  for (const pick of candidatos) {
    const familia = familiaMercado(pick);
    if (elegidos.some(item => item.id === pick.id) || familias.has(familia)) continue;
    elegidos.push(pick);
    familias.add(familia);
    if (elegidos.length === limite) break;
  }
  return elegidos;
}

async function analizarPartidosCalendario(partidos, limiteMuestra = 10) {
  const analizables = partidos.filter(partido => !FINALIZADOS.includes(partido.estado) && partido.fecha > new Date());
  const grupos = new Map();
  for (const partido of analizables) {
    const clave = `${partido.liga.id}:${partido.liga.temporada}`;
    if (!grupos.has(clave)) grupos.set(clave, { liga: partido.liga.id, temporada: partido.liga.temporada, locales: new Set(), visitantes: new Set(), hasta: partido.fecha });
    const grupo = grupos.get(clave);
    grupo.locales.add(partido.equipo_local.id);
    grupo.visitantes.add(partido.equipo_visitante.id);
    if (partido.fecha > grupo.hasta) grupo.hasta = partido.fecha;
  }

  const historicosPorGrupo = new Map();
  await Promise.all([...grupos.entries()].map(async ([clave, grupo]) => {
    const historicos = await Partido.find({
      'liga.id': grupo.liga,
      'liga.temporada': grupo.temporada,
      estado: { $in: FINALIZADOS },
      fecha: { $lt: grupo.hasta },
      $or: [
        { 'equipo_local.id': { $in: [...grupo.locales] } },
        { 'equipo_visitante.id': { $in: [...grupo.visitantes] } }
      ]
    }).sort({ fecha: -1 }).lean();
    historicosPorGrupo.set(clave, historicos);
  }));

  return analizables.map(partido => {
    const clave = `${partido.liga.id}:${partido.liga.temporada}`;
    const historicos = (historicosPorGrupo.get(clave) || []).filter(item => item.fecha < partido.fecha);
    const resultado = generarPicks({
      partidosLocal: historicos.filter(item => item.equipo_local?.id === partido.equipo_local.id),
      teamLocal: partido.equipo_local.id,
      partidosVisitante: historicos.filter(item => item.equipo_visitante?.id === partido.equipo_visitante.id),
      teamVisitante: partido.equipo_visitante.id,
      limite: limiteMuestra
    });
    return {
      partido_id: partido.api_id,
      fecha: partido.fecha,
      liga: { id: partido.liga.id, nombre: partido.liga.nombre },
      local: { id: partido.equipo_local.id, nombre: partido.equipo_local.nombre },
      visitante: { id: partido.equipo_visitante.id, nombre: partido.equipo_visitante.nombre },
      picks: seleccionarPicksDiversos(resultado.mercados)
    };
  });
}

module.exports = { analizarPartidosCalendario, familiaMercado, seleccionarPicksDiversos };

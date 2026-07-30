const JugadorPartido = require('../../models/JugadorPartido');
const Partido = require('../../models/partido');
const { normalizarTexto, resolverNombre, similitud } = require('./strings');
const { probabilidadEmpirica } = require('./probability');
const { claveMercado } = require('./marketMatchingService');
const { probabilidadImplicita, sinVig, valorEsperado } = require('./odds');

const CAMPOS_JUGADOR = { player_cards: 'amarillas', player_shots: 'tiros', player_shots_on_target: 'tiros_puerta', player_fouls: 'faltas_cometidas' };
const CAMPOS_EQUIPO = { corners: 'corners', cards: 'amarillas', shots: 'tiros', shots_on_target: 'tiros_puerta', fouls: 'faltas' };
function idLinea(linea) { return String(linea).replace('.', '_'); }

function mercadoInterno(seleccion, partido) {
  const tipo = seleccion.lado.toLowerCase();
  if (!['over', 'under'].includes(tipo) || !Number.isFinite(seleccion.linea)) return null;
  let alcance = 'total';
  if (seleccion.equipo && similitud(seleccion.equipo, partido.equipo_local.nombre) >= .7) alcance = 'local';
  if (seleccion.equipo && similitud(seleccion.equipo, partido.equipo_visitante.nombre) >= .7) alcance = 'visitante';
  if (seleccion.categoria === 'goals') {
    if (alcance === 'total') return `${tipo}_${idLinea(seleccion.linea)}`;
    return tipo === 'over' ? `${alcance}_over_${idLinea(seleccion.linea)}` : null;
  }
  const campo = CAMPOS_EQUIPO[seleccion.categoria];
  return campo ? `${campo}_${alcance}_${tipo}_${idLinea(seleccion.linea)}` : null;
}

async function probabilidadJugador(seleccion, partido, cache = {}) {
  const campo = CAMPOS_JUGADOR[seleccion.categoria];
  if (!campo || !seleccion.jugador) return { estado: 'MODEL_PROBABILITY_NOT_AVAILABLE' };
  cache.candidatosJugadores ||= JugadorPartido.aggregate([
    { $match: { 'liga.id': partido.liga.id, 'liga.temporada': partido.liga.temporada, fecha: { $lt: partido.fecha }, 'equipo.id': { $in: [partido.equipo_local.id, partido.equipo_visitante.id] } } },
    { $sort: { fecha: -1 } }, { $group: { _id: '$jugador.id', nombre: { $first: '$jugador.nombre' }, equipo: { $first: '$equipo.id' } } }
  ]).exec();
  const candidatos = await cache.candidatosJugadores;
  const match = resolverNombre(seleccion.jugador, candidatos.map(item => ({ id: item._id, nombre: item.nombre, equipo: item.equipo })), 'jugadores');
  if (match.estado === 'AMBIGUOUS') return { estado: 'AMBIGUOUS_MATCH' };
  if (match.estado !== 'MATCHED') return { estado: 'PLAYER_NOT_MATCHED' };
  const esLocal = match.item.equipo === partido.equipo_local.id;
  cache.registrosJugadores ||= new Map();
  const clave = `${match.item.id}|${esLocal}`;
  if (!cache.registrosJugadores.has(clave)) {
    cache.registrosJugadores.set(clave, JugadorPartido.find({ 'jugador.id': match.item.id, 'liga.id': partido.liga.id, 'liga.temporada': partido.liga.temporada, fecha: { $lt: partido.fecha }, 'equipo.local': esLocal })
      .sort({ fecha: -1 }).limit(20).select(Object.values(CAMPOS_JUGADOR).join(' ')).lean().exec());
  }
  const registros = await cache.registrosJugadores.get(clave);
  const calculo = probabilidadEmpirica(registros.map(item => item[campo]), seleccion.lado, seleccion.linea);
  const minimo = Number(process.env.MODEL_MIN_SAMPLE || 5);
  if (!calculo || calculo.muestra < minimo) return { estado: 'MODEL_PROBABILITY_NOT_AVAILABLE', muestra: calculo?.muestra || 0 };
  return { estado: 'MATCHED', ...calculo, jugador: match.item };
}

function alcanceSeleccion(seleccion, partido) {
  const texto = normalizarTexto(`${seleccion.equipo || ''} ${seleccion.texto_origen || ''}`);
  const local = similitud(seleccion.equipo, partido.equipo_local.nombre) >= .7 || (!seleccion.equipo && texto.includes(normalizarTexto(partido.equipo_local.nombre)));
  const visitante = similitud(seleccion.equipo, partido.equipo_visitante.nombre) >= .7 || (!seleccion.equipo && texto.includes(normalizarTexto(partido.equipo_visitante.nombre)));
  if (local !== visitante) return local ? 'local' : 'visitante';
  return 'total';
}

function valorEquipo(partido, campo, alcance) {
  const campoPartido = campo === 'goles' ? 'goles' : ({ amarillas: 'tarjetas_amarillas', tiros: 'tiros_total', tiros_puerta: 'tiros_puerta', faltas: 'faltas', corners: 'corners' })[campo];
  if (!campoPartido) return null;
  const valorLocal = partido.equipo_local?.[campoPartido];
  const valorVisitante = partido.equipo_visitante?.[campoPartido];
  const local = valorLocal == null ? NaN : Number(valorLocal);
  const visitante = valorVisitante == null ? NaN : Number(valorVisitante);
  if (alcance === 'local') return Number.isFinite(local) ? local : null;
  if (alcance === 'visitante') return Number.isFinite(visitante) ? visitante : null;
  return Number.isFinite(local) && Number.isFinite(visitante) ? local + visitante : null;
}

async function probabilidadEquipo(seleccion, partido, cache = {}) {
  const campo = seleccion.categoria === 'goals' ? 'goles' : CAMPOS_EQUIPO[seleccion.categoria];
  if (!campo || !['OVER', 'UNDER'].includes(seleccion.lado) || !Number.isFinite(seleccion.linea)) return { estado: 'MODEL_PROBABILITY_NOT_AVAILABLE' };
  const filtro = { 'liga.id': partido.liga.id, 'liga.temporada': partido.liga.temporada, estado: { $in: ['FT', 'AET', 'PEN'] }, fecha: { $lt: partido.fecha }, api_id: { $ne: partido.api_id } };
  cache.historicosEquipo ||= Promise.all([
    Partido.find({ ...filtro, 'equipo_local.id': partido.equipo_local.id }).sort({ fecha: -1 }).limit(20).lean(),
    Partido.find({ ...filtro, 'equipo_visitante.id': partido.equipo_visitante.id }).sort({ fecha: -1 }).limit(20).lean()
  ]);
  const [locales, visitantes] = await cache.historicosEquipo;
  const alcance = alcanceSeleccion(seleccion, partido);
  const alcanceLocal = alcance === 'visitante' ? 'visitante' : alcance;
  const alcanceVisitante = alcance === 'local' ? 'local' : alcance;
  const a = probabilidadEmpirica(locales.map(item => valorEquipo(item, campo, alcanceLocal)), seleccion.lado, seleccion.linea);
  const b = probabilidadEmpirica(visitantes.map(item => valorEquipo(item, campo, alcanceVisitante)), seleccion.lado, seleccion.linea);
  const minimo = Number(process.env.MODEL_MIN_SAMPLE || 5);
  if (!a || !b || a.muestra < minimo || b.muestra < minimo) return { estado: 'MODEL_PROBABILITY_NOT_AVAILABLE', muestra: Math.min(a?.muestra || 0, b?.muestra || 0) };
  return {
    estado: 'MATCHED',
    probabilidad: (a.probabilidad + b.probabilidad) / 2,
    push: (a.push + b.push) / 2,
    muestra: Math.min(a.muestra, b.muestra),
    fuentes: 2,
    metodo: 'empirical_beta_by_real_line',
    alcance
  };
}

async function evaluarSelecciones({ partido, selecciones, resultadoModelo }) {
  const minEdge = Number(process.env.MIN_EDGE || .05); const minEv = Number(process.env.MIN_EXPECTED_VALUE || .03);
  const cache = {};
  const resultados = await Promise.all(selecciones.map(async seleccion => {
    let modelo;
    if (seleccion.categoria.startsWith('player_')) modelo = await probabilidadJugador(seleccion, partido, cache);
    else {
      const id = mercadoInterno(seleccion, partido);
      const pick = resultadoModelo.mercados.find(item => item.id === id);
      modelo = pick
        ? { estado: 'MATCHED', probabilidad: pick.estimacion / 100, push: 0, muestra: pick.muestra, mercado_id: id, metodo: 'existing_line_specific_model' }
        : await probabilidadEquipo(seleccion, partido, cache);
    }
    let estado = modelo.estado === 'MATCHED' ? 'AVAILABLE_NO_VALUE' : modelo.estado;
    if (seleccion.ambiguo) estado = 'AMBIGUOUS_MATCH';
    else if (seleccion.estado === 'SUSPENDED') estado = 'MARKET_SUSPENDED';
    else if (seleccion.estado === 'CLOSED') estado = 'MARKET_NOT_FOUND';
    else if (seleccion.problemas?.includes('LINE_NOT_AVAILABLE')) estado = 'LINE_NOT_AVAILABLE';
    else if (seleccion.problemas?.includes('MARKET_NOT_NORMALIZED')) estado = 'MARKET_NOT_FOUND';
    else if (!seleccion.cuota) estado = 'ODDS_NOT_AVAILABLE';
    const implicita = probabilidadImplicita(seleccion.cuota);
    const opuesto = selecciones.find(item => claveMercado(item) === claveMercado(seleccion) && item.lado !== seleccion.lado);
    const noVig = opuesto ? sinVig(seleccion.cuota, opuesto.cuota)?.a : null;
    const edge = modelo.probabilidad != null && implicita != null ? modelo.probabilidad - (noVig ?? implicita) : null;
    const ev = modelo.probabilidad != null ? valorEsperado(modelo.probabilidad, seleccion.cuota, modelo.push || 0) : null;
    if (estado === 'AVAILABLE_NO_VALUE' && seleccion.estado !== 'OPEN') estado = 'MARKET_SUSPENDED';
    if (estado === 'AVAILABLE_NO_VALUE' && edge >= minEdge && ev >= minEv) estado = 'AVAILABLE_WITH_VALUE';
    return { seleccion, estado, modelo, probabilidad_implicita: implicita, probabilidad_sin_vig: noVig, edge, valor_esperado: ev };
  }));
  return resultados;
}

module.exports = { evaluarSelecciones, mercadoInterno, probabilidadEquipo, probabilidadJugador, valorEquipo };

const Partido = require('../models/partido');
const JugadorPartido = require('../models/JugadorPartido');
const { valorEstadistica, tieneMetricasBasicas } = require('./statValue');
const { resolverCoberturaEstadisticas } = require('./statisticsCoverage');

function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  const convertido = Number.parseFloat(String(valor).replace('%', ''));
  return Number.isFinite(convertido) ? convertido : 0;
}

function valorStat(estadisticas, tipo) {
  return valorEstadistica(estadisticas, tipo);
}

function camposEstadisticas(prefijo, bloque) {
  if (!bloque?.statistics) return {};
  const stats = bloque.statistics;
  return {
    [`${prefijo}.posesion`]: valorStat(stats, 'Ball Possession'),
    [`${prefijo}.tiros_total`]: valorStat(stats, 'Total Shots'),
    [`${prefijo}.tiros_puerta`]: valorStat(stats, 'Shots on Goal'),
    [`${prefijo}.corners`]: valorStat(stats, 'Corner Kicks'),
    [`${prefijo}.faltas`]: valorStat(stats, 'Fouls'),
    [`${prefijo}.tarjetas_amarillas`]: valorStat(stats, 'Yellow Cards'),
    [`${prefijo}.tarjetas_rojas`]: valorStat(stats, 'Red Cards'),
    [`${prefijo}.offsides`]: valorStat(stats, 'Offsides')
  };
}

function tipoEvento(evento) {
  const mapa = { Goal: 'Gol', Card: 'Tarjeta', subst: 'Sustitución', Var: 'VAR' };
  const tipo = mapa[evento.type] || mapa[String(evento.type || '').toLowerCase()] || evento.type;
  return tipo || 'Otro';
}

function eventoGuardable(evento) {
  return {
    minuto: numero(evento.time?.elapsed),
    tipo_evento: tipoEvento(evento),
    detalle: evento.detail || '',
    jugador_id: evento.player?.id || null,
    jugador: evento.player?.name || null,
    asistencia_id: evento.assist?.id || null,
    asistencia: evento.assist?.name || null
  };
}

function obtenerRango(minuto) {
  const superior = Math.max(15, Math.ceil(Math.max(1, minuto) / 15) * 15);
  return `${superior - 14}-${superior}`;
}

function agruparEventos(eventos) {
  const rangos = new Map();
  for (const evento of eventos) {
    const rango = obtenerRango(evento.minuto);
    if (!rangos.has(rango)) {
      rangos.set(rango, {
        goles: 0, amarillas: 0, rojas: 0, corners: 0,
        tiros_a_puerta: 0, faltas: 0, fueras_de_juego: 0
      });
    }
    const stats = rangos.get(rango);
    const detalle = String(evento.detalle || '').toLowerCase();
    if (evento.tipo_evento === 'Gol') stats.goles += 1;
    if (evento.tipo_evento === 'Tarjeta' && detalle.includes('yellow')) stats.amarillas += 1;
    if (evento.tipo_evento === 'Tarjeta' && detailIsRed(detalle)) stats.rojas += 1;
  }
  return [...rangos.entries()].map(([rango_minutos, valores]) => ({ rango_minutos, ...valores }));
}

function detailIsRed(detalle) {
  return detalle.includes('red') && !detalle.includes('yellow');
}

function construirUpdatePartido(detalle, partido) {
  const homeId = partido.equipo_local.id;
  const awayId = partido.equipo_visitante.id;
  const homeStats = detalle.statistics?.find(item => item.team?.id === homeId);
  const awayStats = detalle.statistics?.find(item => item.team?.id === awayId);
  const update = { fecha_actualizacion: new Date() };

  if (homeStats && awayStats) {
    Object.assign(update, camposEstadisticas('equipo_local', homeStats));
    Object.assign(update, camposEstadisticas('equipo_visitante', awayStats));
    update.estadisticas_completas = tieneMetricasBasicas(homeStats) && tieneMetricasBasicas(awayStats);
  }

  if (Array.isArray(detalle.events)) {
    const locales = detalle.events.filter(item => item.team?.id === homeId).map(eventoGuardable);
    const visitantes = detalle.events.filter(item => item.team?.id === awayId).map(eventoGuardable);
    update['equipo_local.eventos'] = locales;
    update['equipo_visitante.eventos'] = visitantes;
    update['equipo_local.estadisticas_por_rango'] = agruparEventos(locales);
    update['equipo_visitante.estadisticas_por_rango'] = agruparEventos(visitantes);
    update.eventos_completos = true;
  }

  if (Array.isArray(detalle.lineups)) {
    const local = detalle.lineups.find(item => item.team?.id === homeId);
    const visitante = detalle.lineups.find(item => item.team?.id === awayId);
    if (local) {
      update['equipo_local.formacion'] = local.formation || null;
      update['equipo_local.entrenador'] = local.coach?.name || null;
    }
    if (visitante) {
      update['equipo_visitante.formacion'] = visitante.formation || null;
      update['equipo_visitante.entrenador'] = visitante.coach?.name || null;
    }
  }
  return update;
}

function datosJugador(item, equipoApi, partido) {
  const s = item.statistics?.[0] || {};
  const games = s.games || {};
  return {
    partido_api_id: partido.api_id,
    fecha: partido.fecha,
    liga: partido.liga,
    equipo: {
      id: equipoApi.team.id,
      nombre: equipoApi.team.name,
      local: equipoApi.team.id === partido.equipo_local.id
    },
    jugador: {
      id: item.player.id,
      nombre: item.player.name,
      foto: item.player.photo
    },
    posicion: games.position,
    numero: games.number,
    titular: games.substitute === false,
    capitan: games.captain,
    minutos: numero(games.minutes),
    calificacion: numero(games.rating),
    tiros: numero(s.shots?.total),
    tiros_puerta: numero(s.shots?.on),
    goles: numero(s.goals?.total),
    asistencias: numero(s.goals?.assists),
    pases: numero(s.passes?.total),
    pases_clave: numero(s.passes?.key),
    precision_pases: numero(s.passes?.accuracy),
    entradas: numero(s.tackles?.total),
    intercepciones: numero(s.tackles?.interceptions),
    duelos: numero(s.duels?.total),
    duelos_ganados: numero(s.duels?.won),
    regates: numero(s.dribbles?.attempts),
    regates_exitosos: numero(s.dribbles?.success),
    faltas_recibidas: numero(s.fouls?.drawn),
    faltas_cometidas: numero(s.fouls?.committed),
    amarillas: numero(s.cards?.yellow),
    rojas: numero(s.cards?.red),
    atajadas: numero(s.goals?.saves),
    offsides: numero(s.offsides)
  };
}

async function guardarDetalleFixture(detalle, partido, {
  modeloPartido = Partido,
  modeloJugador = JugadorPartido
} = {}) {
  const update = construirUpdatePartido(detalle, partido);
  const jugadores = (detalle.players || []).flatMap(equipo => (
    (equipo.players || [])
      .filter(item => item.player?.id)
      .map(item => datosJugador(item, equipo, partido))
  ));
  if (jugadores.length) {
    await modeloJugador.bulkWrite(jugadores.map(jugador => ({
      updateOne: {
        filter: {
          partido_api_id: jugador.partido_api_id,
          'jugador.id': jugador.jugador.id,
          'equipo.id': jugador.equipo.id
        },
        update: { $set: jugador },
        upsert: true
      }
    })));
    update.jugadores_completos = true;
  }
  update.detalle_completo = true;
  update.detalle_consultado_en = new Date();
  update.cobertura_detalle = {
    estadisticas: update.estadisticas_completas === true,
    eventos: Array.isArray(detalle.events),
    alineaciones: Array.isArray(detalle.lineups) && detalle.lineups.length > 0,
    jugadores: jugadores.length > 0
  };
  Object.assign(update, resolverCoberturaEstadisticas(partido, update.estadisticas_completas === true));
  await modeloPartido.updateOne({ api_id: partido.api_id }, { $set: update });
  return { estadisticas: update.estadisticas_completas === true, eventos: update.eventos_completos === true, jugadores: jugadores.length };
}

module.exports = {
  agruparEventos,
  construirUpdatePartido,
  datosJugador,
  guardarDetalleFixture,
  numero,
  valorStat
};

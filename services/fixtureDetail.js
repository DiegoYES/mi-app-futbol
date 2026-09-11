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

function clasificarEventosEquipo(eventosEquipo, alineacionEquipo, jugadoresEquipo) {
  const startXIIds = new Set(
    (alineacionEquipo?.startXI || []).map(p => p.player?.id).filter(Boolean)
  );
  const subIds = new Set(
    (alineacionEquipo?.substitutes || []).map(p => p.player?.id).filter(Boolean)
  );
  const tieneAlineacion = startXIIds.size > 0 || subIds.size > 0;

  const minutosJugador = new Map();
  if (Array.isArray(jugadoresEquipo?.players)) {
    for (const p of jugadoresEquipo.players) {
      if (p.player?.id) {
        minutosJugador.set(p.player.id, numero(p.statistics?.[0]?.games?.minutes));
      }
    }
  }

  const sustituciones = [];
  for (const ev of eventosEquipo) {
    const t = tipoEvento(ev);
    if (t === 'Sustitución' || ev.type === 'subst' || /subst/i.test(ev.type || '')) {
      sustituciones.push({
        minuto: numero(ev.time?.elapsed),
        inId: ev.player?.id || null,
        outId: ev.assist?.id || null
      });
    }
  }

  return eventosEquipo.map(evento => {
    const esTarjeta = tipoEvento(evento) === 'Tarjeta' || /card/i.test(evento.type || '');
    let enBanquillo = Boolean(evento.en_banquillo);

    if (esTarjeta && !enBanquillo) {
      const jId = evento.player?.id || evento.jugador_id || null;
      const minuto = numero(evento.time?.elapsed ?? evento.minuto);
      const comments = String(evento.comments || evento.comentario || '').toLowerCase();

      if (/bench|banquillo|substitute/i.test(comments) && !/foul/i.test(comments)) {
        enBanquillo = true;
      } else if (jId && minutosJugador.has(jId) && minutosJugador.get(jId) === 0) {
        // En estadísticas de jugadores jugó 0 minutos (suplente no utilizado)
        enBanquillo = true;
      } else if (tieneAlineacion) {
        if (!jId || (!startXIIds.has(jId) && !subIds.has(jId))) {
          // No es jugador de la convocatoria en campo (cuerpo técnico / staff / etc.)
          enBanquillo = true;
        } else if (startXIIds.has(jId)) {
          // Titular: si fue sustituido antes o en este minuto, la amonestación fue en banquillo
          const subSalida = sustituciones.find(s => s.outId === jId && s.minuto <= minuto);
          if (subSalida) {
            enBanquillo = true;
          }
        } else if (subIds.has(jId)) {
          // Suplente: si no ingresó antes o en este minuto, estaba en banquillo
          const subEntrada = sustituciones.find(s => s.inId === jId && s.minuto <= minuto);
          if (!subEntrada) {
            enBanquillo = true;
          } else {
            // Ingresó, pero ¿volvió a salir antes o en este minuto?
            const subSalidaDespues = sustituciones.find(s => s.outId === jId && s.minuto > subEntrada.minuto && s.minuto <= minuto);
            if (subSalidaDespues) {
              enBanquillo = true;
            }
          }
        }
      }
    }

    return {
      minuto: numero(evento.time?.elapsed ?? evento.minuto),
      tipo_evento: tipoEvento(evento),
      detalle: evento.detail || evento.detalle || '',
      jugador_id: evento.player?.id || evento.jugador_id || null,
      jugador: evento.player?.name || evento.jugador || null,
      asistencia_id: evento.assist?.id || evento.asistencia_id || null,
      asistencia: evento.assist?.name || evento.asistencia || null,
      comentario: evento.comments || evento.comentario || null,
      en_banquillo: enBanquillo
    };
  });
}

function obtenerRango(minuto) {
  const superior = Math.max(15, Math.ceil(Math.max(1, minuto) / 15) * 15);
  return `${superior - 14}-${superior}`;
}

function agruparEventos(eventos) {
  const rangos = new Map();
  for (const evento of eventos) {
    if (evento.en_banquillo) continue;
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

  const localLineup = Array.isArray(detalle.lineups) ? detalle.lineups.find(item => item.team?.id === homeId) : null;
  const awayLineup = Array.isArray(detalle.lineups) ? detalle.lineups.find(item => item.team?.id === awayId) : null;
  const localPlayers = Array.isArray(detalle.players) ? detalle.players.find(item => item.team?.id === homeId) : null;
  const awayPlayers = Array.isArray(detalle.players) ? detalle.players.find(item => item.team?.id === awayId) : null;

  let locales = [];
  let visitantes = [];
  if (Array.isArray(detalle.events)) {
    const rawLocales = detalle.events.filter(item => item.team?.id === homeId);
    const rawVisitantes = detalle.events.filter(item => item.team?.id === awayId);
    locales = clasificarEventosEquipo(rawLocales, localLineup, localPlayers);
    visitantes = clasificarEventosEquipo(rawVisitantes, awayLineup, awayPlayers);
    update['equipo_local.eventos'] = locales;
    update['equipo_visitante.eventos'] = visitantes;
    update['equipo_local.estadisticas_por_rango'] = agruparEventos(locales);
    update['equipo_visitante.estadisticas_por_rango'] = agruparEventos(visitantes);
    update.eventos_completos = true;
  }

  const amarillasValidasLocal = locales.filter(e => e.tipo_evento === 'Tarjeta' && !e.en_banquillo && String(e.detalle || '').toLowerCase().includes('yellow')).length;
  const rojasValidasLocal = locales.filter(e => e.tipo_evento === 'Tarjeta' && !e.en_banquillo && detailIsRed(String(e.detalle || '').toLowerCase())).length;
  const amarillasBanquilloLocal = locales.filter(e => e.tipo_evento === 'Tarjeta' && e.en_banquillo && String(e.detalle || '').toLowerCase().includes('yellow')).length;
  const rojasBanquilloLocal = locales.filter(e => e.tipo_evento === 'Tarjeta' && e.en_banquillo && detailIsRed(String(e.detalle || '').toLowerCase())).length;

  const amarillasValidasVis = visitantes.filter(e => e.tipo_evento === 'Tarjeta' && !e.en_banquillo && String(e.detalle || '').toLowerCase().includes('yellow')).length;
  const rojasValidasVis = visitantes.filter(e => e.tipo_evento === 'Tarjeta' && !e.en_banquillo && detailIsRed(String(e.detalle || '').toLowerCase())).length;
  const amarillasBanquilloVis = visitantes.filter(e => e.tipo_evento === 'Tarjeta' && e.en_banquillo && String(e.detalle || '').toLowerCase().includes('yellow')).length;
  const rojasBanquilloVis = visitantes.filter(e => e.tipo_evento === 'Tarjeta' && e.en_banquillo && detailIsRed(String(e.detalle || '').toLowerCase())).length;

  if (homeStats && awayStats) {
    Object.assign(update, camposEstadisticas('equipo_local', homeStats));
    Object.assign(update, camposEstadisticas('equipo_visitante', awayStats));

    // Si los eventos registran amonestaciones, usar las tarjetas válidas en campo (excluyendo banquillo)
    if (locales.some(e => e.tipo_evento === 'Tarjeta')) {
      update['equipo_local.tarjetas_amarillas'] = amarillasValidasLocal;
      update['equipo_local.tarjetas_rojas'] = rojasValidasLocal;
    }
    if (visitantes.some(e => e.tipo_evento === 'Tarjeta')) {
      update['equipo_visitante.tarjetas_amarillas'] = amarillasValidasVis;
      update['equipo_visitante.tarjetas_rojas'] = rojasValidasVis;
    }

    if (amarillasBanquilloLocal > 0) update['equipo_local.tarjetas_amarillas_banquillo'] = amarillasBanquilloLocal;
    if (rojasBanquilloLocal > 0) update['equipo_local.tarjetas_rojas_banquillo'] = rojasBanquilloLocal;
    if (amarillasBanquilloVis > 0) update['equipo_visitante.tarjetas_amarillas_banquillo'] = amarillasBanquilloVis;
    if (rojasBanquilloVis > 0) update['equipo_visitante.tarjetas_rojas_banquillo'] = rojasBanquilloVis;

    const golesLocal = partido.equipo_local?.goles ?? detalle.goals?.home;
    const golesVis = partido.equipo_visitante?.goles ?? detalle.goals?.away;
    const totalTarjetasEvLocal = amarillasValidasLocal + rojasValidasLocal + amarillasBanquilloLocal + rojasBanquilloLocal;
    const totalTarjetasEvVis = amarillasValidasVis + rojasValidasVis + amarillasBanquilloVis + rojasBanquilloVis;
    update.estadisticas_completas = tieneMetricasBasicas(homeStats, { goles: golesLocal, tarjetasEventos: totalTarjetasEvLocal }) &&
      tieneMetricasBasicas(awayStats, { goles: golesVis, tarjetasEventos: totalTarjetasEvVis });
  } else {
    Object.assign(update, camposEstadisticas("equipo_local", { statistics: [] }));
    Object.assign(update, camposEstadisticas("equipo_visitante", { statistics: [] }));
    update.estadisticas_completas = false;
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
  clasificarEventosEquipo,
  construirUpdatePartido,
  datosJugador,
  guardarDetalleFixture,
  numero,
  valorStat
};

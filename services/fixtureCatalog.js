const ESTADOS_FINALIZADOS = new Set(['FT', 'AET', 'PEN']);

// Traduce el bloque `score` de API-Football a los campos del documento.
//
// `goals` es el marcador con el que se liquidan los mercados: 90' o 120' si
// hubo prórroga. La tanda de penales vive sólo en `score.penalty` y jamás debe
// sumarse a `goals`, porque decide quién avanza, no el resultado del partido.
// Antes de este mapeo la tanda se perdía y un 1-1 (4-3) se veía como "Final 1-1".
//
// Devuelve siempre las cinco claves, con null cuando no aplican, para que un
// partido corregido por el proveedor (por ejemplo, uno marcado por error como
// PEN) quede limpio en la siguiente pasada del cron en vez de conservar datos
// obsoletos.
function construirMarcador(fixture) {
  const score = (fixture && fixture.score) || {};
  const numero = valor => (typeof valor === 'number' && Number.isFinite(valor) ? valor : null);

  const prorrogaLocal = numero(score.extratime?.home);
  const prorrogaVisitante = numero(score.extratime?.away);
  const penalesLocal = numero(score.penalty?.home);
  const penalesVisitante = numero(score.penalty?.away);

  // Una tanda a medias (un solo lado informado) no es publicable: se descarta
  // entera en vez de mostrar un marcador incompleto.
  const tandaCompleta = penalesLocal !== null && penalesVisitante !== null;

  return {
    'goles_prorroga.local': prorrogaLocal,
    'goles_prorroga.visitante': prorrogaVisitante,
    'penales.local': tandaCompleta ? penalesLocal : null,
    'penales.visitante': tandaCompleta ? penalesVisitante : null,
    ganador_penales: !tandaCompleta || penalesLocal === penalesVisitante
      ? null
      : (penalesLocal > penalesVisitante ? 'local' : 'visitante')
  };
}

function inferirMarcadorYEstado(fixture, { ahora = new Date() } = {}) {
  const estadoOriginal = fixture?.fixture?.status?.short;
  const golesOriginalesLocal = fixture?.goals?.home;
  const golesOriginalesVisitante = fixture?.goals?.away;

  if (ESTADOS_FINALIZADOS.has(estadoOriginal) && typeof golesOriginalesLocal === 'number' && typeof golesOriginalesVisitante === 'number') {
    return {
      estado: estadoOriginal,
      golesLocal: golesOriginalesLocal,
      golesVisitante: golesOriginalesVisitante
    };
  }

  let golesLocal = typeof golesOriginalesLocal === 'number' ? golesOriginalesLocal : null;
  let golesVisitante = typeof golesOriginalesVisitante === 'number' ? golesOriginalesVisitante : null;
  let estado = estadoOriginal;

  const fechaKickoff = new Date(fixture?.fixture?.date);
  const tiempoTranscurridoMs = Number.isFinite(fechaKickoff.getTime()) ? ahora.getTime() - fechaKickoff.getTime() : 0;
  const esPartidoPasado = tiempoTranscurridoMs >= 2 * 3600000;

  if (esPartidoPasado) {
    const homeId = fixture?.teams?.home?.id;
    const awayId = fixture?.teams?.away?.id;
    const players = Array.isArray(fixture?.players) ? fixture.players : [];
    const events = Array.isArray(fixture?.events) ? fixture.events : [];
    const statistics = Array.isArray(fixture?.statistics) ? fixture.statistics : [];

    let jugadoresConMinutosLocal = 0;
    let jugadoresConMinutosVisitante = 0;
    let golesJugadoresLocal = 0;
    let golesJugadoresVisitante = 0;
    let maxMinutosJugados = 0;

    for (const teamBlock of players) {
      const esLocal = teamBlock.team?.id === homeId;
      const esVisitante = teamBlock.team?.id === awayId;
      for (const p of teamBlock.players || []) {
        const mins = Number(p.statistics?.[0]?.games?.minutes) || 0;
        const gls = Number(p.statistics?.[0]?.goals?.total) || 0;
        if (mins > 0) {
          if (esLocal) jugadoresConMinutosLocal += 1;
          if (esVisitante) jugadoresConMinutosVisitante += 1;
          if (mins > maxMinutosJugados) maxMinutosJugados = mins;
        }
        if (gls > 0) {
          if (esLocal) golesJugadoresLocal += gls;
          if (esVisitante) golesJugadoresVisitante += gls;
        }
      }
    }

    let hayEventosGol = false;
    let golesEventosLocal = 0;
    let golesEventosVisitante = 0;
    for (const ev of events) {
      const tipo = String(ev.type || '').toLowerCase();
      const detalle = String(ev.detail || '').toLowerCase();
      if (tipo === 'goal' && !detalle.includes('missed')) {
        hayEventosGol = true;
        if (ev.team?.id === homeId) golesEventosLocal += 1;
        else if (ev.team?.id === awayId) golesEventosVisitante += 1;
      }
    }

    const tieneEstadisticasEquipo = statistics.length >= 2 && statistics.some(s => Array.isArray(s.statistics) && s.statistics.length >= 3);
    const evidenciaPartidoJugado = (jugadoresConMinutosLocal >= 7 && jugadoresConMinutosVisitante >= 7) ||
      (maxMinutosJugados >= 80 && tieneEstadisticasEquipo);

    if (evidenciaPartidoJugado) {
      if (!ESTADOS_FINALIZADOS.has(estado)) {
        estado = 'FT';
      }
      if (golesLocal === null) {
        golesLocal = hayEventosGol ? golesEventosLocal : golesJugadoresLocal;
      }
      if (golesVisitante === null) {
        golesVisitante = hayEventosGol ? golesEventosVisitante : golesJugadoresVisitante;
      }
    }
  }

  return { estado, golesLocal, golesVisitante };
}

function documentoFixture(fixture, nombresLigas = {}) {
  const { estado, golesLocal, golesVisitante } = inferirMarcadorYEstado(fixture);
  const finalizado = ESTADOS_FINALIZADOS.has(estado);
  const tieneGolesValidos = typeof golesLocal === 'number' && typeof golesVisitante === 'number';
  return {
    api_id: fixture.fixture.id,
    fecha: fixture.fixture.date,
    estado,
    minuto_juego: fixture.fixture.status.elapsed || (finalizado ? 90 : 0),
    arbitro: fixture.fixture.referee || null,
    liga: {
      id: fixture.league.id,
      nombre: nombresLigas[fixture.league.id]?.nombre || fixture.league.name,
      pais: nombresLigas[fixture.league.id]?.pais || fixture.league.country || '',
      temporada: fixture.league.season,
      jornada: fixture.league.round
    },
    'equipo_local.id': fixture.teams.home.id,
    'equipo_local.nombre': fixture.teams.home.name,
    'equipo_local.logo': fixture.teams.home.logo,
    'equipo_local.goles': golesLocal,
    'equipo_local.goles_primer_tiempo': fixture.score?.halftime?.home ?? (finalizado && golesLocal === 0 ? 0 : null),
    'equipo_visitante.id': fixture.teams.away.id,
    'equipo_visitante.nombre': fixture.teams.away.name,
    'equipo_visitante.logo': fixture.teams.away.logo,
    'equipo_visitante.goles': golesVisitante,
    'equipo_visitante.goles_primer_tiempo': fixture.score?.halftime?.away ?? (finalizado && golesVisitante === 0 ? 0 : null),
    ...construirMarcador(fixture),
    ...(finalizado && tieneGolesValidos ? {
      total_goles: golesLocal + golesVisitante,
      ambos_anotan: golesLocal > 0 && golesVisitante > 0,
      resultado: golesLocal > golesVisitante ? 'local' : (golesLocal < golesVisitante ? 'visitante' : 'empate')
    } : {}),
    fecha_actualizacion: new Date()
  };
}

function documentoEquipo(item, leagueId) {
  return {
    nombre: item.team.name,
    pais: item.team.country,
    logo: item.team.logo,
    fundacion: item.team.founded,
    estadio: {
      nombre: item.venue?.name || null,
      capacidad: item.venue?.capacity || null,
      ciudad: item.venue?.city || null
    },
    liga: Number(leagueId),
    ultima_actualizacion: new Date()
  };
}

module.exports = { documentoEquipo, documentoFixture, construirMarcador, inferirMarcadorYEstado, ESTADOS_FINALIZADOS };

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

function documentoFixture(fixture, nombresLigas = {}) {
  const estado = fixture.fixture.status.short;
  const finalizado = ESTADOS_FINALIZADOS.has(estado);
  const golesLocal = fixture.goals.home;
  const golesVisitante = fixture.goals.away;
  return {
    api_id: fixture.fixture.id,
    fecha: fixture.fixture.date,
    estado,
    minuto_juego: fixture.fixture.status.elapsed || 0,
    arbitro: fixture.fixture.referee || null,
    liga: {
      id: fixture.league.id,
      nombre: nombresLigas[fixture.league.id]?.nombre || fixture.league.name,
      temporada: fixture.league.season,
      jornada: fixture.league.round
    },
    'equipo_local.id': fixture.teams.home.id,
    'equipo_local.nombre': fixture.teams.home.name,
    'equipo_local.logo': fixture.teams.home.logo,
    'equipo_local.goles': golesLocal,
    'equipo_local.goles_primer_tiempo': fixture.score?.halftime?.home ?? null,
    'equipo_visitante.id': fixture.teams.away.id,
    'equipo_visitante.nombre': fixture.teams.away.name,
    'equipo_visitante.logo': fixture.teams.away.logo,
    'equipo_visitante.goles': golesVisitante,
    'equipo_visitante.goles_primer_tiempo': fixture.score?.halftime?.away ?? null,
    ...construirMarcador(fixture),
    ...(finalizado ? {
      total_goles: (golesLocal ?? 0) + (golesVisitante ?? 0),
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

module.exports = { documentoEquipo, documentoFixture, construirMarcador, ESTADOS_FINALIZADOS };

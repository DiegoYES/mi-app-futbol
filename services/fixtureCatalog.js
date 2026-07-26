const ESTADOS_FINALIZADOS = new Set(['FT', 'AET', 'PEN']);

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

module.exports = { documentoEquipo, documentoFixture, ESTADOS_FINALIZADOS };

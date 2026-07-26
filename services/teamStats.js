const EMPTY_STATS = Object.freeze({
  goles: 0,
  tiros: 0,
  tiros_puerta: 0,
  corners: 0,
  faltas: 0,
  amarillas: 0,
  rojas: 0,
  offsides: 0
});

function numero(valor) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

function porcentaje(total, jugados) {
  return jugados === 0 ? '0.0' : ((total / jugados) * 100).toFixed(1);
}

function estadisticasPeriodo(equipo, half) {
  if (!equipo) return { ...EMPTY_STATS };

  if (half === 0) {
    return {
      goles: numero(equipo.goles),
      tiros: numero(equipo.tiros_total),
      tiros_puerta: numero(equipo.tiros_puerta),
      corners: numero(equipo.corners),
      faltas: numero(equipo.faltas),
      amarillas: numero(equipo.tarjetas_amarillas),
      rojas: numero(equipo.tarjetas_rojas),
      offsides: numero(equipo.offsides)
    };
  }

  const datos = equipo[half === 1 ? 'estadisticas_1t' : 'estadisticas_2t'] || {};
  const golesPrimerTiempo = numero(equipo.goles_primer_tiempo);
  const goles = half === 1
    ? golesPrimerTiempo
    : Math.max(0, numero(equipo.goles) - golesPrimerTiempo);

  return {
    goles,
    tiros: numero(datos.tiros_total),
    tiros_puerta: numero(datos.tiros_puerta),
    corners: numero(datos.corners),
    faltas: numero(datos.faltas),
    amarillas: numero(datos.tarjetas_amarillas),
    rojas: numero(datos.tarjetas_rojas),
    offsides: numero(datos.offsides)
  };
}

function contextoPartido(partido, teamId, half = 0) {
  const esLocal = partido?.equipo_local?.id === teamId;
  const esVisitante = partido?.equipo_visitante?.id === teamId;
  if (!esLocal && !esVisitante) return null;

  const equipo = esLocal ? partido.equipo_local : partido.equipo_visitante;
  const rival = esLocal ? partido.equipo_visitante : partido.equipo_local;

  return {
    esLocal,
    equipo,
    rival,
    statsEquipo: estadisticasPeriodo(equipo, half),
    statsRival: estadisticasPeriodo(rival, half)
  };
}

function contador(total, jugados) {
  return { total, porcentaje: porcentaje(total, jugados) };
}

function calcularEstadisticas(partidos, teamId, half = 0) {
  const contextos = partidos
    .map(partido => contextoPartido(partido, teamId, half))
    .filter(Boolean);
  const jugados = contextos.length;

  let ganados = 0;
  let empatados = 0;
  let perdidos = 0;
  let golesFavor = 0;
  let golesContra = 0;
  let over05 = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let btts = 0;
  let equipoOver15 = 0;
  let rivalOver15 = 0;

  for (const { statsEquipo, statsRival } of contextos) {
    const golesEquipo = statsEquipo.goles;
    const golesRival = statsRival.goles;
    const totalGoles = golesEquipo + golesRival;

    golesFavor += golesEquipo;
    golesContra += golesRival;

    if (golesEquipo > golesRival) ganados++;
    else if (golesEquipo === golesRival) empatados++;
    else perdidos++;

    if (totalGoles >= 1) over05++;
    if (totalGoles >= 2) over15++;
    if (totalGoles >= 3) over25++;
    if (totalGoles >= 4) over35++;
    if (golesEquipo >= 1 && golesRival >= 1) btts++;
    if (golesEquipo >= 2) equipoOver15++;
    if (golesRival >= 2) rivalOver15++;
  }

  const equipoOver15Contador = contador(equipoOver15, jugados);
  const rivalOver15Contador = contador(rivalOver15, jugados);

  return {
    jugados,
    ganados,
    empatados,
    perdidos,
    golesFavor,
    golesContra,
    over05: contador(over05, jugados),
    over15: contador(over15, jugados),
    over25: contador(over25, jugados),
    over35: contador(over35, jugados),
    btts: contador(btts, jugados),
    equipoOver15: equipoOver15Contador,
    rivalOver15: rivalOver15Contador,
    // Alias temporales para no romper clientes anteriores de la API.
    ttFavor15: equipoOver15Contador,
    ttContra15: rivalOver15Contador
  };
}

function detallarPartido(partido, teamId, half = 0) {
  const contexto = contextoPartido(partido, teamId, half);
  if (!contexto) return null;

  const { esLocal, equipo, rival, statsEquipo, statsRival } = contexto;
  const resultado = statsEquipo.goles > statsRival.goles
    ? 'V'
    : (statsEquipo.goles === statsRival.goles ? 'E' : 'D');
  const estadisticasDisponibles = half === 0
    ? Boolean(partido.estadisticas_completas)
    : Boolean(partido.tiempos_completos);
  const valorDetallado = valor => estadisticasDisponibles ? valor : null;

  return {
    id: partido.api_id,
    fecha: partido.fecha,
    liga_id: partido.liga?.id,
    local_id: partido.equipo_local?.id,
    visitante_id: partido.equipo_visitante?.id,
    rival_id: rival.id,
    rival: rival.nombre,
    ubicacion: esLocal ? 'local' : 'visitante',
    periodo: half === 0 ? 'FT' : `${half}T`,
    marcador: `${statsEquipo.goles}-${statsRival.goles}`,
    resultado,
    goles: statsEquipo.goles,
    goles_rival: statsRival.goles,
    estadisticas_disponibles: estadisticasDisponibles,
    tiros: valorDetallado(statsEquipo.tiros),
    tiros_puerta: valorDetallado(statsEquipo.tiros_puerta),
    corners: valorDetallado(statsEquipo.corners),
    faltas: valorDetallado(statsEquipo.faltas),
    amarillas: valorDetallado(statsEquipo.amarillas),
    rojas: valorDetallado(statsEquipo.rojas),
    offsides: valorDetallado(statsEquipo.offsides),
    rival_estadisticas: statsRival
  };
}

module.exports = {
  calcularEstadisticas,
  contextoPartido,
  detallarPartido,
  estadisticasPeriodo
};

const EMPTY_STATS = Object.freeze({
  goles: 0,
  tiros: 0,
  tiros_puerta: 0,
  corners: 0,
  faltas: 0,
  amarillas: 0,
  rojas: 0,
  offsides: 0,
  entradas: 0
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
      offsides: numero(equipo.offsides),
      entradas: numero(equipo.entradas)
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
    offsides: numero(datos.offsides),
    entradas: numero(datos.entradas)
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

function promedio(total, muestra) {
  return muestra === 0 ? null : Number((total / muestra).toFixed(2));
}

function calcularEstadisticas(partidos, teamId, half = 0) {
  const contextos = partidos
    .map(partido => {
      const contexto = contextoPartido(partido, teamId, half);
      if (!contexto) return null;
      return {
        ...contexto,
        estadisticasDisponibles: half === 0
          ? Boolean(partido.estadisticas_completas)
          : Boolean(partido.tiempos_completos)
      };
    })
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
  let under05 = 0;
  let under15 = 0;
  let under25 = 0;
  let under35 = 0;
  let btts = 0;
  let equipoOver15 = 0;
  let rivalOver15 = 0;

  let muestraAvanzada = 0;
  let cornersOver95 = 0;
  const sumas = {
    tirosFavor: 0,
    tirosContra: 0,
    tirosPuertaFavor: 0,
    tirosPuertaContra: 0,
    cornersFavor: 0,
    cornersContra: 0,
    cornersTotales: 0,
    tarjetasFavor: 0,
    tarjetasContra: 0,
    tarjetasTotales: 0,
    faltasFavor: 0,
    faltasContra: 0,
    offsidesFavor: 0,
    offsidesContra: 0,
    entradasFavor: 0,
    entradasContra: 0
  };

  for (const { statsEquipo, statsRival, estadisticasDisponibles } of contextos) {
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
    if (totalGoles < 1) under05++;
    if (totalGoles < 2) under15++;
    if (totalGoles < 3) under25++;
    if (totalGoles < 4) under35++;
    if (golesEquipo >= 1 && golesRival >= 1) btts++;
    if (golesEquipo >= 2) equipoOver15++;
    if (golesRival >= 2) rivalOver15++;

    if (!estadisticasDisponibles) continue;

    const tarjetasEquipo = statsEquipo.amarillas + statsEquipo.rojas;
    const tarjetasRival = statsRival.amarillas + statsRival.rojas;
    const cornersTotales = statsEquipo.corners + statsRival.corners;
    muestraAvanzada++;
    sumas.tirosFavor += statsEquipo.tiros;
    sumas.tirosContra += statsRival.tiros;
    sumas.tirosPuertaFavor += statsEquipo.tiros_puerta;
    sumas.tirosPuertaContra += statsRival.tiros_puerta;
    sumas.cornersFavor += statsEquipo.corners;
    sumas.cornersContra += statsRival.corners;
    sumas.cornersTotales += cornersTotales;
    sumas.tarjetasFavor += tarjetasEquipo;
    sumas.tarjetasContra += tarjetasRival;
    sumas.tarjetasTotales += tarjetasEquipo + tarjetasRival;
    sumas.faltasFavor += statsEquipo.faltas;
    sumas.faltasContra += statsRival.faltas;
    sumas.offsidesFavor += statsEquipo.offsides;
    sumas.offsidesContra += statsRival.offsides;
    sumas.entradasFavor += statsEquipo.entradas;
    sumas.entradasContra += statsRival.entradas;
    if (cornersTotales >= 10) cornersOver95++;
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
    under05: contador(under05, jugados),
    under15: contador(under15, jugados),
    under25: contador(under25, jugados),
    under35: contador(under35, jugados),
    btts: contador(btts, jugados),
    equipoOver15: equipoOver15Contador,
    rivalOver15: rivalOver15Contador,
    avanzadas: {
      muestra: muestraAvanzada,
      promedios: {
        tirosFavor: promedio(sumas.tirosFavor, muestraAvanzada),
        tirosContra: promedio(sumas.tirosContra, muestraAvanzada),
        tirosPuertaFavor: promedio(sumas.tirosPuertaFavor, muestraAvanzada),
        tirosPuertaContra: promedio(sumas.tirosPuertaContra, muestraAvanzada),
        cornersFavor: promedio(sumas.cornersFavor, muestraAvanzada),
        cornersContra: promedio(sumas.cornersContra, muestraAvanzada),
        cornersTotales: promedio(sumas.cornersTotales, muestraAvanzada),
        tarjetasFavor: promedio(sumas.tarjetasFavor, muestraAvanzada),
        tarjetasContra: promedio(sumas.tarjetasContra, muestraAvanzada),
        tarjetasTotales: promedio(sumas.tarjetasTotales, muestraAvanzada),
        faltasFavor: promedio(sumas.faltasFavor, muestraAvanzada),
        faltasContra: promedio(sumas.faltasContra, muestraAvanzada),
        offsidesFavor: promedio(sumas.offsidesFavor, muestraAvanzada),
        offsidesContra: promedio(sumas.offsidesContra, muestraAvanzada),
        entradasFavor: promedio(sumas.entradasFavor, muestraAvanzada),
        entradasContra: promedio(sumas.entradasContra, muestraAvanzada)
      },
      cornersOver95: contador(cornersOver95, muestraAvanzada)
    },
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
    entradas: valorDetallado(statsEquipo.entradas),
    rival_estadisticas: Object.fromEntries(
      Object.entries(statsRival).map(([clave, valor]) => [clave, valorDetallado(valor)])
    )
  };
}

module.exports = {
  calcularEstadisticas,
  contextoPartido,
  detallarPartido,
  estadisticasPeriodo
};

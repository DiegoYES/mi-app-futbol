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

function numeroNullable(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : null;
}

function porcentaje(total, jugados) {
  return jugados === 0 ? '0.0' : ((total / jugados) * 100).toFixed(1);
}

function estadisticasPeriodo(equipo, half) {
  if (!equipo) return { ...EMPTY_STATS };

  if (half === 0) {
    return {
      goles: numero(equipo.goles),
      tiros: numeroNullable(equipo.tiros_total),
      tiros_puerta: numeroNullable(equipo.tiros_puerta),
      corners: numeroNullable(equipo.corners),
      faltas: numeroNullable(equipo.faltas),
      amarillas: numeroNullable(equipo.tarjetas_amarillas),
      rojas: numeroNullable(equipo.tarjetas_rojas),
      offsides: numeroNullable(equipo.offsides)
    };
  }

  const datos = equipo[half === 1 ? 'estadisticas_1t' : 'estadisticas_2t'] || {};
  const golesPrimerTiempo = numero(equipo.goles_primer_tiempo);
  const goles = half === 1
    ? golesPrimerTiempo
    : Math.max(0, numero(equipo.goles) - golesPrimerTiempo);

  return {
    goles,
    tiros: numeroNullable(datos.tiros_total),
    tiros_puerta: numeroNullable(datos.tiros_puerta),
    corners: numeroNullable(datos.corners),
    faltas: numeroNullable(datos.faltas),
    amarillas: numeroNullable(datos.tarjetas_amarillas),
    rojas: numeroNullable(datos.tarjetas_rojas),
    offsides: numeroNullable(datos.offsides)
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
    tirosTotales: 0,
    tirosPuertaFavor: 0,
    tirosPuertaContra: 0,
    tirosPuertaTotales: 0,
    cornersFavor: 0,
    cornersContra: 0,
    cornersTotales: 0,
    tarjetasFavor: 0,
    tarjetasContra: 0,
    tarjetasTotales: 0,
    faltasFavor: 0,
    faltasContra: 0,
    faltasTotales: 0,
    offsidesFavor: 0,
    offsidesContra: 0,
    offsidesTotales: 0
  };
  const muestras = Object.fromEntries(Object.keys(sumas).map(clave => [clave, 0]));
  const acumular = (clave, valor) => {
    if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return;
    sumas[clave] += Number(valor);
    muestras[clave]++;
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

    const tarjetasEquipo = statsEquipo.amarillas == null || statsEquipo.rojas == null
      ? null : statsEquipo.amarillas + statsEquipo.rojas;
    const tarjetasRival = statsRival.amarillas == null || statsRival.rojas == null
      ? null : statsRival.amarillas + statsRival.rojas;
    const total = (favor, contra) => favor == null || contra == null ? null : favor + contra;
    const tirosTotales = total(statsEquipo.tiros, statsRival.tiros);
    const tirosPuertaTotales = total(statsEquipo.tiros_puerta, statsRival.tiros_puerta);
    const cornersTotales = total(statsEquipo.corners, statsRival.corners);
    const faltasTotales = total(statsEquipo.faltas, statsRival.faltas);
    const offsidesTotales = total(statsEquipo.offsides, statsRival.offsides);
    const tarjetasTotales = tarjetasEquipo == null || tarjetasRival == null
      ? null : tarjetasEquipo + tarjetasRival;
    muestraAvanzada++;
    acumular('tirosFavor', statsEquipo.tiros);
    acumular('tirosContra', statsRival.tiros);
    acumular('tirosTotales', tirosTotales);
    acumular('tirosPuertaFavor', statsEquipo.tiros_puerta);
    acumular('tirosPuertaContra', statsRival.tiros_puerta);
    acumular('tirosPuertaTotales', tirosPuertaTotales);
    acumular('cornersFavor', statsEquipo.corners);
    acumular('cornersContra', statsRival.corners);
    acumular('cornersTotales', cornersTotales);
    acumular('tarjetasFavor', tarjetasEquipo);
    acumular('tarjetasContra', tarjetasRival);
    acumular('tarjetasTotales', tarjetasTotales);
    acumular('faltasFavor', statsEquipo.faltas);
    acumular('faltasContra', statsRival.faltas);
    acumular('faltasTotales', faltasTotales);
    acumular('offsidesFavor', statsEquipo.offsides);
    acumular('offsidesContra', statsRival.offsides);
    acumular('offsidesTotales', offsidesTotales);
    if (cornersTotales !== null && cornersTotales >= 10) cornersOver95++;
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
        tirosFavor: promedio(sumas.tirosFavor, muestras.tirosFavor),
        tirosContra: promedio(sumas.tirosContra, muestras.tirosContra),
        tirosTotales: promedio(sumas.tirosTotales, muestras.tirosTotales),
        tirosPuertaFavor: promedio(sumas.tirosPuertaFavor, muestras.tirosPuertaFavor),
        tirosPuertaContra: promedio(sumas.tirosPuertaContra, muestras.tirosPuertaContra),
        tirosPuertaTotales: promedio(sumas.tirosPuertaTotales, muestras.tirosPuertaTotales),
        cornersFavor: promedio(sumas.cornersFavor, muestras.cornersFavor),
        cornersContra: promedio(sumas.cornersContra, muestras.cornersContra),
        cornersTotales: promedio(sumas.cornersTotales, muestras.cornersTotales),
        tarjetasFavor: promedio(sumas.tarjetasFavor, muestras.tarjetasFavor),
        tarjetasContra: promedio(sumas.tarjetasContra, muestras.tarjetasContra),
        tarjetasTotales: promedio(sumas.tarjetasTotales, muestras.tarjetasTotales),
        faltasFavor: promedio(sumas.faltasFavor, muestras.faltasFavor),
        faltasContra: promedio(sumas.faltasContra, muestras.faltasContra),
        faltasTotales: promedio(sumas.faltasTotales, muestras.faltasTotales),
        offsidesFavor: promedio(sumas.offsidesFavor, muestras.offsidesFavor),
        offsidesContra: promedio(sumas.offsidesContra, muestras.offsidesContra),
        offsidesTotales: promedio(sumas.offsidesTotales, muestras.offsidesTotales)
      },
      muestras,
      cornersOver95: contador(cornersOver95, muestras.cornersTotales)
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

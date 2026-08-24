function construirIndiceEquipos(filas = [], ligas = {}, etiquetarTemporada = (_id, season) => String(season)) {
  const temporadaPorLiga = new Map();
  const equipos = new Map();

  for (const fila of filas) {
    const league = Number(fila?._id?.liga);
    const season = Number(fila?._id?.temporada);
    const id = Number(fila?._id?.equipo);
    if (!Number.isInteger(league) || !Number.isInteger(season) || !Number.isInteger(id)) continue;
    if (!temporadaPorLiga.has(league)) temporadaPorLiga.set(league, season);
    if (temporadaPorLiga.get(league) !== season) continue;

    const configurada = ligas[league] || {};
    const principal = configurada.liga_principal === true;
    const etiqueta = `${fila.liga_nombre || configurada.nombre || `Competición ${league}`} ${etiquetarTemporada(league, season)}`;
    const actual = equipos.get(id);
    if (!actual) {
      equipos.set(id, {
        id,
        nombre: fila.nombre || `Equipo ${id}`,
        logo: fila.logo || null,
        league,
        season,
        principal,
        competiciones: [etiqueta]
      });
      continue;
    }
    if (!actual.competiciones.includes(etiqueta)) actual.competiciones.push(etiqueta);
    if ((principal && !actual.principal) || (principal === actual.principal && season > actual.season)) {
      actual.league = league;
      actual.season = season;
      actual.principal = principal;
    }
  }

  return [...equipos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

module.exports = { construirIndiceEquipos };

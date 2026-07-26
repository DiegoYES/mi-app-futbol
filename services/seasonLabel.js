const LIGAS_ANO_CALENDARIO = new Set([71, 253]);

function etiquetaTemporada(leagueId, season) {
  const year = Number(season);
  if (!Number.isInteger(year)) return String(season ?? '');
  if (LIGAS_ANO_CALENDARIO.has(Number(leagueId))) return String(year);
  return `${year}-${String(year + 1).slice(-2)}`;
}

module.exports = { etiquetaTemporada, LIGAS_ANO_CALENDARIO };

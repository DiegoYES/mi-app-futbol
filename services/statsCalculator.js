function calcularMercados(partidos) {
  const finales = new Set(['FT', 'AET', 'PEN']);
  const jugados = partidos.filter(p => finales.has(p.estado) || finales.has(p.fixture?.status?.short));
  let o05 = 0, o15 = 0, o25 = 0, o35 = 0;
  let u05 = 0, u15 = 0, u25 = 0, u35 = 0;
  let btts = 0;

  jugados.forEach(j => {
    const gL = j.equipo_local?.goles ?? j.goals?.home ?? 0;
    const gV = j.equipo_visitante?.goles ?? j.goals?.away ?? 0;
    const total = gL + gV;

    if (total > 0) o05++; else u05++;
    if (total > 1) o15++; else u15++;
    if (total > 2) o25++; else u25++;
    if (total > 3) o35++; else u35++;
    if (gL > 0 && gV > 0) btts++;
  });

  const total = jugados.length || 1;
  return { jugados, total, o05, o15, o25, o35, u05, u15, u25, u35, btts };
}

module.exports = { calcularMercados };

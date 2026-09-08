function normalizarPick(pick) {
  if (!pick || typeof pick !== 'object') return null;

  let tipo = pick.tipo ? String(pick.tipo).toLowerCase() : null;
  let categoria = pick.categoria ? String(pick.categoria).toLowerCase() : null;
  let linea = Number(pick.linea);
  let alcance = pick.alcance ? String(pick.alcance).toLowerCase() : null;
  const id = typeof pick.id === 'string' ? pick.id.toLowerCase() : '';
  const mercado = typeof pick.mercado === 'string'
    ? pick.mercado
    : (typeof pick.nombre === 'string' ? pick.nombre : '');

  // Deducir tipo si no viene explícito
  if (!tipo) {
    if (id.includes('_over_') || id.startsWith('over_') || /^\s*más\s+de/i.test(mercado)) {
      tipo = 'over';
    } else if (id.includes('_under_') || id.startsWith('under_') || /^\s*menos\s+de/i.test(mercado)) {
      tipo = 'under';
    }
  }

  // Deducir categoría si no viene explícita
  if (!categoria) {
    if (id.includes('gol') || /gol/i.test(mercado)) {
      categoria = 'goles';
    } else if (id.includes('corner') || /córner|corner/i.test(mercado)) {
      categoria = 'corners';
    } else if (id.includes('tarjeta') || id.includes('amarilla') || id.includes('roja') || /tarjeta|amarilla/i.test(mercado)) {
      categoria = 'tarjetas';
    } else if (id.includes('tiros_puerta') || /tiros?\s+a\s+puerta/i.test(mercado)) {
      categoria = 'tiros_puerta';
    } else if (id.includes('tiro') || /tiros?/i.test(mercado)) {
      categoria = 'tiros';
    } else if (id.includes('falta') || /faltas?/i.test(mercado)) {
      categoria = 'faltas';
    }
  }

  // Deducir línea si no viene explícita
  if (!Number.isFinite(linea)) {
    const matchId = id.match(/(?:over|under)_(\d+(?:_\d+)?)/);
    if (matchId) {
      linea = Number(matchId[1].replace('_', '.'));
    } else {
      const matchMercado = mercado.match(/(?:más|menos)\s+de\s+(\d+(?:[.,]\d+)?)/i);
      if (matchMercado) {
        linea = Number(matchMercado[1].replace(',', '.'));
      }
    }
  }

  // Deducir alcance si no viene explícito
  if (!alcance) {
    if (id.includes('_local_') || /local/i.test(mercado)) {
      alcance = 'local';
    } else if (id.includes('_visitante_') || /visitante/i.test(mercado)) {
      alcance = 'visitante';
    } else if (id.includes('_total_') || /total/i.test(mercado)) {
      alcance = 'total';
    }
  }

  return { id, mercado, tipo, categoria, linea, alcance };
}

/**
 * Determina si un pick es trivial (carece de valor por línea demasiado baja en mercado Over).
 * Reglas de descarte:
 * 1. Over 0.5 goles (total o por equipo)
 * 2. Over <= 2.5 tiros totales (o líneas <= 2.5 de tiros)
 * 3. Over <= 1.5 tiros a puerta (total o por equipo)
 * 4. Over <= 1.5 córners (total o por equipo)
 * 5. Over 0.5 tarjetas por equipo (o tarjetas totales <= 0.5)
 * 6. Over <= 2.5 faltas (total o por equipo)
 *
 * NOTA IMPORTANTE: Los Under equivalentes (ej. Menos de 0.5 goles, Menos de 1.5 tiros a puerta)
 * SÍ tienen valor estadístico/cuota y NO son triviales.
 */
function esPickTrivial(pick) {
  const norm = normalizarPick(pick);
  if (!norm) return false;
  const { tipo, categoria, linea } = norm;

  // Solo los mercados 'over' pueden ser triviales en estas líneas tan bajas.
  // Los Under equivalentes siempre se consideran válidos.
  if (tipo !== 'over') return false;
  if (!Number.isFinite(linea)) return false;

  // 1. Over 0.5 goles
  if (categoria === 'goles' && linea <= 0.5) return true;

  // 2. Over <= 2.5 tiros totales (o líneas <= 2.5 en tiros)
  if (categoria === 'tiros' && linea <= 2.5) return true;

  // 3. Over <= 1.5 tiros a puerta
  if (categoria === 'tiros_puerta' && linea <= 1.5) return true;

  // 4. Over <= 1.5 córners
  if (categoria === 'corners' && linea <= 1.5) return true;

  // 5. Over 0.5 tarjetas por equipo (o totales <= 0.5)
  if (categoria === 'tarjetas' && linea <= 0.5) return true;

  // 6. Over <= 2.5 faltas
  if (categoria === 'faltas' && linea <= 2.5) return true;

  return false;
}

module.exports = {
  esPickTrivial,
  normalizarPick
};

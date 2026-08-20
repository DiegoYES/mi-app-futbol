function textoNormalizado(valor) {
  return String(valor || '').trim().toLowerCase();
}

function clasificarEvento(evento) {
  const tipo = textoNormalizado(evento?.tipo_evento);
  const detalle = textoNormalizado(evento?.detalle);

  if (tipo === 'gol' || tipo === 'goal') return 'goles';

  if (tipo.includes('tarjeta amarilla')) return 'amarillas';
  if (tipo.includes('tarjeta roja')) return 'rojas';
  if (tipo !== 'tarjeta' && tipo !== 'card') return null;

  // API-Football denomina "Yellow-Red Card" a la segunda amarilla. Se
  // conserva el criterio histórico de la aplicación: cuenta como amarilla,
  // mientras que "Red Card" simple cuenta como roja.
  if (detalle.includes('yellow') || detalle.includes('amarilla')) return 'amarillas';
  if (detalle.includes('red') || detalle.includes('roja')) return 'rojas';
  return null;
}

function resumirEventosPorMinuto(eventos, minInicio, minFin) {
  const totales = { goles: 0, amarillas: 0, rojas: 0 };

  for (const evento of eventos || []) {
    const minuto = Number(evento?.minuto);
    if (!Number.isFinite(minuto) || minuto < minInicio || minuto > minFin) continue;
    const categoria = clasificarEvento(evento);
    if (categoria) totales[categoria] += 1;
  }

  return totales;
}

module.exports = { clasificarEvento, resumirEventosPorMinuto };

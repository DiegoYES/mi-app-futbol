function valorEstadistica(estadisticas, tipo) {
  const item = Array.isArray(estadisticas) ? estadisticas.find(stat => stat.type === tipo) : null;
  if (!item) return null;
  if (item.value === null || item.value === undefined || item.value === '') return null;
  const numero = Number.parseFloat(String(item.value).replace('%', ''));
  return Number.isFinite(numero) ? numero : null;
}

function tieneMetricasBasicas(bloque) {
  const stats = bloque?.statistics;
  return ['Total Shots', 'Shots on Goal', 'Corner Kicks'].every(tipo => valorEstadistica(stats, tipo) !== null);
}

module.exports = { valorEstadistica, tieneMetricasBasicas };

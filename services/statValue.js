function valorEstadistica(estadisticas, tipo) {
  const item = Array.isArray(estadisticas) ? estadisticas.find(stat => stat.type === tipo) : null;
  if (!item) return null;
  if (item.value === null || item.value === undefined || item.value === '') return null;
  const numero = Number.parseFloat(String(item.value).replace('%', ''));
  return Number.isFinite(numero) ? numero : null;
}

function tieneMetricasBasicas(bloque, { goles = null, tarjetasEventos = null } = {}) {
  const stats = bloque?.statistics;
  const tieneBasicas = ['Total Shots', 'Shots on Goal', 'Corner Kicks'].every(tipo => valorEstadistica(stats, tipo) !== null);
  if (!tieneBasicas) return false;

  if (typeof goles === 'number' && goles > 0) {
    const tirosTotal = valorEstadistica(stats, 'Total Shots') ?? 0;
    if (tirosTotal < goles) return false;
  }

  if (typeof tarjetasEventos === 'number' && tarjetasEventos > 0) {
    const amarillas = valorEstadistica(stats, 'Yellow Cards') ?? 0;
    const rojas = valorEstadistica(stats, 'Red Cards') ?? 0;
    const faltas = valorEstadistica(stats, 'Fouls');
    if (amarillas === 0 && rojas === 0 && (faltas === 0 || faltas === null)) {
      return false;
    }
  }

  return true;
}

module.exports = { valorEstadistica, tieneMetricasBasicas };

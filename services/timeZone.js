const ZONA_HORARIA_PREDETERMINADA = 'America/Mexico_City';

function zonaHorariaValida(valor) {
  const candidata = String(valor || '').trim();
  if (!candidata || candidata.length > 100) return ZONA_HORARIA_PREDETERMINADA;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidata }).format(new Date());
    return candidata;
  } catch {
    return ZONA_HORARIA_PREDETERMINADA;
  }
}

function fechaISOEnZona(fecha, zonaHoraria = ZONA_HORARIA_PREDETERMINADA) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(fecha));
  const valor = tipo => partes.find(parte => parte.type === tipo)?.value;
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

function horaEnZona(fecha, zonaHoraria = ZONA_HORARIA_PREDETERMINADA) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: zonaHoraria, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(fecha));
}

module.exports = { ZONA_HORARIA_PREDETERMINADA, fechaISOEnZona, horaEnZona, zonaHorariaValida };

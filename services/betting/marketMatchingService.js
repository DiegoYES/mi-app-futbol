const { normalizarTexto, similitud } = require('./strings');

function agruparEventos(selecciones) {
  const grupos = new Map();
  for (const item of selecciones) {
    const clave = item.evento_externo_id || `${item.evento_nombre}|${item.inicio || ''}`;
    if (!grupos.has(clave)) grupos.set(clave, { clave, evento: item, selecciones: [] });
    grupos.get(clave).selecciones.push(item);
  }
  return [...grupos.values()];
}

function resolverEvento(partido, selecciones) {
  const candidatos = agruparEventos(selecciones).map(grupo => {
    const local = grupo.evento.local || grupo.evento.evento_nombre;
    const visitante = grupo.evento.visitante || grupo.evento.evento_nombre;
    const score = (similitud(partido.equipo_local.nombre, local) + similitud(partido.equipo_visitante.nombre, visitante)) / 2;
    const fecha = grupo.evento.inicio ? Math.abs(new Date(grupo.evento.inicio) - new Date(partido.fecha)) / 3600000 : 0;
    return { ...grupo, score, fecha };
  }).filter(item => item.score >= 0.55 && item.fecha <= 36).sort((a, b) => b.score - a.score || a.fecha - b.fecha);
  if (!candidatos.length) return { estado: 'EVENT_NOT_MATCHED' };
  if (candidatos[1] && candidatos[0].score - candidatos[1].score < 0.08) return { estado: 'AMBIGUOUS_MATCH', candidatos: candidatos.slice(0, 2) };
  return { estado: 'MATCHED', evento: candidatos[0] };
}

function claveMercado(item) {
  return [item.categoria, normalizarTexto(item.jugador), normalizarTexto(item.equipo), item.linea].join('|');
}

module.exports = { agruparEventos, claveMercado, resolverEvento };

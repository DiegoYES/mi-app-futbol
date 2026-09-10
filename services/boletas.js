const Partido = require('../models/partido');
const { evaluarMercado } = require('./pickTracking');

async function enriquecerBoletasConEvaluacion(boletas) {
  if (!boletas || !boletas.length) {
    return {
      resumen: { total: 0, pendientes: 0, acertadas: 0, falladas: 0, efectividad: null },
      boletas: []
    };
  }

  const partidoIds = [...new Set(boletas.flatMap(b => (b.selecciones || []).map(s => s.partido_api_id)).filter(Boolean))];
  const partidosPorId = new Map();
  if (partidoIds.length > 0) {
    const partidos = await Partido.find({ api_id: { $in: partidoIds } }).lean();
    partidos.forEach(p => partidosPorId.set(p.api_id, p));
  }

  const filtrosOr = [];
  for (const b of boletas) {
    for (const s of (b.selecciones || [])) {
      if (!s.partido_api_id && s.local?.id && s.visitante?.id) {
        filtrosOr.push({
          'equipo_local.id': s.local.id,
          'equipo_visitante.id': s.visitante.id,
          fecha: { $gte: new Date((b.creada_en || new Date()).getTime() - 48 * 3600 * 1000) }
        });
      }
    }
  }

  if (filtrosOr.length > 0) {
    const partidosCandidatos = await Partido.find({ $or: filtrosOr }).sort({ fecha: 1 }).lean();
    partidosCandidatos.forEach(p => {
      const clave = `${p.equipo_local.id}:${p.equipo_visitante.id}`;
      if (!partidosPorId.has(clave)) partidosPorId.set(clave, p);
    });
  }

  const boletasEnriquecidas = boletas.map(b => {
    let hayFallados = false;
    let hayPendientes = false;

    const seleccionesEnriquecidas = (b.selecciones || []).map(s => {
      const partido = s.partido_api_id ? partidosPorId.get(s.partido_api_id) : partidosPorId.get(`${s.local?.id}:${s.visitante?.id}`);
      let estado_seleccion = 'pendiente';
      let partido_info = null;

      if (partido) {
        partido_info = {
          api_id: partido.api_id,
          estado: partido.estado,
          fecha: partido.fecha,
          goles_local: partido.equipo_local?.goles,
          goles_visitante: partido.equipo_visitante?.goles
        };

        const finalizado = ['FT', 'AET', 'PEN'].includes(partido.estado);
        if (finalizado) {
          const resultado = evaluarMercado(s.mercado.id, partido);
          if (resultado === true) {
            estado_seleccion = 'acertado';
          } else if (resultado === false) {
            estado_seleccion = 'fallado';
            hayFallados = true;
          } else {
            estado_seleccion = 'pendiente';
            hayPendientes = true;
          }
        } else {
          estado_seleccion = 'pendiente';
          hayPendientes = true;
        }
      } else {
        estado_seleccion = 'pendiente';
        hayPendientes = true;
      }

      return {
        ...s,
        estado_seleccion,
        partido_info
      };
    });

    let estado_evaluacion = 'pendiente';
    if (hayFallados) {
      estado_evaluacion = 'fallada';
    } else if (!hayPendientes && seleccionesEnriquecidas.length > 0) {
      estado_evaluacion = 'acertada';
    } else {
      estado_evaluacion = 'pendiente';
    }

    return {
      ...b,
      estado_evaluacion,
      selecciones: seleccionesEnriquecidas
    };
  });

  const total = boletasEnriquecidas.length;
  const pendientes = boletasEnriquecidas.filter(b => b.estado_evaluacion === 'pendiente').length;
  const acertadas = boletasEnriquecidas.filter(b => b.estado_evaluacion === 'acertada').length;
  const falladas = boletasEnriquecidas.filter(b => b.estado_evaluacion === 'fallada').length;
  const resueltas = acertadas + falladas;
  const efectividad = resueltas > 0 ? Number(((acertadas / resueltas) * 100).toFixed(1)) : null;

  return {
    resumen: { total, pendientes, acertadas, falladas, efectividad },
    boletas: boletasEnriquecidas
  };
}

module.exports = {
  enriquecerBoletasConEvaluacion
};

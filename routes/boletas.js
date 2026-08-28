const express = require('express');
const { errorServidor } = require('../middleware/security');
const Boleta = require('../models/Boleta');
const Partido = require('../models/partido');
const { obtenerMercado } = require('../services/marketCatalog');
const { analizarCruce } = require('../services/pickAnalysis');
const { evaluarMercado } = require('../services/pickTracking');

const router = express.Router();

function entero(valor) {
  const numero = Number.parseInt(valor, 10);
  return Number.isInteger(numero) ? numero : null;
}

function condicion(valor, predeterminada) {
  const resultado = typeof valor === 'string' ? valor : predeterminada;
  return ['general', 'local', 'visitante'].includes(resultado) ? resultado : null;
}

function limite(valor) {
  if (valor === null) return null;
  if (valor === undefined) return 10;
  const resultado = entero(valor);
  return [3, 5, 10, 20].includes(resultado) ? resultado : undefined;
}

function periodo(valor) {
  if (valor === undefined) return 0;
  const resultado = entero(valor);
  return [0, 1, 2].includes(resultado) ? resultado : null;
}

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

router.post('/', async (req, res) => {
  try {
    const entradas = req.body?.selecciones;
    if (!Array.isArray(entradas) || entradas.length < 1 || entradas.length > 20) {
      return res.status(400).json({ error: 'Selecciona entre 1 y 20 mercados.' });
    }

    const unicas = new Map();
    for (const entrada of entradas) {
      const teamLocal = entero(entrada.team_local);
      const teamVisitante = entero(entrada.team_visitante);
      const leagueLocal = entero(entrada.league_local ?? entrada.league);
      const leagueVisitante = entero(entrada.league_visitante ?? entrada.league);
      const temporadaLocal = entero(entrada.temporada_local ?? entrada.temporada);
      const temporadaVisitante = entero(entrada.temporada_visitante ?? entrada.temporada);
      const condicionLocal = condicion(entrada.condicion_local, 'local');
      const condicionVisitante = condicion(entrada.condicion_visitante, 'visitante');
      const limiteLocal = limite(entrada.limite_local);
      const limiteVisitante = limite(entrada.limite_visitante);
      const halfLocal = periodo(entrada.periodo_local);
      const halfVisitante = periodo(entrada.periodo_visitante);
      const mercadoId = typeof entrada.mercado_id === 'string' ? entrada.mercado_id : '';
      const partidoApiId = entero(entrada.partido_api_id);
      if (![teamLocal, teamVisitante, leagueLocal, leagueVisitante].every(Number.isInteger) || teamLocal === teamVisitante || !condicionLocal || !condicionVisitante || limiteLocal === undefined || limiteVisitante === undefined || halfLocal === null || halfVisitante === null || !obtenerMercado(mercadoId)) {
        return res.status(400).json({ error: 'Una de las selecciones no es válida.' });
      }
      const clave = `${teamLocal}:${teamVisitante}:${leagueLocal}:${leagueVisitante}:${temporadaLocal ?? ''}:${temporadaVisitante ?? ''}:${condicionLocal}:${limiteLocal}:${halfLocal}:${condicionVisitante}:${limiteVisitante}:${halfVisitante}:${mercadoId}`;
      unicas.set(clave, {
        clave, teamLocal, teamVisitante, leagueLocal, leagueVisitante,
        temporadaLocal, temporadaVisitante, condicionLocal, condicionVisitante,
        limiteLocal, limiteVisitante, halfLocal, halfVisitante, mercadoId,
        partidoApiId
      });
    }

    const grupos = new Map();
    for (const seleccion of unicas.values()) {
      const claveGrupo = `${seleccion.teamLocal}:${seleccion.teamVisitante}:${seleccion.leagueLocal}:${seleccion.leagueVisitante}:${seleccion.temporadaLocal ?? ''}:${seleccion.temporadaVisitante ?? ''}:${seleccion.condicionLocal}:${seleccion.limiteLocal}:${seleccion.halfLocal}:${seleccion.condicionVisitante}:${seleccion.limiteVisitante}:${seleccion.halfVisitante}`;
      if (!grupos.has(claveGrupo)) grupos.set(claveGrupo, { ...seleccion, mercados: [] });
      grupos.get(claveGrupo).mercados.push(seleccion);
    }

    const selecciones = [];
    for (const grupo of grupos.values()) {
      const analisis = await analizarCruce(grupo);
      if (!analisis) return res.status(422).json({ error: 'No hay historial para uno de los cruces.' });
      for (const entrada of grupo.mercados) {
        const mercado = analisis.mercados.find(item => item.id === entrada.mercadoId);
        if (!mercado) {
          return res.status(422).json({ error: `No hay cobertura suficiente para ${entrada.mercadoId}.` });
        }
        selecciones.push({
          clave: entrada.clave,
          partido_api_id: entrada.partidoApiId || undefined,
          liga: { ...analisis.liga, temporada: analisis.temporadas.local },
          fuentes: {
            local: { ...analisis.ligas.local, temporada: analisis.temporadas.local },
            visitante: { ...analisis.ligas.visitante, temporada: analisis.temporadas.visitante }
          },
          local: analisis.local,
          visitante: analisis.visitante,
          mercado: {
            id: mercado.id,
            nombre: mercado.mercado,
            categoria: mercado.categoria,
            tipo: mercado.tipo,
            linea: mercado.linea,
            alcance: mercado.alcance
          },
          estimacion: mercado.estimacion,
          confianza: mercado.confianza,
          muestra: mercado.muestra,
          fuentes: mercado.fuentes,
          evidencia: mercado.evidencia,
          configuracion: {
            local: { condicion: grupo.condicionLocal, limite: grupo.limiteLocal, periodo: grupo.halfLocal },
            visitante: { condicion: grupo.condicionVisitante, limite: grupo.limiteVisitante, periodo: grupo.halfVisitante }
          }
        });
      }
    }

    const nombreSolicitado = typeof req.body?.nombre === 'string' ? req.body.nombre.trim() : '';
    const boleta = await Boleta.create({
      usuario: req.usuario._id,
      nombre: nombreSolicitado.slice(0, 100) || `Boleta ${new Date().toLocaleDateString('es-MX')}`,
      selecciones
    });
    res.status(201).json({ boleta });
  } catch (error) {
    errorServidor(res, error);
  }
});

router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const boletas = await Boleta.find({ usuario: req.usuario._id })
      .sort({ creada_en: -1 }).limit(100).lean();
    const datos = await enriquecerBoletasConEvaluacion(boletas);
    res.json(datos);
  } catch (error) {
    errorServidor(res, error);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const eliminada = await Boleta.findOneAndDelete({ _id: req.params.id, usuario: req.usuario._id });
    if (!eliminada) return res.status(404).json({ error: 'Boleta no encontrada.' });
    res.json({ mensaje: 'Boleta eliminada.' });
  } catch {
    res.status(400).json({ error: 'El identificador de la boleta no es válido.' });
  }
});

module.exports = router;


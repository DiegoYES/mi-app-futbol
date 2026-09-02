const express = require('express');
const { errorServidor } = require('../middleware/security');
const Partido = require('../models/partido');
const PickGuardado = require('../models/PickGuardado');
const { construirMercadosPersonalizados } = require('../services/marketCatalog');
const { evaluarMercadosEspecificos, explicarMercado, generarPicks } = require('../services/pickEngine');
const { evaluarMercado, idMercadoPeriodo, resumirRendimientoSegmentado } = require('../services/pickTracking');

const router = express.Router();
const ESTADOS_FINALIZADOS = new Set(['FT', 'AET', 'PEN']);

function esFinalizado(partido) {
  return ESTADOS_FINALIZADOS.has(partido?.estado);
}

async function obtenerHistoricos(partido) {
  // Historial reciente del equipo en cualquier rol: en torneos cortos un equipo
  // puede acumular todos sus partidos como local o visitante, y restringir por
  // rol dejaría al motor sin la mitad de la ecuación.
  const filtroBase = {
    'liga.id': partido.liga.id,
    'liga.temporada': partido.liga.temporada,
    estado: { $in: ['FT', 'AET', 'PEN'] },
    fecha: { $lt: partido.fecha },
    api_id: { $ne: partido.api_id }
  };
  return Promise.all([
    Partido.find({
      ...filtroBase,
      $or: [
        { 'equipo_local.id': partido.equipo_local.id },
        { 'equipo_visitante.id': partido.equipo_local.id }
      ]
    }).sort({ fecha: -1 }).limit(40).lean(),
    Partido.find({
      ...filtroBase,
      $or: [
        { 'equipo_local.id': partido.equipo_visitante.id },
        { 'equipo_visitante.id': partido.equipo_visitante.id }
      ]
    }).sort({ fecha: -1 }).limit(40).lean()
  ]);
}

function periodoValido(valor) {
  const periodo = Number.parseInt(valor ?? '0', 10);
  return [0, 1, 2].includes(periodo) ? periodo : null;
}

async function analizarPartido(partido, limite = 10, periodo = 0) {
  const [partidosLocal, partidosVisitante] = await obtenerHistoricos(partido);
  return generarPicks({
    partidosLocal,
    teamLocal: partido.equipo_local.id,
    partidosVisitante,
    teamVisitante: partido.equipo_visitante.id,
    limite,
    halfLocal: periodo,
    halfVisitante: periodo
  });
}

router.get('/partido/:id/explicacion/:mercado', async (req, res) => {
  try {
    const partidoId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(partidoId)) return res.status(400).json({ error: 'Partido inválido.' });
    const partido = await Partido.findOne({ api_id: partidoId }).lean();
    if (!partido) return res.status(404).json({ error: 'Partido no encontrado.' });
    const periodo = periodoValido(req.query.periodo);
    if (periodo === null) return res.status(400).json({ error: 'El periodo debe ser 0, 1 o 2.' });
    const [partidosLocal, partidosVisitante] = await obtenerHistoricos(partido);
    const explicacion = explicarMercado({
      partidosLocal,
      teamLocal: partido.equipo_local.id,
      partidosVisitante,
      teamVisitante: partido.equipo_visitante.id,
      mercadoId: req.params.mercado,
      limite: 10,
      halfLocal: periodo,
      halfVisitante: periodo,
      detalle: 3
    });
    if (!explicacion) return res.status(404).json({ error: 'Mercado no disponible.' });
    res.json({ explicacion });
  } catch (error) {
    errorServidor(res, error);
  }
});

router.get('/partido/:id/personalizado', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const partidoId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(partidoId)) return res.status(400).json({ error: 'Partido inválido.' });
    const partido = await Partido.findOne({ api_id: partidoId }).lean();
    if (!partido) return res.status(404).json({ error: 'Partido no encontrado.' });
    const periodo = periodoValido(req.query.periodo);
    if (periodo === null) return res.status(400).json({ error: 'El periodo debe ser 0, 1 o 2.' });

    const categoria = typeof req.query.categoria === 'string' ? req.query.categoria.trim() : '';
    const alcance = typeof req.query.alcance === 'string' ? req.query.alcance.trim() : '';
    const linea = Number(req.query.linea);
    if (!Number.isFinite(linea) || linea <= 0 || linea > 100) {
      return res.status(400).json({ error: 'La línea debe ser un número positivo válido.' });
    }

    const mercadosObjetivo = construirMercadosPersonalizados({ categoria, alcance, linea });
    if (!mercadosObjetivo.length) {
      return res.status(400).json({ error: 'No se pudo generar el mercado para esa categoría o alcance.' });
    }

    const [partidosLocal, partidosVisitante] = await obtenerHistoricos(partido);
    const evaluados = evaluarMercadosEspecificos({
      partidosLocal,
      teamLocal: partido.equipo_local.id,
      partidosVisitante,
      teamVisitante: partido.equipo_visitante.id,
      mercados: mercadosObjetivo,
      limite: 10,
      halfLocal: periodo,
      halfVisitante: periodo
    });

    const guardados = req.usuario?._id
      ? await PickGuardado.find({
          usuario: req.usuario._id,
          partido_api_id: partido.api_id
        }).select('mercado.id estado').lean()
      : [];

    const finalizado = esFinalizado(partido);

    const mercados = evaluados.map(mercado => ({
      ...mercado,
      guardado: guardados.some(item => item.mercado.id === idMercadoPeriodo(mercado.id, periodo)),
      resultado_historico: finalizado ? evaluarMercado(idMercadoPeriodo(mercado.id, periodo), partido) : null
    }));

    res.json({ mercados });
  } catch (error) {
    errorServidor(res, error);
  }
});

function datosPartido(partido) {
  return {
    api_id: partido.api_id,
    fecha: partido.fecha,
    estado: partido.estado,
    liga: partido.liga,
    local: partido.equipo_local,
    visitante: partido.equipo_visitante
  };
}

async function liquidarPendientes(usuarioId) {
  const pendientes = await PickGuardado.find({ usuario: usuarioId, estado: 'pendiente' }).lean();
  if (!pendientes.length) return;

  const partidos = await Partido.find({
    api_id: { $in: pendientes.map(pick => pick.partido_api_id) },
    estado: { $in: [...ESTADOS_FINALIZADOS] }
  }).lean();
  const porId = new Map(partidos.map(partido => [partido.api_id, partido]));
  const operaciones = [];

  for (const pick of pendientes) {
    const partido = porId.get(pick.partido_api_id);
    if (!partido) continue;
    const golesLocal = partido.equipo_local?.goles;
    const golesVisitante = partido.equipo_visitante?.goles;
    const acierto = evaluarMercado(pick.mercado.id, partido);
    if (acierto === null) continue;
    operaciones.push({
      updateOne: {
        filter: { _id: pick._id, estado: 'pendiente' },
        update: { $set: {
          estado: acierto ? 'acertado' : 'fallado',
          marcador_final: { local: golesLocal, visitante: golesVisitante },
          liquidado_en: new Date()
        } }
      }
    });
  }
  if (operaciones.length) await PickGuardado.bulkWrite(operaciones);
}

router.get('/partido/:id', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const partidoId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(partidoId)) {
      return res.status(400).json({ error: 'El partido no es válido.' });
    }
    const partido = await Partido.findOne({ api_id: partidoId }).lean();
    if (!partido) return res.status(404).json({ error: 'Partido no encontrado.' });
    const periodo = periodoValido(req.query.periodo);
    if (periodo === null) return res.status(400).json({ error: 'El periodo debe ser 0, 1 o 2.' });

    const resultado = await analizarPartido(partido, 10, periodo);
    const finalizado = esFinalizado(partido);
    const guardados = await PickGuardado.find({
      usuario: req.usuario._id,
      partido_api_id: partido.api_id
    }).select('mercado.id estado').lean();

    res.json({
      partido: datosPartido(partido),
      guardable: !finalizado && partido.fecha > new Date(),
      motivo_no_guardable: finalizado
        ? 'El partido ya terminó; se muestra como retrospectiva y no cuenta en tu rendimiento.'
        : partido.fecha <= new Date()
          ? 'El partido ya comenzó; los picks solo se guardan antes del inicio.'
          : null,
      periodo,
      mercados: resultado.mercados.map(mercado => ({
          ...mercado,
          guardado: guardados.some(item => item.mercado.id === idMercadoPeriodo(mercado.id, periodo)),
          resultado_historico: finalizado ? evaluarMercado(idMercadoPeriodo(mercado.id, periodo), partido) : null
      })),
      recomendados: resultado.recomendados.map(item => item.id),
      categorias: resultado.categorias,
      metodologia: resultado.metodologia
    });
  } catch (error) {
    errorServidor(res, error);
  }
});

router.post('/seguimiento', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const partidoId = Number.parseInt(req.body?.partido_id, 10);
    const mercadoId = typeof req.body?.mercado_id === 'string' ? req.body.mercado_id : '';
    const periodo = periodoValido(req.body?.periodo);
    if (!Number.isInteger(partidoId) || !mercadoId || periodo === null) {
      return res.status(400).json({ error: 'Partido y mercado son obligatorios.' });
    }
    const partido = await Partido.findOne({ api_id: partidoId }).lean();
    if (!partido) return res.status(404).json({ error: 'Partido no encontrado.' });
    if (esFinalizado(partido) || partido.fecha <= new Date()) {
      return res.status(409).json({ error: 'Solo puedes guardar picks antes del inicio del partido.' });
    }

    const resultado = await analizarPartido(partido, 10, periodo);
    let mercado = resultado.mercados.find(item => item.id === mercadoId);
    if (!mercado) {
      const [partidosLocal, partidosVisitante] = await obtenerHistoricos(partido);
      mercado = explicarMercado({
        partidosLocal,
        teamLocal: partido.equipo_local.id,
        partidosVisitante,
        teamVisitante: partido.equipo_visitante.id,
        mercadoId,
        limite: 10,
        halfLocal: periodo,
        halfVisitante: periodo,
        detalle: 0
      });
    }
    if (!mercado) return res.status(400).json({ error: 'Ese mercado no se puede evaluar.' });
    const pick = await PickGuardado.create({
      usuario: req.usuario._id,
      partido_api_id: partido.api_id,
      fecha_partido: partido.fecha,
      liga: partido.liga,
      local: partido.equipo_local,
      visitante: partido.equipo_visitante,
      mercado: {
        id: idMercadoPeriodo(mercado.id, periodo),
        base_id: mercado.id,
        nombre: `${mercado.mercado} · ${periodo === 0 ? 'Partido completo' : `${periodo}T`}`,
        categoria: mercado.categoria,
        tipo: mercado.tipo,
        linea: mercado.linea,
        alcance: mercado.alcance,
        periodo
      },
      estimacion: mercado.estimacion,
      confianza: mercado.confianza,
      muestra: mercado.muestra,
      evidencia: mercado.evidencia
    });
    res.status(201).json({ pick });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'Ese pick ya está guardado para este partido.' });
    }
    errorServidor(res, error);
  }
});

router.get('/seguimiento', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    await liquidarPendientes(req.usuario._id);
    const picks = await PickGuardado.find({ usuario: req.usuario._id })
      .sort({ fecha_partido: -1, creado_en: -1 }).limit(200).lean();
    const analitica = resumirRendimientoSegmentado(picks);
    res.json({ ...analitica, picks });
  } catch (error) {
    errorServidor(res, error);
  }
});

router.delete('/seguimiento/:id', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const eliminado = await PickGuardado.findOneAndDelete({
      _id: req.params.id,
      usuario: req.usuario._id,
      estado: 'pendiente'
    });
    if (!eliminado) {
      return res.status(404).json({ error: 'Pick pendiente no encontrado.' });
    }
    res.json({ mensaje: 'Pick eliminado.' });
  } catch (error) {
    res.status(400).json({ error: 'El identificador del pick no es válido.' });
  }
});

module.exports = router;
module.exports.analizarPartido = analizarPartido;
module.exports.liquidarPendientes = liquidarPendientes;

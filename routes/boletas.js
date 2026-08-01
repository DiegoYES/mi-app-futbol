const express = require('express');
const { errorServidor } = require('../middleware/security');
const Boleta = require('../models/Boleta');
const { obtenerMercado } = require('../services/marketCatalog');
const { analizarCruce } = require('../services/pickAnalysis');

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
      if (![teamLocal, teamVisitante, leagueLocal, leagueVisitante].every(Number.isInteger) || teamLocal === teamVisitante || !condicionLocal || !condicionVisitante || limiteLocal === undefined || limiteVisitante === undefined || halfLocal === null || halfVisitante === null || !obtenerMercado(mercadoId)) {
        return res.status(400).json({ error: 'Una de las selecciones no es válida.' });
      }
      const clave = `${teamLocal}:${teamVisitante}:${leagueLocal}:${leagueVisitante}:${temporadaLocal ?? ''}:${temporadaVisitante ?? ''}:${condicionLocal}:${limiteLocal}:${halfLocal}:${condicionVisitante}:${limiteVisitante}:${halfVisitante}:${mercadoId}`;
      unicas.set(clave, {
        clave, teamLocal, teamVisitante, leagueLocal, leagueVisitante,
        temporadaLocal, temporadaVisitante, condicionLocal, condicionVisitante,
        limiteLocal, limiteVisitante, halfLocal, halfVisitante, mercadoId
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
    const boletas = await Boleta.find({ usuario: req.usuario._id })
      .sort({ creada_en: -1 }).limit(100).lean();
    res.json({ boletas });
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

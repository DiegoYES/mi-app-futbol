const express = require('express');
const Boleta = require('../models/Boleta');
const { obtenerMercado } = require('../services/marketCatalog');
const { analizarCruce } = require('../services/pickAnalysis');

const router = express.Router();

function entero(valor) {
  const numero = Number.parseInt(valor, 10);
  return Number.isInteger(numero) ? numero : null;
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
      const mercadoId = typeof entrada.mercado_id === 'string' ? entrada.mercado_id : '';
      if (![teamLocal, teamVisitante, leagueLocal, leagueVisitante].every(Number.isInteger) || teamLocal === teamVisitante || !obtenerMercado(mercadoId)) {
        return res.status(400).json({ error: 'Una de las selecciones no es válida.' });
      }
      const clave = `${teamLocal}:${teamVisitante}:${leagueLocal}:${leagueVisitante}:${temporadaLocal ?? ''}:${temporadaVisitante ?? ''}:${mercadoId}`;
      unicas.set(clave, {
        clave, teamLocal, teamVisitante, leagueLocal, leagueVisitante,
        temporadaLocal, temporadaVisitante, mercadoId
      });
    }

    const grupos = new Map();
    for (const seleccion of unicas.values()) {
      const claveGrupo = `${seleccion.teamLocal}:${seleccion.teamVisitante}:${seleccion.leagueLocal}:${seleccion.leagueVisitante}:${seleccion.temporadaLocal ?? ''}:${seleccion.temporadaVisitante ?? ''}`;
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
          evidencia: mercado.evidencia
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
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const boletas = await Boleta.find({ usuario: req.usuario._id })
      .sort({ creada_en: -1 }).limit(100).lean();
    res.json({ boletas });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

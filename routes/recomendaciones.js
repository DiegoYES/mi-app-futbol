const express = require('express');
const Recomendacion = require('../models/Recomendacion');
const { errorServidor } = require('../middleware/security');
const {
  recomendacionParaUsuario,
  filtroRecomendacionesPublicas,
  enriquecerRecomendacionesConEvaluacion
} = require('../services/recomendaciones');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const ahora = new Date();
    // Consultamos todas las recomendaciones publicadas para nutrir activas e historial completo
    const recomendaciones = await Recomendacion.find(filtroRecomendacionesPublicas(ahora, { todasPublicadas: true }))
      .sort({ cierra_en: -1, publicada_en: -1 })
      .limit(100)
      .lean();

    const enriquecidas = await enriquecerRecomendacionesConEvaluacion(recomendaciones, { persistir: true });
    const tieneAcceso = req.usuario.estadoAcceso().tieneAcceso;
    const sanitizadas = enriquecidas.map(item => recomendacionParaUsuario(item, tieneAcceso));

    // Separación limpia:
    // Activas: Estado pendiente y la fecha de cierre aún no ha expirado (con 15 min de gracia de inicio de partido).
    // Historial: Ya evaluadas (acertado, fallado, anulado) o con hora de cierre rebasada.
    const activas = [];
    const historial = [];

    for (const rec of sanitizadas) {
      const esPendiente = !rec.resultado || rec.resultado === 'pendiente';
      const fechaCierre = rec.cierra_en ? new Date(rec.cierra_en) : null;
      const vigente = fechaCierre && (fechaCierre.getTime() >= (ahora.getTime() - 15 * 60 * 1000));

      if (esPendiente && vigente) {
        activas.push(rec);
      } else {
        historial.push(rec);
      }
    }

    // Ordenar activas: destacadas primero, y las que cierran más pronto primero
    activas.sort((a, b) => {
      const aDest = a.destacada ? 1 : 0;
      const bDest = b.destacada ? 1 : 0;
      if (aDest !== bDest) return bDest - aDest;
      return new Date(a.cierra_en).getTime() - new Date(b.cierra_en).getTime();
    });

    // Ordenar historial: resueltas más recientes primero
    historial.sort((a, b) => {
      return new Date(b.cierra_en).getTime() - new Date(a.cierra_en).getTime();
    });

    const acertadas = historial.filter(h => h.resultado === 'acertado' || h.resultado === 'acertada').length;
    const falladas = historial.filter(h => h.resultado === 'fallado' || h.resultado === 'fallada').length;
    const anuladas = historial.filter(h => h.resultado === 'anulado' || h.resultado === 'anulada').length;
    const resueltas = acertadas + falladas;
    const efectividad = resueltas > 0 ? Math.round((acertadas / resueltas) * 100) : null;

    res.json({
      tieneAcceso,
      activas,
      historial,
      resumen: {
        total_historial: historial.length,
        acertadas,
        falladas,
        anuladas,
        efectividad
      },
      // Preservado para retrocompatibilidad con clientes existentes
      recomendaciones: [...activas, ...historial]
    });
  } catch (error) {
    errorServidor(res, error);
  }
});

module.exports = router;

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
    const recomendaciones = await Recomendacion.find(filtroRecomendacionesPublicas(ahora))
      .sort({ destacada: -1, cierra_en: -1, publicada_en: -1 })
      .limit(100)
      .lean();

    const enriquecidas = await enriquecerRecomendacionesConEvaluacion(recomendaciones, { persistir: true });

    // Ordenar: 1) Activas/pendientes primero (destacadas y fecha de cierre más próxima)
    //          2) Resueltas recientes después (destacadas y fecha de cierre más reciente)
    enriquecidas.sort((a, b) => {
      const aPendiente = (!a.resultado || a.resultado === 'pendiente') ? 1 : 0;
      const bPendiente = (!b.resultado || b.resultado === 'pendiente') ? 1 : 0;
      if (aPendiente !== bPendiente) return bPendiente - aPendiente;

      const aDest = a.destacada ? 1 : 0;
      const bDest = b.destacada ? 1 : 0;
      if (aDest !== bDest) return bDest - aDest;

      const timeA = new Date(a.cierra_en).getTime();
      const timeB = new Date(b.cierra_en).getTime();
      if (aPendiente) return timeA - timeB;
      return timeB - timeA;
    });

    const tieneAcceso = req.usuario.estadoAcceso().tieneAcceso;
    res.json({
      tieneAcceso,
      recomendaciones: enriquecidas.map(item => recomendacionParaUsuario(item, tieneAcceso))
    });
  } catch (error) {
    errorServidor(res, error);
  }
});

module.exports = router;

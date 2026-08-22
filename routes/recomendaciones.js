const express = require('express');
const Recomendacion = require('../models/Recomendacion');
const { errorServidor } = require('../middleware/security');
const { recomendacionParaUsuario, filtroRecomendacionesPublicas } = require('../services/recomendaciones');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const recomendaciones = await Recomendacion.find(filtroRecomendacionesPublicas())
      .sort({ destacada: -1, cierra_en: -1, publicada_en: -1 })
      .limit(100)
      .lean();
    const tieneAcceso = req.usuario.estadoAcceso().tieneAcceso;
    res.json({
      tieneAcceso,
      recomendaciones: recomendaciones.map(item => recomendacionParaUsuario(item, tieneAcceso))
    });
  } catch (error) {
    errorServidor(res, error);
  }
});

module.exports = router;

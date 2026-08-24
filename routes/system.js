const express = require('express');
const mongoose = require('mongoose');
const { estadoRedis, redisHabilitado, redisListo } = require('../services/redisBackend');
const { obtenerVersionRelease } = require('../services/releaseVersion');

const router = express.Router();
const iniciadoEn = Date.now();

router.get('/live', (_req, res) => {
  res.json({ estado: 'ok', uptime_segundos: Math.floor((Date.now() - iniciadoEn) / 1000) });
});

router.get('/version', (_req, res) => res.json({ commit: obtenerVersionRelease() }));
router.get('/version/:commit', (req, res) => res.sendStatus(req.params.commit === obtenerVersionRelease() ? 204 : 409));

router.get('/ready', (_req, res) => {
  const mongoListo = mongoose.connection.readyState === 1;
  const dependenciasListas = mongoListo && redisListo();
  const dependencias = { mongodb: mongoListo ? 'ok' : 'no_disponible' };
  if (redisHabilitado()) dependencias.redis = estadoRedis();
  res.status(dependenciasListas ? 200 : 503).json({
    estado: dependenciasListas ? 'listo' : 'no_listo',
    dependencias
  });
});

module.exports = router;

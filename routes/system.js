const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();
const iniciadoEn = Date.now();

router.get('/live', (_req, res) => {
  res.json({ estado: 'ok', uptime_segundos: Math.floor((Date.now() - iniciadoEn) / 1000) });
});

router.get('/ready', (_req, res) => {
  const mongoListo = mongoose.connection.readyState === 1;
  res.status(mongoListo ? 200 : 503).json({
    estado: mongoListo ? 'listo' : 'no_listo',
    dependencias: { mongodb: mongoListo ? 'ok' : 'no_disponible' }
  });
});

module.exports = router;

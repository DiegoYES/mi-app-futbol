#!/usr/bin/env node
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { obtenerCalidadDatos } = require('../services/dataQuality');
const { evaluarAlertas, notificarAlertas } = require('../services/operationalAlerts');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const calidad = await obtenerCalidadDatos();
    const alertas = evaluarAlertas(calidad);
    const resultado = await notificarAlertas(alertas);
    console.log(JSON.stringify({ alertas, resultado }));
  } finally { await mongoose.disconnect(); }
})().catch(error => { console.error(`No se pudieron verificar alertas: ${error.message}`); process.exitCode = 1; });

require('dotenv').config();
const mongoose = require('mongoose');
const Partido = require('../models/partido');
const Equipo = require('../models/Equipo');
const Usuario = require('../models/Usuario');
const UsoApiDiario = require('../models/UsoApiDiario');
const PickGuardado = require('../models/PickGuardado');
const Boleta = require('../models/Boleta');
const JugadorPartido = require('../models/JugadorPartido');
const MercadoCasa = require('../models/MercadoCasa');
const ActualizacionMercados = require('../models/ActualizacionMercados');
const Sugerencia = require('../models/Sugerencia');
const BloqueoTrabajo = require('../models/BloqueoTrabajo');
const Suscripcion = require('../models/Suscripcion');
const EventoPago = require('../models/EventoPago');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  await mongoose.connect(process.env.MONGODB_URI);

  try {
    await Promise.all([
      Partido.createIndexes(),
      Equipo.createIndexes(),
      Usuario.createIndexes(),
      UsoApiDiario.createIndexes(),
      PickGuardado.createIndexes(),
      Boleta.createIndexes(),
      JugadorPartido.createIndexes(),
      MercadoCasa.createIndexes(),
      ActualizacionMercados.createIndexes(),
      Sugerencia.createIndexes(),
      BloqueoTrabajo.createIndexes(),
      Suscripcion.createIndexes(),
      EventoPago.createIndexes()
    ]);
    console.log('✅ Índices verificados: datos deportivos, usuarios, pagos, cuota API, picks, boletas, mercados y sugerencias.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error(`❌ No se pudieron crear los índices: ${error.message}`);
  process.exitCode = 1;
});

require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const Partido = require('../models/partido');

const CONFIRMACION = 'CLASIFICAR_COBERTURA_SIN_BORRAR';
const CAMPOS_BASICOS = [
  'equipo_local.tiros_total', 'equipo_local.corners',
  'equipo_visitante.tiros_total', 'equipo_visitante.corners'
];

function filtroSinCoberturaAgotada() {
  return {
    estado: { $in: ['FT', 'AET', 'PEN'] },
    estadisticas_completas: { $ne: true },
    estadisticas_no_disponibles: { $ne: true },
    estadisticas_intentos: { $gte: 3 },
    $or: CAMPOS_BASICOS.map(campo => ({ [campo]: { $not: { $type: 'number' } } }))
  };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  const ejecutar = process.argv.includes('--execute');
  const confirmacion = process.argv.find(arg => arg.startsWith('--confirm='))?.split('=').slice(1).join('=');
  if (ejecutar && confirmacion !== CONFIRMACION) throw new Error(`Para ejecutar usa --confirm=${CONFIRMACION}`);

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const filtro = filtroSinCoberturaAgotada();
    const total = await Partido.countDocuments(filtro);
    const muestra = await Partido.find(filtro).select('api_id fecha liga.nombre estadisticas_intentos').sort({ fecha: 1 }).limit(10).lean();
    console.log(JSON.stringify({ modo: ejecutar ? 'execute' : 'dry-run', candidatos: total, muestra }, null, 2));
    if (!ejecutar || !total) return;

    const ahora = new Date();
    const resultado = await Partido.updateMany(filtro, { $set: {
      estadisticas_no_disponibles: true,
      estadisticas_estado: 'sin_cobertura_proveedor',
      estadisticas_ausencia_motivo: 'metricas_basicas_incompletas',
      estadisticas_ultimo_intento_en: ahora
    } });
    console.log(JSON.stringify({ encontrados: resultado.matchedCount, clasificados: resultado.modifiedCount, eliminados: 0 }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { CAMPOS_BASICOS, CONFIRMACION, filtroSinCoberturaAgotada };

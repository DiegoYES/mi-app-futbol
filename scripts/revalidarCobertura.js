require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const Partido = require('../models/partido');

function argumento(nombre, defecto = null) {
  const indice = process.argv.indexOf(`--${nombre}`);
  return indice >= 0 ? process.argv[indice + 1] : defecto;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  const league = Number(argumento('league', 253));
  const seasonArg = argumento('season');
  const reabrir = process.argv.includes('--reabrir');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const filtro = { 'liga.id': league, estado: { $in: ['FT', 'AET', 'PEN'] } };
    if (seasonArg) filtro['liga.temporada'] = Number(seasonArg);
    const resumen = await Partido.aggregate([
      { $match: filtro },
      { $group: {
        _id: '$liga.temporada', partidos: { $sum: 1 },
        completos: { $sum: { $cond: ['$estadisticas_completas', 1, 0] } },
        cornersLocalCero: { $sum: { $cond: [{ $eq: ['$equipo_local.corners', 0] }, 1, 0] } },
        cornersVisitanteCero: { $sum: { $cond: [{ $eq: ['$equipo_visitante.corners', 0] }, 1, 0] } },
        cornersAusentes: { $sum: { $cond: [{ $or: [
          { $eq: [{ $type: '$equipo_local.corners' }, 'missing'] },
          { $eq: [{ $type: '$equipo_visitante.corners' }, 'missing'] }
        ] }, 1, 0] } }
      } },
      { $sort: { _id: -1 } }
    ]);
    console.log(JSON.stringify({ liga: league, temporadas: resumen }, null, 2));
    if (!reabrir) return;
    if (!seasonArg) throw new Error('--reabrir exige --season para limitar el alcance.');
    const resultado = await Partido.updateMany(filtro, { $set: {
      estadisticas_completas: false,
      detalle_completo: false,
      estadisticas_no_disponibles: false,
      detalle_consultado_en: null
    } });
    console.log(`Reabiertos ${resultado.modifiedCount} partidos para revalidación.`);
  } finally { await mongoose.disconnect(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

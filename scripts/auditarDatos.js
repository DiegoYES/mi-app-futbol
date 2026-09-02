require('dotenv').config();
const mongoose = require('mongoose');
const Partido = require('../models/partido');
const Equipo = require('../models/Equipo');

function porcentaje(parte, total) {
  return total === 0 ? 0 : Number(((parte / total) * 100).toFixed(1));
}

async function auditar() {
  const [totalPartidos, totalEquipos, ligas, inconsistencias, indicesPartidos, indicesEquipos] = await Promise.all([
    Partido.countDocuments({}),
    Equipo.countDocuments({}),
    Partido.aggregate([
      {
        $group: {
          _id: { id: '$liga.id', temporada: '$liga.temporada' },
          nombre: { $first: '$liga.nombre' },
          partidos: { $sum: 1 },
          finalizados: { $sum: { $cond: [{ $in: ['$estado', ['FT', 'AET', 'PEN']] }, 1, 0] } },
          estadisticas: { $sum: { $cond: ['$estadisticas_completas', 1, 0] } },
          tiempos: { $sum: { $cond: ['$tiempos_completos', 1, 0] } },
          eventos: { $sum: { $cond: ['$eventos_completos', 1, 0] } },
          detalles: { $sum: { $cond: ['$detalle_completo', 1, 0] } },
          jugadores: { $sum: { $cond: ['$jugadores_completos', 1, 0] } },
          desde: { $min: '$fecha' },
          hasta: { $max: '$fecha' }
        }
      },
      { $sort: { '_id.temporada': -1, nombre: 1 } }
    ]),
    Promise.all([
      Partido.countDocuments({
        estado: { $in: ['FT', 'AET', 'PEN'] },
        $expr: {
          $ne: [
            { $ifNull: ['$total_goles', 0] },
            { $add: [{ $ifNull: ['$equipo_local.goles', 0] }, { $ifNull: ['$equipo_visitante.goles', 0] }] }
          ]
        }
      }),
      Partido.countDocuments({
        estado: { $in: ['FT', 'AET', 'PEN'] },
        $expr: {
          $ne: [
            { $ifNull: ['$ambos_anotan', false] },
            {
              $and: [
                { $gt: [{ $ifNull: ['$equipo_local.goles', 0] }, 0] },
                { $gt: [{ $ifNull: ['$equipo_visitante.goles', 0] }, 0] }
              ]
            }
          ]
        }
      }),
      Partido.countDocuments({
        $or: [
          { 'equipo_local.id': { $exists: false } },
          { 'equipo_visitante.id': { $exists: false } },
          { 'liga.temporada': { $exists: false } }
        ]
      }),
      Partido.countDocuments({
        tiempos_completos: true,
        $or: [
          { 'equipo_local.estadisticas_1t': { $exists: false } },
          { 'equipo_local.estadisticas_2t': { $exists: false } },
          { 'equipo_visitante.estadisticas_1t': { $exists: false } },
          { 'equipo_visitante.estadisticas_2t': { $exists: false } }
        ]
      }),
      Partido.countDocuments({
        estado: { $in: ['FT', 'AET', 'PEN'] },
        estadisticas_completas: true,
        $or: [
          {
            $expr: {
              $and: [
                { $gt: [{ $ifNull: ['$equipo_local.goles', 0] }, 0] },
                { $lt: [{ $ifNull: ['$equipo_local.tiros_total', 0] }, { $ifNull: ['$equipo_local.goles', 0] }] }
              ]
            }
          },
          {
            $expr: {
              $and: [
                { $gt: [{ $ifNull: ['$equipo_visitante.goles', 0] }, 0] },
                { $lt: [{ $ifNull: ['$equipo_visitante.tiros_total', 0] }, { $ifNull: ['$equipo_visitante.goles', 0] }] }
              ]
            }
          }
        ]
      })
    ]),
    Partido.collection.indexes(),
    Equipo.collection.indexes()
  ]);

  return {
    generado_en: new Date().toISOString(),
    totales: { partidos: totalPartidos, equipos: totalEquipos },
    ligas: ligas.map(item => ({
      id: item._id.id,
      nombre: item.nombre,
      temporada: item._id.temporada,
      partidos: item.partidos,
      finalizados: item.finalizados,
      cobertura: {
        estadisticas: `${item.estadisticas}/${item.finalizados} (${porcentaje(item.estadisticas, item.finalizados)}%)`,
        tiempos: `${item.tiempos}/${item.finalizados} (${porcentaje(item.tiempos, item.finalizados)}%)`,
        eventos: `${item.eventos}/${item.finalizados} (${porcentaje(item.eventos, item.finalizados)}%)`,
        detalles: `${item.detalles}/${item.finalizados} (${porcentaje(item.detalles, item.finalizados)}%)`,
        jugadores: `${item.jugadores}/${item.finalizados} (${porcentaje(item.jugadores, item.finalizados)}%)`
      },
      desde: item.desde,
      hasta: item.hasta
    })),
    inconsistencias: {
      total_goles: inconsistencias[0],
      ambos_anotan: inconsistencias[1],
      identificadores_o_temporada_faltantes: inconsistencias[2],
      tiempos_marcados_completos_sin_subdocumentos: inconsistencias[3],
      tiros_menor_que_goles: inconsistencias[4]
    },
    indices: {
      partidos: indicesPartidos.map(indice => ({ nombre: indice.name, campos: indice.key })),
      equipos: indicesEquipos.map(indice => ({ nombre: indice.name, campos: indice.key }))
    }
  };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    console.log(JSON.stringify(await auditar(), null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`❌ Auditoría fallida: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { auditar, porcentaje };

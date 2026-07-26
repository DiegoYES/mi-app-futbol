require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const Partido = require('../models/partido');
const config = require('../config/leagues');

function llamadasLote(partidos) {
  return Math.ceil(partidos / 20);
}

async function planLiga(leagueId, season) {
  const base = { 'liga.id': leagueId, 'liga.temporada': season, estado: { $in: ['FT', 'AET', 'PEN'] } };
  const [finalizados, sinStats, sinEventos, sinJugadores, sinTiempos] = await Promise.all([
    Partido.countDocuments(base),
    Partido.countDocuments({ ...base, estadisticas_completas: { $ne: true } }),
    Partido.countDocuments({ ...base, eventos_completos: { $ne: true } }),
    Partido.countDocuments({ ...base, jugadores_completos: { $ne: true } }),
    Partido.countDocuments({ ...base, tiempos_completos: { $ne: true } })
  ]);
  const pendientesDetalle = await Partido.countDocuments({ ...base, detalle_completo: { $ne: true } });
  return {
    liga: { id: leagueId, nombre: config.ligas[leagueId]?.nombre || String(leagueId) },
    temporada: season,
    finalizados,
    pendientes: { estadisticas: sinStats, eventos: sinEventos, jugadores: sinJugadores, tiempos: sinTiempos },
    costo_estimado: {
      detalle_completo_en_lotes: llamadasLote(pendientesDetalle),
      tiempos_1t_2t_separados: sinTiempos * 2
    },
    recomendacion: 'Primero detalle completo en lotes; deja 1T/2T para después de validar los mercados de partido completo.'
  };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  const season = Number(process.env.FOOTBALL_SEASON || config.seasonDefault);
  const ligas = (process.env.SYNC_LEAGUES || '39').split(',').map(Number).filter(Number.isInteger);
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    console.log(JSON.stringify({
      generado_en: new Date().toISOString(),
      notas: [
        'Una llamada /fixtures?ids=... admite hasta 20 partidos.',
        'El detalle puede traer estadísticas, eventos, alineaciones y jugadores.',
        'Las estadísticas separadas por tiempo siguen costando dos llamadas por partido.'
      ],
      ligas: await Promise.all(ligas.map(liga => planLiga(liga, season)))
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`❌ No se pudo crear el plan: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { llamadasLote, planLiga };

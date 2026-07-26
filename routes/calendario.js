const express = require('express');
const Partido = require('../models/partido');
const config = require('../config/leagues');

const router = express.Router();

// Convierte 'YYYY-MM-DD' al rango [00:00, 23:59:59.999] de ese día en hora local
function rangoDelDia(textoFecha) {
  const [anio, mes, dia] = textoFecha.split('-').map(Number);
  if (!anio || !mes || !dia) return null;
  const inicio = new Date(anio, mes - 1, dia, 0, 0, 0, 0);
  const fin = new Date(anio, mes - 1, dia, 23, 59, 59, 999);
  if (isNaN(inicio.getTime())) return null;
  return { inicio, fin };
}

function esFinalizado(estado) {
  return ['FT', 'AET', 'PEN'].includes(estado);
}

// Partidos de una fecha concreta, agrupados por competición
router.get('/dia', async (req, res) => {
  try {
    const texto = req.query.fecha || new Date().toISOString().slice(0, 10);
    const rango = rangoDelDia(texto);
    if (!rango) return res.status(400).json({ error: 'Fecha inválida. Usa el formato YYYY-MM-DD' });

    const filtro = { fecha: { $gte: rango.inicio, $lte: rango.fin } };
    if (req.query.league) filtro['liga.id'] = parseInt(req.query.league);

    const partidos = await Partido.find(filtro).sort({ fecha: 1 }).lean();

    const porLiga = new Map();
    for (const p of partidos) {
      const idLiga = p.liga?.id;
      if (!porLiga.has(idLiga)) {
        porLiga.set(idLiga, {
          liga_id: idLiga,
          liga: p.liga?.nombre || config.ligas[idLiga]?.nombre || `Liga ${idLiga}`,
          pais: config.ligas[idLiga]?.pais || '',
          partidos: []
        });
      }

      const finalizado = esFinalizado(p.estado);
      porLiga.get(idLiga).partidos.push({
        api_id: p.api_id,
        fecha: p.fecha,
        hora: new Date(p.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
        estado: p.estado,
        finalizado,
        jornada: p.liga?.jornada || '',
        local: {
          id: p.equipo_local?.id,
          nombre: p.equipo_local?.nombre,
          logo: p.equipo_local?.logo,
          goles: finalizado ? p.equipo_local?.goles : null
        },
        visitante: {
          id: p.equipo_visitante?.id,
          nombre: p.equipo_visitante?.nombre,
          logo: p.equipo_visitante?.logo,
          goles: finalizado ? p.equipo_visitante?.goles : null
        }
      });
    }

    res.json({
      fecha: texto,
      total: partidos.length,
      competiciones: Array.from(porLiga.values()).sort((a, b) => a.liga.localeCompare(b.liga, 'es'))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Días con partidos dentro de un mes, para marcarlos en el navegador de fechas
router.get('/mes', async (req, res) => {
  try {
    const anio = parseInt(req.query.anio);
    const mes = parseInt(req.query.mes); // 1-12
    if (!anio || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ error: 'Parámetros anio y mes (1-12) obligatorios' });
    }

    const inicio = new Date(anio, mes - 1, 1, 0, 0, 0, 0);
    const fin = new Date(anio, mes, 0, 23, 59, 59, 999);

    const dias = await Partido.aggregate([
      { $match: { fecha: { $gte: inicio, $lte: fin } } },
      { $group: { _id: { $dayOfMonth: { date: '$fecha', timezone: 'America/Mexico_City' } }, total: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      anio,
      mes,
      dias: dias.map(d => ({ dia: d._id, partidos: d.total }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rango global de fechas disponibles, para limitar la navegación
router.get('/rango', async (req, res) => {
  try {
    const [r] = await Partido.aggregate([
      { $group: { _id: null, min: { $min: '$fecha' }, max: { $max: '$fecha' } } }
    ]);

    if (!r) return res.json({ desde: null, hasta: null, total: 0 });

    const total = await Partido.countDocuments({});
    res.json({
      desde: r.min?.toISOString().slice(0, 10),
      hasta: r.max?.toISOString().slice(0, 10),
      total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

const express = require('express');
const Partido = require('../models/partido');
const JugadorPartido = require('../models/JugadorPartido');
const PickGuardado = require('../models/PickGuardado');
const Boleta = require('../models/Boleta');
const config = require('../config/leagues');
const { etiquetaTemporada } = require('../services/seasonLabel');
const { construirCatalogo } = require('../services/competitionCatalog');

const router = express.Router();

async function obtenerCompeticiones() {
  return Partido.aggregate([
    { $group: {
      _id: { id: '$liga.id', temporada: '$liga.temporada' },
      nombre: { $first: '$liga.nombre' },
      partidos: { $sum: 1 },
      finalizados: { $sum: { $cond: [{ $in: ['$estado', ['FT', 'AET', 'PEN']] }, 1, 0] } },
      estadisticas: { $sum: { $cond: ['$estadisticas_completas', 1, 0] } },
      detalles: { $sum: { $cond: ['$detalle_completo', 1, 0] } },
      jugadores: { $sum: { $cond: ['$jugadores_completos', 1, 0] } },
      desde: { $min: '$fecha' },
      hasta: { $max: '$fecha' }
    } },
    { $sort: { '_id.temporada': -1, nombre: 1 } }
  ]);
}

router.get('/resumen', async (req, res) => {
  try {
    const [partidos, conEstadisticas, jugadores, picks, boletas, rango, competiciones] = await Promise.all([
      Partido.countDocuments({}),
      Partido.countDocuments({ estadisticas_completas: true }),
      JugadorPartido.distinct('jugador.id'),
      PickGuardado.countDocuments({ usuario: req.usuario._id }),
      Boleta.countDocuments({ usuario: req.usuario._id }),
      Partido.aggregate([{ $group: { _id: null, desde: { $min: '$fecha' }, hasta: { $max: '$fecha' } } }]),
      obtenerCompeticiones()
    ]);
    res.json({
      partidos,
      con_estadisticas: conEstadisticas,
      jugadores: jugadores.length,
      picks,
      boletas,
      ligas: new Set(competiciones.map(item => Number(item._id.id))).size,
      competiciones: new Set(competiciones.map(item => Number(item._id.id))).size,
      temporadas_guardadas: competiciones.length,
      rango: rango[0] || { desde: null, hasta: null },
      temporadas: [...new Set(competiciones.map(item => item._id.temporada))].sort((a, b) => b - a)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/competiciones', async (_req, res) => {
  try {
    const filas = await obtenerCompeticiones();
    const competiciones = construirCatalogo(filas, config.ligas, etiquetaTemporada);
    res.json({
      competiciones,
      total: competiciones.length,
      temporadas_guardadas: filas.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/competiciones/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Competición inválida.' });
    const temporadas = await Partido.distinct('liga.temporada', { 'liga.id': id });
    temporadas.sort((a, b) => b - a);
    const solicitada = req.query.season === undefined ? temporadas[0] : Number.parseInt(req.query.season, 10);
    if (!Number.isInteger(solicitada) || !temporadas.includes(solicitada)) return res.status(404).json({ error: 'La temporada no está guardada.' });
    const partidos = await Partido.find({ 'liga.id': id, 'liga.temporada': solicitada }).sort({ fecha: -1 }).lean();
    const finalizados = partidos.filter(partido => ['FT', 'AET', 'PEN'].includes(partido.estado));
    const finalizado = partido => ['FT', 'AET', 'PEN'].includes(partido.estado);
    const porJornada = new Map();
    for (const partido of partidos) {
      const nombreJornada = String(partido.liga?.jornada || 'Sin jornada');
      if (!porJornada.has(nombreJornada)) porJornada.set(nombreJornada, []);
      porJornada.get(nombreJornada).push(partido);
    }
    const jornadas = [...porJornada.entries()].map(([nombreJornada, lista]) => {
      const terminados = lista.filter(finalizado);
      return {
        nombre: nombreJornada,
        partidos: lista.length,
        finalizados: terminados.length,
        desde: lista.reduce((min, p) => !min || p.fecha < min ? p.fecha : min, null),
        hasta: lista.reduce((max, p) => !max || p.fecha > max ? p.fecha : max, null)
      };
    }).sort((a, b) => new Date(a.desde) - new Date(b.desde));
    const jornadaPedida = typeof req.query.round === 'string' ? req.query.round : '';
    const jornadaPredeterminada = [...jornadas].reverse().find(item => item.finalizados > 0)?.nombre || jornadas[0]?.nombre || null;
    const jornadaSeleccionada = porJornada.has(jornadaPedida) ? jornadaPedida : jornadaPredeterminada;
    const partidosJornada = jornadaSeleccionada ? porJornada.get(jornadaSeleccionada) || [] : [];
    const finalizadosJornada = partidosJornada.filter(finalizado);
    const idsJornada = partidosJornada.map(partido => partido.api_id);
    const jugadoresJornada = idsJornada.length ? await JugadorPartido.aggregate([
      { $match: { partido_api_id: { $in: idsJornada }, 'liga.id': id, 'liga.temporada': solicitada } },
      { $group: {
        _id: '$jugador.id', nombre: { $first: '$jugador.nombre' }, foto: { $first: '$jugador.foto' },
        posicion: { $first: '$posicion' }, equipo_id: { $first: '$equipo.id' }, equipo: { $first: '$equipo.nombre' },
        partidos: { $sum: 1 }, minutos: { $sum: { $ifNull: ['$minutos', 0] } },
        goles: { $sum: { $ifNull: ['$goles', 0] } }, asistencias: { $sum: { $ifNull: ['$asistencias', 0] } },
        tiros: { $sum: { $ifNull: ['$tiros', 0] } }, tiros_puerta: { $sum: { $ifNull: ['$tiros_puerta', 0] } },
        pases_clave: { $sum: { $ifNull: ['$pases_clave', 0] } }, entradas: { $sum: { $ifNull: ['$entradas', 0] } },
        atajadas: { $sum: { $ifNull: ['$atajadas', 0] } }, amarillas: { $sum: { $ifNull: ['$amarillas', 0] } },
        suma_calificacion: { $sum: { $cond: [{ $ne: ['$calificacion', null] }, '$calificacion', 0] } },
        calificaciones: { $sum: { $cond: [{ $ne: ['$calificacion', null] }, 1, 0] } }
      } },
      { $addFields: { calificacion: { $cond: [{ $gt: ['$calificaciones', 0] }, { $round: [{ $divide: ['$suma_calificacion', '$calificaciones'] }, 2] }, null] } } },
      { $sort: { goles: -1, asistencias: -1, calificacion: -1, minutos: -1, nombre: 1 } },
      { $limit: 40 },
      { $project: { _id: 0, id: '$_id', nombre: 1, foto: 1, posicion: 1, equipo_id: 1, equipo: 1, partidos: 1, minutos: 1, goles: 1, asistencias: 1, tiros: 1, tiros_puerta: 1, pases_clave: 1, entradas: 1, atajadas: 1, amarillas: 1, calificacion: 1 } }
    ]) : [];
    const totalMetrica = campo => finalizadosJornada.reduce((total, partido) => total + (Number(partido.equipo_local?.[campo]) || 0) + (Number(partido.equipo_visitante?.[campo]) || 0), 0);
    const golesJornada = totalMetrica('goles');
    const tabla = new Map();
    const fila = equipo => {
      if (!tabla.has(equipo.id)) tabla.set(equipo.id, { id: equipo.id, nombre: equipo.nombre, jugados: 0, ganados: 0, empatados: 0, perdidos: 0, goles_favor: 0, goles_contra: 0, puntos: 0 });
      return tabla.get(equipo.id);
    };
    for (const partido of finalizados) {
      const local = fila(partido.equipo_local);
      const visitante = fila(partido.equipo_visitante);
      const gl = Number(partido.equipo_local.goles) || 0;
      const gv = Number(partido.equipo_visitante.goles) || 0;
      local.jugados++; visitante.jugados++;
      local.goles_favor += gl; local.goles_contra += gv;
      visitante.goles_favor += gv; visitante.goles_contra += gl;
      if (gl > gv) { local.ganados++; local.puntos += 3; visitante.perdidos++; }
      else if (gv > gl) { visitante.ganados++; visitante.puntos += 3; local.perdidos++; }
      else { local.empatados++; visitante.empatados++; local.puntos++; visitante.puntos++; }
    }
    const clasificacion = [...tabla.values()].map(item => ({ ...item, diferencia: item.goles_favor - item.goles_contra }))
      .sort((a, b) => b.puntos - a.puntos || b.diferencia - a.diferencia || b.goles_favor - a.goles_favor || a.nombre.localeCompare(b.nombre, 'es'));
    const goles = finalizados.reduce((total, p) => total + (Number(p.equipo_local.goles) || 0) + (Number(p.equipo_visitante.goles) || 0), 0);
    const nombre = partidos[0]?.liga?.nombre || config.ligas[id]?.nombre || `Competición ${id}`;
    res.json({
      competencia: {
        id, nombre, pais: config.ligas[id]?.pais || 'Internacional', temporada: solicitada,
        temporada_etiqueta: etiquetaTemporada(id, solicitada),
        temporadas,
        temporadas_etiquetas: temporadas.map(temporada => ({ temporada, etiqueta: etiquetaTemporada(id, temporada) }))
      },
      resumen: {
        partidos: partidos.length,
        finalizados: finalizados.length,
        goles,
        goles_por_partido: finalizados.length ? Number((goles / finalizados.length).toFixed(2)) : null,
        estadisticas: partidos.filter(p => p.estadisticas_completas).length,
        jugadores: partidos.filter(p => p.jugadores_completos).length
      },
      clasificacion,
      clasificacion_oficial: config.ligas[id]?.liga_principal === true,
      jornadas,
      jornada: jornadaSeleccionada ? {
        nombre: jornadaSeleccionada,
        resumen: {
          partidos: partidosJornada.length,
          finalizados: finalizadosJornada.length,
          goles: golesJornada,
          goles_por_partido: finalizadosJornada.length ? Number((golesJornada / finalizadosJornada.length).toFixed(2)) : null,
          victorias_local: finalizadosJornada.filter(p => Number(p.equipo_local.goles) > Number(p.equipo_visitante.goles)).length,
          empates: finalizadosJornada.filter(p => Number(p.equipo_local.goles) === Number(p.equipo_visitante.goles)).length,
          victorias_visitante: finalizadosJornada.filter(p => Number(p.equipo_local.goles) < Number(p.equipo_visitante.goles)).length,
          tiros: totalMetrica('tiros_total'), tiros_puerta: totalMetrica('tiros_puerta'), corners: totalMetrica('corners'),
          faltas: totalMetrica('faltas'), amarillas: totalMetrica('tarjetas_amarillas'), rojas: totalMetrica('tarjetas_rojas')
        },
        partidos: [...partidosJornada].sort((a, b) => new Date(a.fecha) - new Date(b.fecha)).map(p => ({
          api_id: p.api_id, fecha: p.fecha, estado: p.estado,
          local: { id: p.equipo_local.id, nombre: p.equipo_local.nombre, goles: p.equipo_local.goles },
          visitante: { id: p.equipo_visitante.id, nombre: p.equipo_visitante.nombre, goles: p.equipo_visitante.goles }
        })),
        jugadores: jugadoresJornada
      } : null,
      recientes: partidos.slice(0, 12).map(p => ({
        api_id: p.api_id, fecha: p.fecha, estado: p.estado,
        local: { id: p.equipo_local.id, nombre: p.equipo_local.nombre, goles: p.equipo_local.goles },
        visitante: { id: p.equipo_visitante.id, nombre: p.equipo_visitante.nombre, goles: p.equipo_visitante.goles }
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

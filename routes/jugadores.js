const express = require('express');
const JugadorPartido = require('../models/JugadorPartido');
const Partido = require('../models/partido');
const { tokens } = require('../public/search-utils');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const limite = Math.min(Math.max(Number.parseInt(req.query.limite || '60', 10), 1), 200);
    const match = {};
    const league = Number.parseInt(req.query.league, 10);
    const season = Number.parseInt(req.query.season, 10);
    if (Number.isInteger(league)) match['liga.id'] = league;
    if (Number.isInteger(season)) match['liga.temporada'] = season;
    const q = String(req.query.q || '').slice(0, 80);
    const acentos = { a: '[aáàäâã]', e: '[eéèëê]', i: '[iíìïî]', o: '[oóòöôõ]', u: '[uúùüû]', n: '[nñ]' };
    const fragmentos = tokens(q).map(token => [...token].map(letra => acentos[letra] || letra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(''));
    if (fragmentos.length) match.$and = fragmentos.map(patron => ({ 'jugador.nombre': { $regex: patron, $options: 'i' } }));
    const jugadores = await JugadorPartido.aggregate([
      { $match: match },
      { $sort: { fecha: -1 } },
      { $group: {
        _id: '$jugador.id',
        nombre: { $first: '$jugador.nombre' },
        foto: { $first: '$jugador.foto' },
        posicion: { $first: '$posicion' },
        equipos: { $addToSet: '$equipo.nombre' },
        partidos: { $sum: 1 },
        minutos: { $sum: '$minutos' },
        goles: { $sum: '$goles' },
        asistencias: { $sum: '$asistencias' },
        tiros: { $sum: '$tiros' },
        tiros_puerta: { $sum: '$tiros_puerta' },
        amarillas: { $sum: '$amarillas' },
        faltas: { $sum: '$faltas_cometidas' }
      } },
      { $sort: { partidos: -1, nombre: 1 } },
      { $limit: limite },
      { $project: { _id: 0, id: '$_id', nombre: 1, foto: 1, posicion: 1, equipos: 1, partidos: 1, minutos: 1, goles: 1, asistencias: 1, tiros: 1, tiros_puerta: 1, amarillas: 1, faltas: 1 } }
    ]);
    res.json({ jugadores });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const league = Number.parseInt(req.query.league, 10);
    const season = Number.parseInt(req.query.season, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Jugador inválido.' });
    const filtro = { 'jugador.id': id };
    if (Number.isInteger(league)) filtro['liga.id'] = league;
    if (Number.isInteger(season)) filtro['liga.temporada'] = season;
    const registros = await JugadorPartido.find(filtro).sort({ fecha: -1 }).lean();
    if (!registros.length) return res.status(404).json({ error: 'No hay partidos guardados para este jugador.' });
    const primero = registros[0];
    const campos = ['minutos', 'goles', 'asistencias', 'tiros', 'tiros_puerta', 'pases', 'pases_clave', 'entradas', 'intercepciones', 'duelos', 'duelos_ganados', 'regates', 'regates_exitosos', 'faltas_recibidas', 'faltas_cometidas', 'amarillas', 'rojas', 'atajadas', 'offsides'];
    const totales = Object.fromEntries(campos.map(campo => [campo, registros.reduce((total, item) => total + (Number(item[campo]) || 0), 0)]));
    const partidos = await Partido.find({ api_id: { $in: registros.slice(0, 12).map(item => item.partido_api_id) } }).select('api_id equipo_local equipo_visitante').lean();
    const porPartido = new Map(partidos.map(partido => [partido.api_id, partido]));
    const recientes = registros.slice(0, 12).map(item => {
      const partido = porPartido.get(item.partido_api_id);
      const rival = partido?.equipo_local?.id === item.equipo.id ? partido.equipo_visitante : partido?.equipo_local;
      return { partido_api_id: item.partido_api_id, fecha: item.fecha, liga: item.liga, equipo: item.equipo, rival: rival ? { id: rival.id, nombre: rival.nombre } : null, posicion: item.posicion, titular: item.titular, minutos: item.minutos, calificacion: item.calificacion, goles: item.goles, asistencias: item.asistencias, tiros: item.tiros, tiros_puerta: item.tiros_puerta, faltas_cometidas: item.faltas_cometidas, amarillas: item.amarillas };
    });
    res.json({
      jugador: { id, nombre: primero.jugador.nombre, foto: primero.jugador.foto, posicion: primero.posicion, equipo: primero.equipo },
      partidos: registros.length,
      totales,
      promedios_90: Object.fromEntries(campos.filter(c => c !== 'minutos').map(campo => [campo, totales.minutos ? Number((totales[campo] * 90 / totales.minutos).toFixed(2)) : null])),
      competiciones: [...new Map(registros.map(item => [item.liga.id, item.liga])).values()],
      recientes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

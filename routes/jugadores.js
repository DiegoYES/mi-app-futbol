const express = require('express');
const JugadorPartido = require('../models/JugadorPartido');
const Partido = require('../models/partido');
const { tokens } = require('../public/search-utils');
const { errorServidor, escaparRegex, textoDeConsulta } = require('../middleware/security');

const router = express.Router();

const LIMITE_RECIENTES = 25;
// Tres partidos completos: mínimo para que un promedio por 90 tenga sentido.
const MINUTOS_MUESTRA_MINIMA = 270;

router.get('/', async (req, res) => {
  try {
    const limite = Math.min(Math.max(Number.parseInt(req.query.limite || '60', 10), 1), 200);
    const match = {};
    const league = Number.parseInt(req.query.league, 10);
    const season = Number.parseInt(req.query.season, 10);
    const team = Number.parseInt(req.query.team, 10);
    if (!Number.isInteger(league) || !Number.isInteger(season)) {
      return res.status(400).json({ error: 'Selecciona una competición y una temporada.' });
    }
    match['liga.id'] = league;
    match['liga.temporada'] = season;
    if (Number.isInteger(team)) match['equipo.id'] = team;
    const jornada = typeof req.query.round === 'string' ? req.query.round.trim().slice(0, 100) : '';
    let jornadas = [];
    if (Number.isInteger(team) && Number.isInteger(league) && Number.isInteger(season)) {
      const partidosEquipo = await Partido.find({
        'liga.id': league, 'liga.temporada': season,
        $or: [{ 'equipo_local.id': team }, { 'equipo_visitante.id': team }]
      }).select('api_id fecha liga.jornada').sort({ fecha: 1 }).lean();
      const porJornada = new Map();
      for (const partido of partidosEquipo) {
        const nombre = String(partido.liga?.jornada || 'Sin jornada');
        if (!porJornada.has(nombre)) porJornada.set(nombre, { nombre, fecha: partido.fecha, partidos: [] });
        porJornada.get(nombre).partidos.push(partido.api_id);
      }
      jornadas = [...porJornada.values()].map(item => ({ nombre: item.nombre, fecha: item.fecha, partidos: item.partidos.length }));
      if (jornada && porJornada.has(jornada)) match.partido_api_id = { $in: porJornada.get(jornada).partidos };
    }
    const q = textoDeConsulta(req.query.q, 80);
    const acentos = { a: '[aáàäâã]', e: '[eéèëê]', i: '[iíìïî]', o: '[oóòöôõ]', u: '[uúùüû]', n: '[nñ]' };
    // Se acota el número de fragmentos para limitar el coste de la agregación.
    const fragmentos = tokens(q).slice(0, 6).map(token => [...token].map(letra => acentos[letra] || escaparRegex(letra)).join(''));
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
        pases: { $sum: '$pases' },
        pases_clave: { $sum: '$pases_clave' },
        entradas: { $sum: '$entradas' },
        intercepciones: { $sum: '$intercepciones' },
        duelos: { $sum: '$duelos' },
        duelos_ganados: { $sum: '$duelos_ganados' },
        regates: { $sum: '$regates' },
        regates_exitosos: { $sum: '$regates_exitosos' },
        atajadas: { $sum: '$atajadas' },
        amarillas: { $sum: '$amarillas' },
        rojas: { $sum: '$rojas' },
        faltas: { $sum: '$faltas_cometidas' },
        calificacion: { $avg: '$calificacion' }
      } },
      { $sort: { minutos: -1, goles: -1, nombre: 1 } },
      { $limit: limite },
      { $project: { _id: 0, id: '$_id', nombre: 1, foto: 1, posicion: 1, equipos: 1, partidos: 1, minutos: 1, goles: 1, asistencias: 1, tiros: 1, tiros_puerta: 1, pases: 1, pases_clave: 1, entradas: 1, intercepciones: 1, duelos: 1, duelos_ganados: 1, regates: 1, regates_exitosos: 1, atajadas: 1, amarillas: 1, rojas: 1, faltas: 1, calificacion: { $cond: [{ $ne: ['$calificacion', null] }, { $round: ['$calificacion', 2] }, null] } } }
    ]);
    res.json({ jugadores, jornadas, jornada: jornada || null });
  } catch (error) {
    errorServidor(res, error);
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
    const campos = ['minutos', 'goles', 'asistencias', 'tiros', 'tiros_puerta', 'pases', 'pases_clave', 'precision_pases', 'entradas', 'intercepciones', 'duelos', 'duelos_ganados', 'regates', 'regates_exitosos', 'faltas_recibidas', 'faltas_cometidas', 'amarillas', 'rojas', 'atajadas', 'offsides'];
    const totales = Object.fromEntries(campos.map(campo => [campo, registros.reduce((total, item) => total + (Number(item[campo]) || 0), 0)]));
    totales.tarjetas = totales.amarillas + totales.rojas;
    // Sólo cuentan como "jugados" los partidos con minutos: un suplente sin
    // entrar aparece en la alineación pero no aporta muestra estadística.
    const jugados = registros.filter(item => (Number(item.minutos) || 0) > 0);
    const conNota = jugados.filter(item => Number(item.calificacion) > 0);
    const metricas = campos.filter(campo => campo !== 'minutos' && campo !== 'precision_pases').concat('tarjetas');
    const redondear = valor => Number(valor.toFixed(2));
    const partidos = await Partido.find({ api_id: { $in: registros.slice(0, LIMITE_RECIENTES).map(item => item.partido_api_id) } }).select('api_id equipo_local equipo_visitante estado').lean();
    const porPartido = new Map(partidos.map(partido => [partido.api_id, partido]));
    const recientes = registros.slice(0, LIMITE_RECIENTES).map(item => {
      const partido = porPartido.get(item.partido_api_id);
      const esLocal = partido ? partido.equipo_local?.id === item.equipo.id : item.equipo.local;
      const rival = partido ? (esLocal ? partido.equipo_visitante : partido.equipo_local) : null;
      const propio = partido ? (esLocal ? partido.equipo_local : partido.equipo_visitante) : null;
      const marcador = propio && Number.isFinite(propio.goles) && Number.isFinite(rival?.goles) ? { propio: propio.goles, rival: rival.goles } : null;
      return {
        partido_api_id: item.partido_api_id, fecha: item.fecha, liga: item.liga, equipo: item.equipo, local: Boolean(esLocal),
        rival: rival ? { id: rival.id, nombre: rival.nombre } : null, marcador, estado: partido?.estado || null,
        posicion: item.posicion, numero: item.numero, titular: item.titular, capitan: item.capitan, minutos: item.minutos, calificacion: item.calificacion,
        ...Object.fromEntries(campos.filter(campo => campo !== 'minutos').map(campo => [campo, item[campo] ?? 0]))
      };
    });
    res.json({
      jugador: { id, nombre: primero.jugador.nombre, foto: primero.jugador.foto, posicion: primero.posicion, equipo: primero.equipo },
      partidos: registros.length,
      partidos_jugados: jugados.length,
      totales,
      calificacion_promedio: conNota.length ? redondear(conNota.reduce((total, item) => total + item.calificacion, 0) / conNota.length) : null,
      // Muestra disponible para interpretar los ritmos: por debajo de
      // MINUTOS_MUESTRA_MINIMA el "por 90" extrapola demasiado (1 amarilla en
      // 33 minutos se convierte en 2.73 por partido completo).
      muestra: { minutos: totales.minutos, partidos: registros.length, partidos_jugados: jugados.length, minutos_minimos: MINUTOS_MUESTRA_MINIMA, suficiente: totales.minutos >= MINUTOS_MUESTRA_MINIMA },
      promedios_partido: Object.fromEntries(['minutos', ...metricas].map(campo => [campo, jugados.length ? redondear(totales[campo] / jugados.length) : null])),
      promedios_90: Object.fromEntries(metricas.map(campo => [campo, totales.minutos ? redondear(totales[campo] * 90 / totales.minutos) : null])),
      competiciones: [...new Map(registros.map(item => [item.liga.id, item.liga])).values()],
      recientes
    });
  } catch (error) {
    errorServidor(res, error);
  }
});

module.exports = router;

require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const config = require('./config/leagues');
const { etiquetaTemporada } = require('./services/seasonLabel');
const Partido = require('./models/partido');
const Equipo = require('./models/Equipo');
const { cacheMiddleware } = require('./middleware/cache');
const { calcularEstadisticas, detallarPartido } = require('./services/teamStats');
const { explicarMercado, generarPicks } = require('./services/pickEngine');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const calendarioRoutes = require('./routes/calendario');
const picksRoutes = require('./routes/picks');
const boletasRoutes = require('./routes/boletas');
const homeRoutes = require('./routes/home');
const jugadoresRoutes = require('./routes/jugadores');
const { protegido, requireAuth, requireAdmin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const cacheEscudos = new Map();
const TEMPORADA_MIN_ANALISIS = Number.parseInt(process.env.ANALYSIS_MIN_SEASON || '2025', 10);

app.use(express.json());
app.use(cookieParser());

// / y /index.html son la portada; el comparador vive en una ruta explícita.
app.get(['/', '/index.html'], (_req, res) => res.sendFile(path.join(__dirname, 'public', 'inicio.html')));
app.get('/comparador.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// Todos los endpoints de datos requieren sesión válida y acceso vigente
app.use('/api/ligas', protegido);
app.use('/api/equipos', protegido);
app.use('/api/partidos', protegido);
app.use('/api/analisis', protegido);
app.use('/api/picks', ...protegido, picksRoutes);
app.use('/api/boletas', ...protegido, boletasRoutes);
app.use('/api/home', ...protegido, homeRoutes);
app.use('/api/jugadores', ...protegido, jugadoresRoutes);
app.use('/api/arbitros', protegido);
app.use('/api/calendario', protegido, calendarioRoutes);

async function resolverTemporada(leagueId, teamId, solicitada, soloFinalizados = false) {
  if (solicitada !== undefined) {
    const temporada = Number.parseInt(solicitada, 10);
    return Number.isInteger(temporada) ? temporada : null;
  }

  const filtro = { 'liga.id': leagueId };
  if (soloFinalizados) filtro.estado = { $in: ['FT', 'AET', 'PEN'] };
  if (teamId) {
    filtro.$or = [
      { 'equipo_local.id': teamId },
      { 'equipo_visitante.id': teamId }
    ];
  }

  const partido = await Partido.findOne(filtro)
    .sort({ 'liga.temporada': -1, fecha: -1 })
    .select('liga.temporada')
    .lean();
  return partido?.liga?.temporada ?? null;
}

// Listar ligas domésticas y cualquier competición que ya tenga datos guardados.
app.get('/api/ligas', cacheMiddleware, async (req, res) => {
  try {
    const temporadasGuardadas = await Partido.aggregate([
      { $group: {
        _id: { id: '$liga.id', temporada: '$liga.temporada' },
        partidos: { $sum: 1 },
        finalizados: { $sum: { $cond: [{ $in: ['$estado', ['FT', 'AET', 'PEN']] }, 1, 0] } }
      } },
      { $sort: { '_id.id': 1, '_id.temporada': -1 } }
    ]);
    const porId = new Map();
    temporadasGuardadas.forEach(item => {
      const id = Number(item._id.id);
      if (!porId.has(id)) porId.set(id, []);
      porId.get(id).push({ temporada: item._id.temporada, etiqueta: etiquetaTemporada(id, item._id.temporada), partidos: item.partidos, finalizados: item.finalizados });
    });

    const ligasArray = Object.entries(config.ligas)
      .filter(([id, datos]) => datos.liga_principal === true || porId.has(Number(id)))
      .map(([id, datos]) => {
        const temporadas = porId.get(Number(id)) || [];
        const actual = temporadas[0];
        const temporadasAnalisis = temporadas.filter(item => item.temporada >= TEMPORADA_MIN_ANALISIS);
        const analizable = temporadasAnalisis.find(item => item.finalizados > 0) || temporadasAnalisis[0] || null;
        return {
          id: Number(id),
          ...datos,
          disponible: Boolean(actual),
          temporada: actual?.temporada ?? null,
          temporada_analisis: analizable?.temporada ?? null,
          temporadas_analisis: temporadasAnalisis,
          temporadas_archivo: temporadas.filter(item => item.temporada < TEMPORADA_MIN_ANALISIS),
          partidos: actual?.partidos ?? 0,
          finalizados: actual?.finalizados ?? 0,
          temporadas
        };
      });

    ligasArray.sort((a, b) => {
      if (a.disponible !== b.disponible) return a.disponible ? -1 : 1;
      if (a.pais < b.pais) return -1;
      if (a.pais > b.pais) return 1;
      return a.nombre.localeCompare(b.nombre, 'es');
    });

    res.json(ligasArray);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logos de competición para los selectores visuales. No consume cuota de API.
app.get('/api/ligas/:id/logo', async (req, res) => {
  const leagueId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(leagueId) || leagueId <= 0) return res.status(400).end();
  const clave = `liga:${leagueId}`;
  const guardado = cacheEscudos.get(clave);
  if (guardado) {
    res.set({ 'Content-Type': guardado.tipo, 'Cache-Control': 'public, max-age=604800, immutable' });
    return res.send(guardado.buffer);
  }
  try {
    const respuesta = await fetch(`https://media.api-sports.io/football/leagues/${leagueId}.png`, {
      signal: AbortSignal.timeout(7000)
    });
    if (!respuesta.ok) throw new Error(`CDN ${respuesta.status}`);
    const tipo = respuesta.headers.get('content-type') || 'image/png';
    if (!tipo.startsWith('image/')) throw new Error('El CDN no devolvió una imagen');
    const buffer = Buffer.from(await respuesta.arrayBuffer());
    if (buffer.length < 100) throw new Error('Imagen vacía');
    cacheEscudos.set(clave, { tipo, buffer });
    res.set({ 'Content-Type': tipo, 'Cache-Control': 'public, max-age=604800, immutable' });
    return res.send(buffer);
  } catch {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="#162923"/><path d="M25 62h46M31 52h34M37 42h22M43 32h10" stroke="#54e38e" stroke-width="6" stroke-linecap="round"/></svg>`;
    res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
    return res.send(svg);
  }
});

// Equipos de una competición (league ID) – orden alfabético
app.get('/api/ligas/:id/equipos', cacheMiddleware, async (req, res) => {
  try {
    const leagueId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(leagueId)) {
      return res.status(400).json({ error: 'La competición no es válida.' });
    }

    const todasLasTemporadas = /^(1|true|yes|si|sí)$/i.test(String(req.query.allSeasons || ''));
    const temporada = todasLasTemporadas
      ? null
      : await resolverTemporada(leagueId, null, req.query.season);
    let equiposArray = [];

    if (todasLasTemporadas) {
      equiposArray = await Partido.aggregate([
        { $match: { 'liga.id': leagueId } },
        { $project: {
          temporada: '$liga.temporada',
          equipos: [
            { id: '$equipo_local.id', nombre: '$equipo_local.nombre', logo: '$equipo_local.logo' },
            { id: '$equipo_visitante.id', nombre: '$equipo_visitante.nombre', logo: '$equipo_visitante.logo' }
          ]
        } },
        { $unwind: '$equipos' },
        { $group: {
          _id: '$equipos.id',
          nombre: { $first: '$equipos.nombre' },
          logo: { $first: '$equipos.logo' },
          temporadas: { $addToSet: '$temporada' }
        } },
        { $project: { _id: 0, id: '$_id', nombre: 1, logo: 1, temporadas: 1 } },
        { $sort: { nombre: 1 } }
      ]);
      equiposArray.forEach(equipo => equipo.temporadas.sort((a, b) => b - a));
    } else if (temporada !== null) {
      equiposArray = await Partido.aggregate([
        { $match: { 'liga.id': leagueId, 'liga.temporada': temporada } },
        { $project: { equipos: [
          { id: '$equipo_local.id', nombre: '$equipo_local.nombre', logo: '$equipo_local.logo' },
          { id: '$equipo_visitante.id', nombre: '$equipo_visitante.nombre', logo: '$equipo_visitante.logo' }
        ] } },
        { $unwind: '$equipos' },
        { $group: { _id: '$equipos.id', nombre: { $first: '$equipos.nombre' }, logo: { $first: '$equipos.logo' } } },
        { $project: { _id: 0, id: '$_id', nombre: 1, logo: 1 } },
        { $sort: { nombre: 1 } }
      ]);
    }

    if (equiposArray.length === 0) {
      const equiposObj = new Map(Object.entries(config.equiposPorLiga[leagueId] || {}).map(([id, nombre]) => [Number(id), { id: Number(id), nombre, logo: null }]));
      const dbEquipos = await Equipo.find({
        $or: [{ liga: leagueId }, { ligas: leagueId }]
      }).lean();
      dbEquipos.forEach(equipo => equiposObj.set(equipo.api_id, { id: equipo.api_id, nombre: equipo.nombre, logo: equipo.logo || null }));
      equiposArray = [...equiposObj.values()];
      equiposArray.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    }

    res.json(equiposArray);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Estadísticas detalladas (acepta scope, limit, league y half)
app.get('/api/equipos/:id/estadisticas-detalladas', cacheMiddleware, async (req, res) => {
  try {
    const teamId = Number.parseInt(req.params.id, 10);
    const leagueId = Number.parseInt(req.query.league || '262', 10);
    const scope = req.query.scope || 'general';
    const limit = req.query.limit || 'all';
    const half = Number.parseInt(req.query.half || '0', 10);

    if (!Number.isInteger(teamId) || !Number.isInteger(leagueId)) {
      return res.status(400).json({ error: 'El equipo y la competición deben ser identificadores válidos.' });
    }
    if (!['general', 'local', 'visitante'].includes(scope)) {
      return res.status(400).json({ error: 'El scope debe ser general, local o visitante.' });
    }
    if (!['all', '3', '5'].includes(limit)) {
      return res.status(400).json({ error: 'El límite debe ser all, 3 o 5.' });
    }
    if (![0, 1, 2].includes(half)) {
      return res.status(400).json({ error: 'El periodo debe ser 0 (partido), 1 o 2.' });
    }
    const season = await resolverTemporada(leagueId, teamId, req.query.season, true);
    if (req.query.season !== undefined && season === null) {
      return res.status(400).json({ error: 'La temporada no es válida.' });
    }

    const filtroPartidos = {
      $or: [{ 'equipo_local.id': teamId }, { 'equipo_visitante.id': teamId }],
      'liga.id': leagueId,
      estado: { $in: ['FT', 'AET', 'PEN'] }
    };
    if (season !== null) filtroPartidos['liga.temporada'] = season;

    // Para periodos parciales no mezclamos partidos sin estadísticas por tiempo.
    if (half !== 0) filtroPartidos.tiempos_completos = true;

    let partidosDB = await Partido.find(filtroPartidos).sort({ fecha: -1 }).lean();

    if (scope === 'local') {
      partidosDB = partidosDB.filter(p => p.equipo_local.id === teamId);
    } else if (scope === 'visitante') {
      partidosDB = partidosDB.filter(p => p.equipo_visitante.id === teamId);
    }

    if (limit === '5') {
      partidosDB = partidosDB.slice(0, 5);
    } else if (limit === '3') {
      partidosDB = partidosDB.slice(0, 3);
    }

    const stats = calcularEstadisticas(partidosDB, teamId, half);
    const partidosDetallados = partidosDB
      .map(partido => detallarPartido(partido, teamId, half))
      .filter(Boolean);
    const conEstadisticas = partidosDB.filter(partido => half === 0
      ? partido.estadisticas_completas
      : partido.tiempos_completos).length;

    const equipoDB = await Equipo.findOne({
      api_id: teamId,
      $or: [{ liga: leagueId }, { ligas: leagueId }]
    }).lean();
    const posicion = equipoDB?.posicion || 'N/A';
    const partidoConEquipo = partidosDB[0];
    const equipoPartido = partidoConEquipo?.equipo_local?.id === teamId
      ? partidoConEquipo.equipo_local
      : partidoConEquipo?.equipo_visitante;

    res.json({
      info: {
        equipo: equipoPartido?.nombre || equipoDB?.nombre || config.equiposPorLiga[leagueId]?.[teamId] || `Equipo ${teamId}`,
        liga: config.ligas[leagueId]?.nombre,
        temporada: season ?? config.seasonDefault,
        temporada_etiqueta: etiquetaTemporada(leagueId, season ?? config.seasonDefault),
        posicion,
        periodo: half === 0 ? 'Partido completo' : `${half}.º tiempo`,
        cobertura: {
          partidos: partidosDB.length,
          estadisticas: conEstadisticas
        }
      },
      stats,
      partidos: partidosDetallados,
      general: stats,
      local: calcularEstadisticas(partidosDB.filter(p => p.equipo_local.id === teamId), teamId, half),
      visitante: calcularEstadisticas(partidosDB.filter(p => p.equipo_visitante.id === teamId), teamId, half),
      rendimiento: {
        ganados: stats.ganados,
        empatados: stats.empatados,
        perdidos: stats.perdidos,
        goles_favor: stats.golesFavor,
        goles_contra: stats.golesContra
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Trayectoria del equipo por temporada. Es archivo descriptivo y no alimenta picks actuales.
app.get('/api/equipos/:id/historial', cacheMiddleware, async (req, res) => {
  try {
    const teamId = Number.parseInt(req.params.id, 10);
    const leagueId = Number.parseInt(req.query.league, 10);
    if (!Number.isInteger(teamId) || !Number.isInteger(leagueId)) {
      return res.status(400).json({ error: 'Equipo o competición inválidos.' });
    }
    const partidos = await Partido.find({
      'liga.id': leagueId,
      estado: { $in: ['FT', 'AET', 'PEN'] }
    }).select('liga.temporada equipo_local equipo_visitante').lean();
    const porTemporada = new Map();
    const fila = (tabla, equipo) => {
      if (!tabla.has(equipo.id)) tabla.set(equipo.id, { id: equipo.id, nombre: equipo.nombre, jugados: 0, ganados: 0, empatados: 0, perdidos: 0, goles_favor: 0, goles_contra: 0, puntos: 0 });
      return tabla.get(equipo.id);
    };
    for (const partido of partidos) {
      const season = partido.liga.temporada;
      if (!porTemporada.has(season)) porTemporada.set(season, new Map());
      const tabla = porTemporada.get(season);
      const local = fila(tabla, partido.equipo_local);
      const visitante = fila(tabla, partido.equipo_visitante);
      const gl = Number(partido.equipo_local.goles) || 0;
      const gv = Number(partido.equipo_visitante.goles) || 0;
      local.jugados += 1; visitante.jugados += 1;
      local.goles_favor += gl; local.goles_contra += gv;
      visitante.goles_favor += gv; visitante.goles_contra += gl;
      if (gl > gv) { local.ganados += 1; local.puntos += 3; visitante.perdidos += 1; }
      else if (gv > gl) { visitante.ganados += 1; visitante.puntos += 3; local.perdidos += 1; }
      else { local.empatados += 1; visitante.empatados += 1; local.puntos += 1; visitante.puntos += 1; }
    }
    const temporadas = [...porTemporada.entries()].map(([temporada, tabla]) => {
      const orden = [...tabla.values()].map(item => ({ ...item, diferencia: item.goles_favor - item.goles_contra }))
        .sort((a, b) => b.puntos - a.puntos || b.diferencia - a.diferencia || b.goles_favor - a.goles_favor || a.nombre.localeCompare(b.nombre, 'es'));
      const indice = orden.findIndex(item => item.id === teamId);
      if (indice < 0) return null;
      return { temporada, etiqueta: etiquetaTemporada(leagueId, temporada), posicion: indice + 1, equipos: orden.length, ...orden[indice] };
    }).filter(Boolean).sort((a, b) => b.temporada - a.temporada);
    res.json({ equipo: teamId, liga: leagueId, temporadas });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Evidencia concreta de un solo mercado, cargada cuando el usuario abre "¿Por qué?".
app.get('/api/picks/explicacion', cacheMiddleware, async (req, res) => {
  try {
    const teamLocal = Number.parseInt(req.query.team1, 10);
    const teamVisitante = Number.parseInt(req.query.team2, 10);
    const leagueLocal = Number.parseInt(req.query.league1 || req.query.league, 10);
    const leagueVisitante = Number.parseInt(req.query.league2 || req.query.league, 10);
    const limite = Number.parseInt(req.query.limit || '10', 10);
    const mercadoId = typeof req.query.market === 'string' ? req.query.market : '';
    if (![teamLocal, teamVisitante, leagueLocal, leagueVisitante].every(Number.isInteger) || !mercadoId) {
      return res.status(400).json({ error: 'Equipos, competición y mercado son obligatorios.' });
    }
    if (![5, 10, 20].includes(limite)) {
      return res.status(400).json({ error: 'La muestra debe ser de 5, 10 o 20 partidos.' });
    }
    const [seasonLocal, seasonVisitante] = await Promise.all([
      resolverTemporada(leagueLocal, teamLocal, req.query.season1 || req.query.season, true),
      resolverTemporada(leagueVisitante, teamVisitante, req.query.season2 || req.query.season, true)
    ]);
    if (seasonLocal === null || seasonVisitante === null) return res.status(404).json({ error: 'No hay temporada disponible.' });
    const filtroLocal = { 'liga.id': leagueLocal, 'liga.temporada': seasonLocal, estado: { $in: ['FT', 'AET', 'PEN'] } };
    const filtroVisitante = { 'liga.id': leagueVisitante, 'liga.temporada': seasonVisitante, estado: { $in: ['FT', 'AET', 'PEN'] } };
    const [partidosLocal, partidosVisitante] = await Promise.all([
      Partido.find({ ...filtroLocal, 'equipo_local.id': teamLocal }).sort({ fecha: -1 }).lean(),
      Partido.find({ ...filtroVisitante, 'equipo_visitante.id': teamVisitante }).sort({ fecha: -1 }).lean()
    ]);
    const explicacion = explicarMercado({
      partidosLocal,
      teamLocal,
      partidosVisitante,
      teamVisitante,
      mercadoId,
      limite,
      detalle: 3
    });
    if (!explicacion) return res.status(404).json({ error: 'Mercado no encontrado o sin cobertura.' });
    res.json({ temporadas: { local: seasonLocal, visitante: seasonVisitante }, explicacion });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Estimaciones históricas: equipo 1 como local y equipo 2 como visitante.
app.get('/api/picks', cacheMiddleware, async (req, res) => {
  try {
    const teamLocal = Number.parseInt(req.query.team1, 10);
    const teamVisitante = Number.parseInt(req.query.team2, 10);
    const leagueLocal = Number.parseInt(req.query.league1 || req.query.league, 10);
    const leagueVisitante = Number.parseInt(req.query.league2 || req.query.league, 10);
    const limit = Number.parseInt(req.query.limit || '10', 10);

    if (![teamLocal, teamVisitante, leagueLocal, leagueVisitante].every(Number.isInteger) || teamLocal === teamVisitante) {
      return res.status(400).json({ error: 'Selecciona dos equipos distintos y una competición válida para cada uno.' });
    }
    if (![5, 10, 20].includes(limit)) {
      return res.status(400).json({ error: 'La muestra debe ser de 5, 10 o 20 partidos.' });
    }

    const [seasonLocal, seasonVisitante] = await Promise.all([
      resolverTemporada(leagueLocal, teamLocal, req.query.season1 || req.query.season, true),
      resolverTemporada(leagueVisitante, teamVisitante, req.query.season2 || req.query.season, true)
    ]);
    if (seasonLocal === null || seasonVisitante === null) {
      return res.json({
        temporadas: { local: seasonLocal, visitante: seasonVisitante },
        mercados: [],
        recomendados: [],
        metodologia: 'No hay partidos finalizados para generar estimaciones.'
      });
    }

    const filtroLocal = { 'liga.id': leagueLocal, 'liga.temporada': seasonLocal, estado: { $in: ['FT', 'AET', 'PEN'] } };
    const filtroVisitante = { 'liga.id': leagueVisitante, 'liga.temporada': seasonVisitante, estado: { $in: ['FT', 'AET', 'PEN'] } };
    const [partidosLocal, partidosVisitante] = await Promise.all([
      Partido.find({ ...filtroLocal, 'equipo_local.id': teamLocal }).sort({ fecha: -1 }).lean(),
      Partido.find({ ...filtroVisitante, 'equipo_visitante.id': teamVisitante }).sort({ fecha: -1 }).lean()
    ]);
    const resultado = generarPicks({ partidosLocal, teamLocal, partidosVisitante, teamVisitante, limite: limit });
    const partidoNombreLocal = partidosLocal.find(p => (
      p.equipo_local.id === teamLocal || p.equipo_visitante.id === teamLocal
    ));
    const partidoNombreVisitante = partidosVisitante.find(p => (
      p.equipo_local.id === teamVisitante || p.equipo_visitante.id === teamVisitante
    ));
    const nombreLocal = partidoNombreLocal?.equipo_local.id === teamLocal
      ? partidoNombreLocal.equipo_local.nombre
      : partidoNombreLocal?.equipo_visitante?.nombre || `Equipo ${teamLocal}`;
    const nombreVisitante = partidoNombreVisitante?.equipo_local.id === teamVisitante
      ? partidoNombreVisitante.equipo_local.nombre
      : partidoNombreVisitante?.equipo_visitante?.nombre || `Equipo ${teamVisitante}`;
    const datosLocal = partidoNombreLocal?.equipo_local.id === teamLocal
      ? partidoNombreLocal.equipo_local
      : partidoNombreLocal?.equipo_visitante;
    const datosVisitante = partidoNombreVisitante?.equipo_local.id === teamVisitante
      ? partidoNombreVisitante.equipo_local
      : partidoNombreVisitante?.equipo_visitante;

    res.json({
      temporada: seasonLocal,
      temporadas: { local: seasonLocal, visitante: seasonVisitante },
      liga_id: leagueLocal,
      liga_ids: { local: leagueLocal, visitante: leagueVisitante },
      liga: leagueLocal === leagueVisitante
        ? config.ligas[leagueLocal]?.nombre || leagueLocal
        : `${config.ligas[leagueLocal]?.nombre || leagueLocal} / ${config.ligas[leagueVisitante]?.nombre || leagueVisitante}`,
      ligas: {
        local: { id: leagueLocal, nombre: config.ligas[leagueLocal]?.nombre || String(leagueLocal) },
        visitante: { id: leagueVisitante, nombre: config.ligas[leagueVisitante]?.nombre || String(leagueVisitante) }
      },
      local: { id: teamLocal, nombre: nombreLocal, logo: datosLocal?.logo || null, muestra: Math.min(partidosLocal.length, limit) },
      visitante: { id: teamVisitante, nombre: nombreVisitante, logo: datosVisitante?.logo || null, muestra: Math.min(partidosVisitante.length, limit) },
      ...resultado
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/arbitros', cacheMiddleware, async (req, res) => {
  try {
    const leagueId = Number.parseInt(req.query.league, 10);
    if (!Number.isInteger(leagueId)) {
      return res.status(400).json({ error: 'Selecciona una competición válida.' });
    }
    const season = await resolverTemporada(leagueId, null, req.query.season, true);
    if (season === null) return res.json({ temporada: null, arbitros: [] });

    const arbitros = await Partido.aggregate([
      { $match: {
        'liga.id': leagueId,
        'liga.temporada': season,
        estado: { $in: ['FT', 'AET', 'PEN'] },
        arbitro: { $type: 'string', $ne: '' }
      } },
      { $group: {
        _id: '$arbitro',
        partidos: { $sum: 1 },
        goles: { $sum: { $add: [
          { $ifNull: ['$equipo_local.goles', 0] },
          { $ifNull: ['$equipo_visitante.goles', 0] }
        ] } },
        con_estadisticas: { $sum: { $cond: ['$estadisticas_completas', 1, 0] } },
        amarillas: { $sum: { $cond: ['$estadisticas_completas', { $add: [
          { $ifNull: ['$equipo_local.tarjetas_amarillas', 0] },
          { $ifNull: ['$equipo_visitante.tarjetas_amarillas', 0] }
        ] }, 0] } },
        rojas: { $sum: { $cond: ['$estadisticas_completas', { $add: [
          { $ifNull: ['$equipo_local.tarjetas_rojas', 0] },
          { $ifNull: ['$equipo_visitante.tarjetas_rojas', 0] }
        ] }, 0] } },
        faltas: { $sum: { $cond: ['$estadisticas_completas', { $add: [
          { $ifNull: ['$equipo_local.faltas', 0] },
          { $ifNull: ['$equipo_visitante.faltas', 0] }
        ] }, 0] } }
      } },
      { $sort: { partidos: -1, _id: 1 } }
    ]);

    const promedio = (total, muestra) => muestra > 0 ? Number((total / muestra).toFixed(2)) : null;
    res.json({
      temporada: season,
      liga: config.ligas[leagueId]?.nombre || leagueId,
      arbitros: arbitros.map(item => ({
        nombre: item._id,
        partidos: item.partidos,
        cobertura_avanzada: item.con_estadisticas,
        promedios: {
          goles: promedio(item.goles, item.partidos),
          amarillas: promedio(item.amarillas, item.con_estadisticas),
          rojas: promedio(item.rojas, item.con_estadisticas),
          faltas: promedio(item.faltas, item.con_estadisticas)
        }
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// H2H
app.get('/api/equipos/h2h', cacheMiddleware, async (req, res) => {
  try {
    const team1 = parseInt(req.query.team1);
    const team2 = parseInt(req.query.team2);
    const leagueId = req.query.league ? parseInt(req.query.league) : null;
    const season = req.query.season ? parseInt(req.query.season, 10) : null;

    const filtro = {
      $or: [
        { 'equipo_local.id': team1, 'equipo_visitante.id': team2 },
        { 'equipo_local.id': team2, 'equipo_visitante.id': team1 }
      ],
      estado: { $in: ['FT', 'AET', 'PEN'] }
    };
    if (leagueId) {
      filtro['liga.id'] = leagueId;
    }
    if (Number.isInteger(season)) filtro['liga.temporada'] = season;

    const partidos = await Partido.find(filtro).sort({ fecha: -1 }).lean();

    const stats = {
      total: partidos.length,
      victoriasTeam1: partidos.filter(p => 
        (p.equipo_local.id === team1 && p.equipo_local.goles > p.equipo_visitante.goles) ||
        (p.equipo_visitante.id === team1 && p.equipo_visitante.goles > p.equipo_local.goles)
      ).length,
      victoriasTeam2: partidos.filter(p =>
        (p.equipo_local.id === team2 && p.equipo_local.goles > p.equipo_visitante.goles) ||
        (p.equipo_visitante.id === team2 && p.equipo_visitante.goles > p.equipo_local.goles)
      ).length,
      empates: partidos.filter(p => p.equipo_local.goles === p.equipo_visitante.goles).length,
      golesTeam1: partidos.reduce((sum, p) => sum + (p.equipo_local.id === team1 ? p.equipo_local.goles : p.equipo_visitante.goles), 0),
      golesTeam2: partidos.reduce((sum, p) => sum + (p.equipo_local.id === team2 ? p.equipo_local.goles : p.equipo_visitante.goles), 0),
      ultimos: partidos.slice(0, 5).map(p => ({
        fecha: p.fecha,
        local: p.equipo_local.nombre,
        visitante: p.equipo_visitante.nombre,
        marcador: `${p.equipo_local.goles} - ${p.equipo_visitante.goles}`,
        liga: p.liga.nombre,
        api_id: p.api_id
      }))
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Competiciones de un equipo
app.get('/api/equipos/:id/competiciones', cacheMiddleware, async (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const ligas = await Partido.aggregate([
      { $match: {
          $or: [
            { 'equipo_local.id': teamId },
            { 'equipo_visitante.id': teamId }
          ],
          estado: { $in: ['FT', 'AET', 'PEN'] }
      }},
      { $group: {
          _id: '$liga.id',
          nombre: { $first: '$liga.nombre' }
      }},
      { $sort: { nombre: 1 } }
    ]);
    const resultado = {};
    ligas.forEach(l => { resultado[l._id] = l.nombre; });
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----- ENDPOINT DE ANÁLISIS POR RANGOS (MEJORADO) -----
app.get('/api/analisis/rangos', async (req, res) => {
  try {
    const teamId = Number.parseInt(req.query.team, 10);
    const leagueId = Number.parseInt(req.query.league || '262', 10);
    const scope = req.query.scope || 'general';
    const limit = req.query.limit || 'all';
    const rivalId = req.query.rival ? Number.parseInt(req.query.rival, 10) : null;
    const minInicio = Number.parseInt(req.query.min_inicio ?? '0', 10);
    const minFin = Number.parseInt(req.query.min_fin ?? '15', 10);

    if (!Number.isInteger(teamId) || !Number.isInteger(leagueId)) {
      return res.status(400).json({ error: 'El equipo y la competición deben ser identificadores válidos.' });
    }
    if (!['general', 'local', 'visitante'].includes(scope) || !['all', '3', '5'].includes(limit)) {
      return res.status(400).json({ error: 'Los filtros de condición o límite no son válidos.' });
    }
    if (!Number.isInteger(minInicio) || !Number.isInteger(minFin) || minInicio < 0 || minFin > 120 || minInicio > minFin) {
      return res.status(400).json({ error: 'El rango debe estar ordenado y encontrarse entre los minutos 0 y 120.' });
    }
    const season = await resolverTemporada(leagueId, teamId, req.query.season, true);
    if (req.query.season !== undefined && season === null) {
      return res.status(400).json({ error: 'La temporada no es válida.' });
    }

    const filtro = {
      $or: [
        { 'equipo_local.id': teamId },
        { 'equipo_visitante.id': teamId }
      ],
      'liga.id': leagueId,
      estado: { $in: ['FT', 'AET', 'PEN'] },
      eventos_completos: true
    };
    if (season !== null) filtro['liga.temporada'] = season;

    if (rivalId) {
      filtro.$and = [
        {
          $or: [
            { 'equipo_local.id': teamId, 'equipo_visitante.id': rivalId },
            { 'equipo_local.id': rivalId, 'equipo_visitante.id': teamId }
          ]
        }
      ];
    }

    let partidos = await Partido.find(filtro).sort({ fecha: -1 }).lean();

    if (scope === 'local') {
      partidos = partidos.filter(p => p.equipo_local.id === teamId);
    } else if (scope === 'visitante') {
      partidos = partidos.filter(p => p.equipo_visitante.id === teamId);
    }

    if (limit === '5') {
      partidos = partidos.slice(0, 5);
    } else if (limit === '3') {
      partidos = partidos.slice(0, 3);
    }

    let totalPartidos = partidos.length;
    let suma = { goles: 0, amarillas: 0, rojas: 0, corners: 0 };

    partidos.forEach(p => {
      const isLocal = p.equipo_local.id === teamId;
      const rangos = isLocal ? p.equipo_local.estadisticas_por_rango : p.equipo_visitante.estadisticas_por_rango;
      if (!rangos) return;

      rangos.forEach(r => {
        const [rInicio, rFin] = r.rango_minutos.split('-').map(Number);
        if (rInicio <= minFin && rFin >= minInicio) {
          suma.goles += r.goles || 0;
          suma.amarillas += r.amarillas || 0;
          suma.rojas += r.rojas || 0;
          suma.corners += r.corners || 0;
        }
      });
    });

    const promedios = {};
    const divisor = totalPartidos || 1;
    promedios.goles = (suma.goles / divisor).toFixed(2);
    promedios.amarillas = (suma.amarillas / divisor).toFixed(2);
    promedios.rojas = (suma.rojas / divisor).toFixed(2);
    promedios.corners = (suma.corners / divisor).toFixed(2);

    res.json({
      equipo: teamId,
      temporada: season ?? config.seasonDefault,
      rango: `${minInicio}-${minFin}`,
      total_partidos: totalPartidos,
      promedios
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----- ENDPOINT PARA OBTENER EL LOGO DE UN EQUIPO -----
app.get('/api/equipos/:id/logo', async (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const leagueId = parseInt(req.query.league) || 262;
    const equipo = await Equipo.findOne({
      api_id: teamId,
      $or: [{ liga: leagueId }, { ligas: leagueId }]
    }).select('logo').lean();
    if (equipo?.logo) return res.json({ logo: equipo.logo });

    const partido = await Partido.findOne({
      'liga.id': leagueId,
      $or: [{ 'equipo_local.id': teamId }, { 'equipo_visitante.id': teamId }]
    }).sort({ fecha: -1 }).select('equipo_local equipo_visitante').lean();
    const datosEquipo = partido?.equipo_local?.id === teamId
      ? partido.equipo_local
      : partido?.equipo_visitante;
    res.json({ logo: datosEquipo?.logo || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Proxy local de escudos: evita bloqueos de hotlink/CORS del CDN en el navegador.
// No consume cuota de API-Football; sólo descarga la imagen pública y la conserva en memoria.
app.get('/api/equipos/:id/escudo', async (req, res) => {
  const teamId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(teamId) || teamId <= 0) return res.status(400).end();
  const guardado = cacheEscudos.get(teamId);
  if (guardado) {
    res.set({ 'Content-Type': guardado.tipo, 'Cache-Control': 'public, max-age=604800, immutable' });
    return res.send(guardado.buffer);
  }
  try {
    const respuesta = await fetch(`https://media.api-sports.io/football/teams/${teamId}.png`, {
      signal: AbortSignal.timeout(7000)
    });
    if (!respuesta.ok) throw new Error(`CDN ${respuesta.status}`);
    const tipo = respuesta.headers.get('content-type') || 'image/png';
    if (!tipo.startsWith('image/')) throw new Error('El CDN no devolvió una imagen');
    const buffer = Buffer.from(await respuesta.arrayBuffer());
    if (buffer.length < 100) throw new Error('Imagen vacía');
    cacheEscudos.set(teamId, { tipo, buffer });
    res.set({ 'Content-Type': tipo, 'Cache-Control': 'public, max-age=604800, immutable' });
    return res.send(buffer);
  } catch {
    const iniciales = String(teamId).slice(-2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150"><rect width="150" height="150" rx="34" fill="#162923"/><circle cx="75" cy="65" r="35" fill="none" stroke="#54e38e" stroke-width="7"/><text x="75" y="124" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="25" fill="#eef8f2">${iniciales}</text></svg>`;
    res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
    return res.send(svg);
  }
});

// ----- ENDPOINT: estadísticas completas de un partido (incluye mercados) -----
app.get('/api/partidos/:id/estadisticas', async (req, res) => {
  try {
    const partidoId = parseInt(req.params.id);
    const partido = await Partido.findOne({ api_id: partidoId }).lean();
    
    if (!partido) {
      return res.status(404).json({ error: 'Partido no encontrado' });
    }

    const golesLocal = partido.equipo_local.goles;
    const golesVisitante = partido.equipo_visitante.goles;
    const totalGoles = golesLocal + golesVisitante;
    const tieneEstadisticas = partido.estadisticas_completas === true;
    const valorAvanzado = valor => tieneEstadisticas ? (valor ?? null) : null;

    // Mercados calculados
    const mercados = {
      over_0_5: totalGoles > 0.5,
      over_1_5: totalGoles > 1.5,
      over_2_5: totalGoles > 2.5,
      over_3_5: totalGoles > 3.5,
      over_4_5: totalGoles > 4.5,
      over_5_5: totalGoles > 5.5,
      under_0_5: totalGoles < 0.5,
      under_1_5: totalGoles < 1.5,
      under_2_5: totalGoles < 2.5,
      under_3_5: totalGoles < 3.5,
      under_4_5: totalGoles < 4.5,
      under_5_5: totalGoles < 5.5,
      btts: (golesLocal > 0 && golesVisitante > 0),
      over_1_5_local: golesLocal > 1.5,
      over_1_5_visitante: golesVisitante > 1.5,
      under_1_5_local: golesLocal < 1.5,
      under_1_5_visitante: golesVisitante < 1.5,
    };

    res.json({
      fecha: partido.fecha,
      liga: partido.liga.nombre,
      liga_id: partido.liga.id,
      temporada: partido.liga.temporada,
      cobertura: { estadisticas: tieneEstadisticas },
      equipo_local: {
        id: partido.equipo_local.id,
        nombre: partido.equipo_local.nombre,
        logo: partido.equipo_local.logo,
        goles: golesLocal,
        tiros_total: valorAvanzado(partido.equipo_local.tiros_total),
        tiros_puerta: valorAvanzado(partido.equipo_local.tiros_puerta),
        corners: valorAvanzado(partido.equipo_local.corners),
        faltas: valorAvanzado(partido.equipo_local.faltas),
        tarjetas_amarillas: valorAvanzado(partido.equipo_local.tarjetas_amarillas),
        tarjetas_rojas: valorAvanzado(partido.equipo_local.tarjetas_rojas),
        offsides: valorAvanzado(partido.equipo_local.offsides),
        posesion: valorAvanzado(partido.equipo_local.posesion)
      },
      equipo_visitante: {
        id: partido.equipo_visitante.id,
        nombre: partido.equipo_visitante.nombre,
        logo: partido.equipo_visitante.logo,
        goles: golesVisitante,
        tiros_total: valorAvanzado(partido.equipo_visitante.tiros_total),
        tiros_puerta: valorAvanzado(partido.equipo_visitante.tiros_puerta),
        corners: valorAvanzado(partido.equipo_visitante.corners),
        faltas: valorAvanzado(partido.equipo_visitante.faltas),
        tarjetas_amarillas: valorAvanzado(partido.equipo_visitante.tarjetas_amarillas),
        tarjetas_rojas: valorAvanzado(partido.equipo_visitante.tarjetas_rojas),
        offsides: valorAvanzado(partido.equipo_visitante.offsides),
        posesion: valorAvanzado(partido.equipo_visitante.posesion)
      },
      mercados
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function iniciarServidor() {
  if (!process.env.MONGODB_URI) {
    throw new Error('Falta la variable de entorno MONGODB_URI.');
  }
  if (!process.env.JWT_SECRET) {
    throw new Error('Falta la variable de entorno JWT_SECRET.');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado a MongoDB');

  return app.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  iniciarServidor().catch(error => {
    console.error('❌ No se pudo iniciar el servidor:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, iniciarServidor };

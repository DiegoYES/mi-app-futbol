const http = require('http');
const Partido = require('../models/partido');
const { crearControlCuota } = require('./apiQuota');
const { leerEstadoCron } = require('./cronStatus');
const { estadoRedis } = require('./redisBackend');
const { obtenerVersionRelease } = require('./releaseVersion');
const Suscripcion = require('../models/Suscripcion');
const Usuario = require('../models/Usuario');
const { obtenerEstadoOperativo } = require('./operationalState');

const FINALIZADOS = ['FT', 'AET', 'PEN'];
const ACTIVOS = ['NS', 'TBD', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT', 'SUSP'];
const PROGRAMADOS = ['NS', 'TBD', 'PST', 'SUSP'];

function calendarioNecesitaRevision(liga, ahora = new Date()) {
  if (!liga?.proximo_partido) return false;
  if (!liga?.ultima_actualizacion) return true;
  const hastaElPartido = new Date(liga.proximo_partido) - ahora;
  const antiguedad = ahora - new Date(liga.ultima_actualizacion);
  if (hastaElPartido < 0 || hastaElPartido > 30 * 86400000) return false;
  const maxAntiguedad = hastaElPartido <= 3 * 86400000
    ? 24 * 3600000
    : (hastaElPartido <= 14 * 86400000 ? 7 * 86400000 : 14 * 86400000);
  return antiguedad > maxAntiguedad;
}

function puertosPool(env = process.env) { return String(env.APP_POOL_PORTS || (env.APP_ENVIRONMENT === 'staging' ? '3100,3101' : '3000,3001')).split(/[ ,]+/).map(Number).filter(Boolean); }

function consultarVersionPuerto(puerto, timeoutMs = 1200) {
  return new Promise(resolve => {
    const peticion = http.get(`http://127.0.0.1:${puerto}/health/version`, { timeout: timeoutMs }, respuesta => {
      let body = '';
      respuesta.on('data', chunk => { body += chunk; });
      respuesta.on('end', () => {
        try { resolve({ puerto, disponible: respuesta.statusCode === 200, commit: JSON.parse(body).commit || null }); }
        catch { resolve({ puerto, disponible: false, commit: null }); }
      });
    });
    peticion.on('timeout', () => peticion.destroy());
    peticion.on('error', () => resolve({ puerto, disponible: false, commit: null }));
  });
}

async function obtenerCalidadDatos({ ahora = new Date(), modelo = Partido, env = process.env } = {}) {
  const hace2h = new Date(ahora - 2 * 3600000);
  const hace6h = new Date(ahora - 6 * 3600000);
  const hace7d = new Date(ahora - 7 * 86400000);
  const hace30d = new Date(ahora - 30 * 86400000);
  const dentro30d = new Date(ahora.getTime() + 30 * 86400000);
  const [atrasados, sinEstadisticas, estadosSinActualizar, ligas, cuota, instancias, suscripciones] = await Promise.all([
    modelo.countDocuments({ estado: 'NS', fecha: { $gte: hace7d, $lt: hace2h } }),
    modelo.countDocuments({ estado: { $in: FINALIZADOS }, fecha: { $gte: hace30d }, estadisticas_completas: { $ne: true }, estadisticas_no_disponibles: { $ne: true } }),
    modelo.countDocuments({ estado: { $in: ACTIVOS }, fecha: { $gte: hace7d, $lt: ahora }, $or: [{ estado_consultado_en: { $lt: hace6h } }, { estado_consultado_en: null }, { estado_consultado_en: { $exists: false } }] }),
    modelo.aggregate([
      { $match: { fecha: { $gte: ahora, $lte: dentro30d }, estado: { $in: PROGRAMADOS } } },
      { $group: { _id: { id: '$liga.id', temporada: '$liga.temporada' }, nombre: { $first: '$liga.nombre' }, pais: { $first: '$liga.pais' }, proximo_partido: { $min: '$fecha' }, ultima_actualizacion: { $max: '$fecha_actualizacion' }, partidos_proximos: { $sum: 1 } } },
      { $sort: { proximo_partido: 1 } }
    ]),
    crearControlCuota().consultar(),
        Promise.all(puertosPool(env).map(puerto => consultarVersionPuerto(puerto))),
    Suscripcion.find({ estado: 'autorizada' }).select('usuario periodo_fin').limit(500).lean()
  ]);
  const usuariosSuscritos = suscripciones.length ? await Usuario.find({ _id: { $in: suscripciones.map(item => item.usuario) } }).select('suscripcion_termina').lean() : [];
  const finPorUsuario = new Map(usuariosSuscritos.map(item => [String(item._id), item.suscripcion_termina]));
  const discrepanciasSuscripcion = suscripciones.filter(item => { const local = finPorUsuario.get(String(item.usuario)); return !local || !item.periodo_fin || Math.abs(new Date(local) - new Date(item.periodo_fin)) > 3600000; }).length;
  const commit = obtenerVersionRelease();
  const cron = leerEstadoCron(env);
  const ligasAtrasadas = ligas.filter(item => calendarioNecesitaRevision(item, ahora)).slice(0, 12);
  const versionesDiferentes = instancias.some(item => !item.disponible || item.commit !== commit);
  return {
    generado_en: ahora.toISOString(),
    problemas: { partidos_ns_atrasados: atrasados, finalizados_sin_estadisticas: sinEstadisticas, estados_sin_actualizar: estadosSinActualizar, ligas_atrasadas: ligasAtrasadas.length },
    ligas_atrasadas: ligasAtrasadas,
    cron,
    cuota,
    redis: estadoRedis(),
    pagos: { ...obtenerEstadoOperativo(), discrepancias_suscripcion: discrepanciasSuscripcion },
    version: { esperada: commit, instancias, diferencias: versionesDiferentes }
  };
}

module.exports = { ACTIVOS, FINALIZADOS, PROGRAMADOS, calendarioNecesitaRevision, consultarVersionPuerto, obtenerCalidadDatos, puertosPool };

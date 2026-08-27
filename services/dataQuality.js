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
function filtroPartidosPasadosSinResultado(ahora = new Date()) {
  return {
    fecha: {
      $gte: new Date(ahora.getTime() - 30 * 86400000),
      $lt: new Date(ahora.getTime() - 2 * 3600000)
    },
    $or: [
      { estado: { $in: ACTIVOS } },
      {
        $and: [
          { estado: { $in: FINALIZADOS } },
          { $or: [
            { 'equipo_local.goles': null },
            { 'equipo_visitante.goles': null },
            { resultado: null },
            { resultado: { $exists: false } }
          ] }
        ]
      }
    ]
  };
}

function resumirCobertura(fila = {}) {
  const total = Number(fila.total || 0);
  const completos = Number(fila.completos || 0);
  const noDisponibles = Number(fila.no_disponibles || 0);
  const pendientes = Math.max(0, total - completos - noDisponibles);
  const porConsultar = Math.min(pendientes, Math.max(0, Number(fila.por_consultar || 0)));
  const enReintento = Math.max(0, pendientes - porConsultar);
  const obtenibles = Math.max(0, total - noDisponibles);
  return {
    total, completos, pendientes, por_consultar: porConsultar, en_reintento: enReintento, no_disponibles: noDisponibles,
    porcentaje_total: total ? Math.round(completos * 1000 / total) / 10 : 100,
    porcentaje_obtenible: obtenibles ? Math.round(completos * 1000 / obtenibles) / 10 : 100
  };
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
  const [atrasados, coberturaFilas, estadosSinActualizar, ligas, cuota, instancias, suscripciones] = await Promise.all([
    modelo.countDocuments({ estado: 'NS', fecha: { $gte: hace7d, $lt: hace2h } }),
    modelo.aggregate([
      { $match: { estado: { $in: FINALIZADOS }, fecha: { $gte: hace30d, $lt: ahora } } },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        completos: { $sum: { $cond: [{ $eq: ['$estadisticas_completas', true] }, 1, 0] } },
        no_disponibles: { $sum: { $cond: [{ $and: [{ $ne: ['$estadisticas_completas', true] }, { $eq: ['$estadisticas_no_disponibles', true] }] }, 1, 0] } },
        por_consultar: { $sum: { $cond: [{ $and: [
          { $ne: ['$estadisticas_completas', true] },
          { $ne: ['$estadisticas_no_disponibles', true] },
          { $lte: [{ $ifNull: ['$estadisticas_intentos', 0] }, 0] }
        ] }, 1, 0] } }
      } }
    ]),
    modelo.countDocuments({ estado: { $in: ACTIVOS }, fecha: { $gte: hace7d, $lt: ahora }, $or: [{ estado_consultado_en: { $lt: hace6h } }, { estado_consultado_en: null }, { estado_consultado_en: { $exists: false } }] }),
    modelo.aggregate([
      { $match: filtroPartidosPasadosSinResultado(ahora) },
      { $group: { _id: { id: '$liga.id', temporada: '$liga.temporada' }, nombre: { $first: '$liga.nombre' }, pais: { $first: '$liga.pais' }, partido_mas_antiguo: { $min: '$fecha' }, ultima_actualizacion: { $max: '$fecha_actualizacion' }, partidos_sin_resultado: { $sum: 1 }, estados: { $addToSet: '$estado' } } },
      { $sort: { partido_mas_antiguo: 1 } }
    ]),
    crearControlCuota().consultar(),
        Promise.all(puertosPool(env).map(puerto => consultarVersionPuerto(puerto))),
    Suscripcion.find({ estado: 'autorizada' }).select('usuario periodo_fin').limit(500).lean()
  ]);
  const usuariosSuscritos = suscripciones.length ? await Usuario.find({ _id: { $in: suscripciones.map(item => item.usuario) } }).select('suscripcion_termina').lean() : [];
  const finPorUsuario = new Map(usuariosSuscritos.map(item => [String(item._id), item.suscripcion_termina]));
  const discrepanciasSuscripcion = suscripciones.filter(item => { const local = finPorUsuario.get(String(item.usuario)); return !local || !item.periodo_fin || Math.abs(new Date(local) - new Date(item.periodo_fin)) > 3600000; }).length;
  const coberturaEstadisticas = resumirCobertura(coberturaFilas[0]);
  const commit = obtenerVersionRelease();
  const cron = leerEstadoCron(env);
  const ligasAtrasadas = ligas.slice(0, 12);
  const versionesDiferentes = instancias.some(item => !item.disponible || item.commit !== commit);
  return {
    generado_en: ahora.toISOString(),
    problemas: { partidos_ns_atrasados: atrasados, finalizados_sin_estadisticas: coberturaEstadisticas.pendientes, estados_sin_actualizar: estadosSinActualizar, ligas_atrasadas: ligas.length },
    ligas_atrasadas: ligasAtrasadas,
    cobertura_estadisticas: coberturaEstadisticas,
    cron,
    cuota,
    redis: estadoRedis(),
    pagos: { ...obtenerEstadoOperativo(), discrepancias_suscripcion: discrepanciasSuscripcion },
    version: { esperada: commit, instancias, diferencias: versionesDiferentes }
  };
}

module.exports = { ACTIVOS, FINALIZADOS, filtroPartidosPasadosSinResultado, consultarVersionPuerto, obtenerCalidadDatos, puertosPool, resumirCobertura };

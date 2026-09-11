// Auditoría de ceros sospechosos en estadísticas de partidos finalizados.
//
// Contexto: hasta agosto de 2026 el pipeline convertía métricas ausentes del
// proveedor (`null`) en 0 y las marcaba como completas. Este script detecta esos
// casos cruzándolos con señales internas (eventos, marcador, coherencia entre
// métricas) y, opcionalmente, vuelve a pedir el partido a API-Football para
// dejar el valor real o `null` cuando el proveedor no tiene cobertura.
//
// Por defecto es solo lectura (dry-run): no llama a la API ni modifica Mongo.
//
// Uso:
//   node scripts/auditarCerosEstadisticas.js                       # informe
//   node scripts/auditarCerosEstadisticas.js --temporada-min=2025  # acotar
//   node scripts/auditarCerosEstadisticas.js --temporada-min=2025 --incluir-pendientes
//     # suma los finalizados sin estadísticas que el cron ya no revisita
//   node scripts/auditarCerosEstadisticas.js --execute --allow-prod \
//     --confirm-production=REPARAR_CEROS_PRODUCCION --max-llamadas=25
//
// Protecciones de cuota (el cron horario también consume API):
//   - Antes de cada lote se relee la cuota del día y se respeta una reserva
//     dinámica: --reserva-cron-hora (250) × horas restantes del día UTC, nunca
//     menor que --reserva-minima (1000).
//   - Si un trabajo `cron:*` tiene el bloqueo distribuido activo, el script
//     espera a que termine antes de seguir.
//   - Cada lote es UNA llamada (`/fixtures?ids=` hasta 20 partidos).
//
// Escritura: solo `$set` sobre métricas de equipo y flags de cobertura, con
// filtro optimista por `fecha_actualizacion`. Nunca borra documentos ni toca
// eventos, alineaciones, jugadores, marcador o resultado.
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
const https = require('https');
const Partido = require('../models/partido');
const BloqueoTrabajo = require('../models/BloqueoTrabajo');
const { construirUpdatePartido } = require('../services/fixtureDetail');
const { MAX_INTENTOS_ESTADISTICAS, resolverCoberturaEstadisticas } = require('../services/statisticsCoverage');
const { instalarControlCuotaAxios, obtenerApiKeys, crearControlCuota } = require('../services/apiQuota');
const { controlTraficoApi } = require('../services/apiTrafficControl');
const { invalidarCacheDatosPartidos } = require('../services/syncCache');

const ESTADOS_FINALIZADOS = ['FT', 'AET', 'PEN'];
const TAMANO_LOTE = 20;
const CONFIRMACION_PRODUCCION = 'REPARAR_CEROS_PRODUCCION';
const COLECCION_AUDITORIA = 'auditoria_cobertura';
const DIAS_PARTIDO_RECIENTE = 7;
const METRICAS = ['posesion', 'tiros_total', 'tiros_puerta', 'corners', 'faltas', 'tarjetas_amarillas', 'tarjetas_rojas', 'offsides'];
const CAMPOS_PERMITIDOS = new Set([
  ...METRICAS.flatMap(metrica => [`equipo_local.${metrica}`, `equipo_visitante.${metrica}`]),
  'estadisticas_completas'
]);

const cliente = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  httpsAgent: new https.Agent({ family: 4 }),
  timeout: 30000
});
instalarControlCuotaAxios(cliente);

function nombreCamel(nombre) {
  return nombre.replace(/-([a-z])/g, (_, letra) => letra.toUpperCase());
}

function enteroPositivo(valor, predeterminado, nombre) {
  if (valor === undefined) return predeterminado;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) throw new Error(`${nombre} debe ser un entero positivo.`);
  return numero;
}

function enteroNoNegativo(valor, predeterminado, nombre) {
  if (valor === undefined) return predeterminado;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0) throw new Error(`${nombre} debe ser un entero mayor o igual a cero.`);
  return numero;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = argv.reduce((resultado, argumento) => {
    const [claveCruda, ...resto] = argumento.split('=');
    if (!claveCruda.startsWith('--')) throw new Error(`Argumento no reconocido: ${argumento}`);
    resultado[nombreCamel(claveCruda.slice(2))] = resto.length ? resto.join('=') : true;
    return resultado;
  }, {});

  args.temporadaMin = enteroNoNegativo(args.temporadaMin, 0, '--temporada-min');
  args.liga = args.liga === undefined ? null : enteroPositivo(args.liga, null, '--liga');
  args.maxPartidos = enteroPositivo(args.maxPartidos, 500, '--max-partidos');
  args.maxLlamadas = enteroPositivo(args.maxLlamadas, 25, '--max-llamadas');
  args.pausaMs = enteroNoNegativo(args.pausaMs, 1500, '--pausa-ms');
  args.reservaCronHora = enteroNoNegativo(args.reservaCronHora, 250, '--reserva-cron-hora');
  args.reservaMinima = enteroNoNegativo(args.reservaMinima, 1000, '--reserva-minima');
  args.esperaCronMaxMin = enteroNoNegativo(args.esperaCronMaxMin, 20, '--espera-cron-max-min');
  args.muestra = enteroNoNegativo(args.muestra, 10, '--muestra');
  args.incluirPendientes = args.incluirPendientes === true;
  args.execute = args.execute === true;
  args.allowProd = args.allowProd === true;
  return args;
}

function esperar(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function partir(items, tamano = TAMANO_LOTE) {
  const lotes = [];
  for (let indice = 0; indice < items.length; indice += tamano) lotes.push(items.slice(indice, indice + tamano));
  return lotes;
}

function esBaseStaging() {
  return /(?:^|[-_])staging(?:$|[-_])/i.test(mongoose.connection.name || '');
}

function validarEjecucion(args) {
  if (!args.execute) return;
  if (esBaseStaging()) return;
  if (!args.allowProd || args.confirmProduction !== CONFIRMACION_PRODUCCION) {
    throw new Error(`Producción bloqueada. Requiere --allow-prod --confirm-production=${CONFIRMACION_PRODUCCION}`);
  }
}

// Con --incluir-pendientes también entran los finalizados que nunca obtuvieron
// estadísticas y que el cron ya no revisita (temporadas o fechas fuera de su
// ventana). Una sola pasada los deja como completas o sin cobertura.
function filtroBase(args) {
  const filtro = { estado: { $in: ESTADOS_FINALIZADOS } };
  if (args.incluirPendientes) {
    filtro.$or = [
      { estadisticas_completas: true },
      { estadisticas_completas: { $ne: true }, estadisticas_no_disponibles: { $ne: true } }
    ];
  } else {
    filtro.estadisticas_completas = true;
  }
  if (args.temporadaMin) filtro['liga.temporada'] = { $gte: args.temporadaMin };
  if (args.liga) filtro['liga.id'] = args.liga;
  return filtro;
}

function contarTarjetasEventos(prefijo, patron) {
  return {
    $size: {
      $filter: {
        input: { $ifNull: [`$${prefijo}.eventos`, []] },
        as: 'evento',
        cond: {
          $and: [
            { $eq: ['$$evento.tipo_evento', 'Tarjeta'] },
            { $regexMatch: { input: { $ifNull: ['$$evento.detalle', ''] }, regex: patron } }
          ]
        }
      }
    }
  };
}

// En Mongo `3 > null` es verdadero (null ordena antes que los números), así que
// toda comparación numérica exige que el lado derecho sea realmente un número.
function mayorQue(izquierda, campo) {
  return { $and: [{ $isNumber: campo }, { $gt: [izquierda, campo] }] };
}

// Cada categoría es una expresión evaluable por `$expr` sobre un documento con
// los campos proyectados en `proyeccionSenales`. Se listan de más a menos
// grave para que la clasificación principal de un partido sea la peor.
const CATEGORIAS = [
  {
    clave: 'sin_estadisticas_pendiente',
    descripcion: 'Finalizado sin estadísticas ni marca de "no disponible" (solo con --incluir-pendientes)',
    expr: { $ne: ['$estadisticas_completas', true] }
  },
  {
    clave: 'todo_cero',
    descripcion: 'Tiros, córners, faltas y amarillas en 0 para ambos equipos',
    expr: { $and: [
      { $eq: ['$equipo_local.tiros_total', 0] }, { $eq: ['$equipo_visitante.tiros_total', 0] },
      { $eq: ['$equipo_local.corners', 0] }, { $eq: ['$equipo_visitante.corners', 0] },
      { $eq: ['$equipo_local.faltas', 0] }, { $eq: ['$equipo_visitante.faltas', 0] },
      { $eq: ['$equipo_local.tarjetas_amarillas', 0] }, { $eq: ['$equipo_visitante.tarjetas_amarillas', 0] }
    ] }
  },
  {
    clave: 'tiros_total_cero_ambos',
    descripcion: 'Ambos equipos con 0 tiros totales',
    expr: { $and: [{ $eq: ['$equipo_local.tiros_total', 0] }, { $eq: ['$equipo_visitante.tiros_total', 0] }] }
  },
  {
    clave: 'corners_cero_ambos',
    descripcion: 'Ambos equipos con 0 córners',
    expr: { $and: [{ $eq: ['$equipo_local.corners', 0] }, { $eq: ['$equipo_visitante.corners', 0] }] }
  },
  {
    clave: 'goles_mayor_que_tiros',
    descripcion: 'Un equipo anotó más goles que tiros totales o tiros a puerta registrados',
    expr: { $or: [
      mayorQue({ $ifNull: ['$equipo_local.goles', 0] }, '$equipo_local.tiros_total'),
      mayorQue({ $ifNull: ['$equipo_visitante.goles', 0] }, '$equipo_visitante.tiros_total'),
      mayorQue({ $ifNull: ['$equipo_local.goles', 0] }, '$equipo_local.tiros_puerta'),
      mayorQue({ $ifNull: ['$equipo_visitante.goles', 0] }, '$equipo_visitante.tiros_puerta')
    ] }
  },
  {
    clave: 'tiros_puerta_mayor_que_total',
    descripcion: 'Tiros a puerta superan a los tiros totales (típico de Total Shots ausente)',
    expr: { $or: [
      mayorQue({ $ifNull: ['$equipo_local.tiros_puerta', 0] }, '$equipo_local.tiros_total'),
      mayorQue({ $ifNull: ['$equipo_visitante.tiros_puerta', 0] }, '$equipo_visitante.tiros_total')
    ] }
  },
  {
    clave: 'tarjetas_eventos_mayor_que_stats',
    descripcion: 'Los eventos registran más tarjetas que las estadísticas',
    expr: { $or: [
      { $gt: ['$senales.amarillas_ev_local', { $ifNull: ['$equipo_local.tarjetas_amarillas', 0] }] },
      { $gt: ['$senales.amarillas_ev_visitante', { $ifNull: ['$equipo_visitante.tarjetas_amarillas', 0] }] },
      { $gt: ['$senales.rojas_ev_local', { $ifNull: ['$equipo_local.tarjetas_rojas', 0] }] },
      { $gt: ['$senales.rojas_ev_visitante', { $ifNull: ['$equipo_visitante.tarjetas_rojas', 0] }] }
    ] }
  },
  {
    clave: 'tiros_total_cero_un_lado',
    descripcion: 'Un solo equipo con 0 tiros totales (posible pero poco frecuente)',
    expr: { $or: [{ $eq: ['$equipo_local.tiros_total', 0] }, { $eq: ['$equipo_visitante.tiros_total', 0] }] }
  }
];

function proyeccionSenales() {
  return {
    api_id: 1, fecha: 1, fecha_actualizacion: 1, liga: 1, estadisticas_intentos: 1, estadisticas_completas: 1,
    'equipo_local.id': 1, 'equipo_local.nombre': 1, 'equipo_local.goles': 1,
    'equipo_visitante.id': 1, 'equipo_visitante.nombre': 1, 'equipo_visitante.goles': 1,
    ...Object.fromEntries(METRICAS.flatMap(m => [[`equipo_local.${m}`, 1], [`equipo_visitante.${m}`, 1]])),
    senales: {
      amarillas_ev_local: contarTarjetasEventos('equipo_local', /yellow|amarilla/i),
      amarillas_ev_visitante: contarTarjetasEventos('equipo_visitante', /yellow|amarilla/i),
      rojas_ev_local: contarTarjetasEventos('equipo_local', /^(?!.*yellow).*(red|roja)/i),
      rojas_ev_visitante: contarTarjetasEventos('equipo_visitante', /^(?!.*yellow).*(red|roja)/i)
    }
  };
}

function pipelineSospechosos(args) {
  return [
    { $match: filtroBase(args) },
    { $project: proyeccionSenales() },
    { $addFields: { categorias: CATEGORIAS.map(c => ({ $cond: [c.expr, c.clave, null] })) } },
    { $addFields: { categorias: { $filter: { input: '$categorias', as: 'c', cond: { $ne: ['$$c', null] } } } } },
    { $match: { 'categorias.0': { $exists: true } } },
    { $addFields: { categoria_principal: { $arrayElemAt: ['$categorias', 0] } } }
  ];
}

async function resumirSospechosos(args) {
  const [resumen] = await Partido.aggregate([
    ...pipelineSospechosos(args),
    { $facet: {
      total: [{ $count: 'n' }],
      por_categoria: [
        { $unwind: '$categorias' },
        { $group: { _id: '$categorias', n: { $sum: 1 } } },
        { $sort: { n: -1 } }
      ],
      por_liga_temporada: [
        { $group: { _id: { liga_id: '$liga.id', liga: '$liga.nombre', temporada: '$liga.temporada' }, n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 25 }
      ],
      por_mes_actualizacion: [
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$fecha_actualizacion' } }, n: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ],
      muestra: [
        { $sort: { fecha: -1 } },
        { $limit: args.muestra },
        { $project: {
          _id: 0, api_id: 1, fecha: 1, liga: '$liga.nombre', temporada: '$liga.temporada', categorias: 1,
          local: { nombre: '$equipo_local.nombre', goles: '$equipo_local.goles', tiros_total: '$equipo_local.tiros_total', tiros_puerta: '$equipo_local.tiros_puerta', corners: '$equipo_local.corners', amarillas: '$equipo_local.tarjetas_amarillas', amarillas_eventos: '$senales.amarillas_ev_local' },
          visitante: { nombre: '$equipo_visitante.nombre', goles: '$equipo_visitante.goles', tiros_total: '$equipo_visitante.tiros_total', tiros_puerta: '$equipo_visitante.tiros_puerta', corners: '$equipo_visitante.corners', amarillas: '$equipo_visitante.tarjetas_amarillas', amarillas_eventos: '$senales.amarillas_ev_visitante' }
        } }
      ]
    } }
  ]).option({ maxTimeMS: 120000, allowDiskUse: true });

  const total = resumen.total[0]?.n || 0;
  return {
    total,
    llamadas_para_reparar_todo: Math.ceil(total / TAMANO_LOTE),
    por_categoria: resumen.por_categoria.map(item => ({
      categoria: item._id, partidos: item.n,
      descripcion: CATEGORIAS.find(c => c.clave === item._id)?.descripcion || ''
    })),
    por_liga_temporada: resumen.por_liga_temporada.map(item => ({ ...item._id, partidos: item.n })),
    por_mes_actualizacion: resumen.por_mes_actualizacion.map(item => ({ mes: item._id, partidos: item.n })),
    muestra: resumen.muestra
  };
}

async function listarCandidatos(args, yaAuditados) {
  const candidatos = await Partido.aggregate([
    ...pipelineSospechosos(args),
    { $sort: { fecha: -1 } },
    { $limit: args.maxPartidos + yaAuditados.size }
  ]).option({ maxTimeMS: 120000, allowDiskUse: true });
  return candidatos.filter(p => !yaAuditados.has(p.api_id)).slice(0, args.maxPartidos);
}

// ---------------------------------------------------------------------------
// Protecciones frente al cron y la cuota diaria
// ---------------------------------------------------------------------------
function horasRestantesDiaUtc(ahora = new Date()) {
  const finDia = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate() + 1);
  return Math.ceil((finDia - ahora.getTime()) / 3600000);
}

function reservaParaCron(args, ahora = new Date()) {
  return Math.max(args.reservaMinima, horasRestantesDiaUtc(ahora) * args.reservaCronHora);
}

async function llamadasDisponibles(control, args) {
  const estado = await control.consultar();
  const reserva = reservaParaCron(args);
  return { disponibles: Math.max(0, estado.restantes - reserva), reserva, restantes: estado.restantes, usadas: estado.usadas };
}

async function cronActivo(ahora = new Date()) {
  return BloqueoTrabajo.findOne({
    nombre: /^cron:/, propietario: { $ne: null }, expira_en: { $gt: ahora }
  }).select('nombre expira_en').lean();
}

async function esperarCron(args) {
  const limite = Date.now() + args.esperaCronMaxMin * 60000;
  let bloqueo = await cronActivo();
  while (bloqueo) {
    if (Date.now() >= limite) throw new Error(`El trabajo ${bloqueo.nombre} sigue activo tras ${args.esperaCronMaxMin} min; se detiene para no competir por cuota.`);
    console.log(`⏸️  ${bloqueo.nombre} está en ejecución; esperando 30 s...`);
    await esperar(30000);
    bloqueo = await cronActivo();
  }
}

// ---------------------------------------------------------------------------
// Reparación
// ---------------------------------------------------------------------------
function esReciente(partido, ahora = new Date()) {
  return partido.fecha && (ahora - new Date(partido.fecha)) < DIAS_PARTIDO_RECIENTE * 86400000;
}

function camposCobertura(partido, completas) {
  if (completas || esReciente(partido)) return resolverCoberturaEstadisticas(partido, completas);
  // Partido antiguo sin métricas básicas: el proveedor ya no las va a completar.
  // Se agota directamente para que el cron no lo reintente y gaste cuota.
  return {
    estadisticas_intentos: Math.max(Number(partido.estadisticas_intentos) || 0, MAX_INTENTOS_ESTADISTICAS),
    estadisticas_no_disponibles: true,
    estadisticas_estado: 'sin_cobertura_proveedor',
    estadisticas_ausencia_motivo: 'metricas_basicas_incompletas',
    estadisticas_ultimo_intento_en: new Date()
  };
}

function valorActual(partido, campo) {
  const [equipo, metrica] = campo.split('.');
  const valor = partido[equipo]?.[metrica];
  return valor === undefined ? null : valor;
}

function planificarCambio(detalle, partido) {
  const update = construirUpdatePartido(detalle, partido);
  const set = {};
  const diferencias = [];
  for (const [campo, valor] of Object.entries(update)) {
    if (!CAMPOS_PERMITIDOS.has(campo)) continue;
    set[campo] = valor;
    if (campo !== 'estadisticas_completas' && valorActual(partido, campo) !== valor) {
      diferencias.push({ campo, antes: valorActual(partido, campo), despues: valor });
    }
  }
  const sinBloques = !Array.isArray(detalle.statistics) || detalle.statistics.length === 0;
  const completas = update.estadisticas_completas === true;
  const estabaPendiente = partido.estadisticas_completas !== true;

  let clasificacion;
  if (sinBloques) clasificacion = 'sin_cobertura_proveedor';
  else if (!completas) clasificacion = 'metricas_basicas_incompletas';
  else if (estabaPendiente) clasificacion = 'estadisticas_completadas';
  else if (diferencias.length) clasificacion = 'discrepancia_corregida';
  else clasificacion = 'dato_real_confirmado';

  if (clasificacion === 'dato_real_confirmado') return { clasificacion, diferencias, set: null };
  Object.assign(set, camposCobertura(partido, completas), { fecha_actualizacion: new Date() });
  return { clasificacion, diferencias, set };
}

async function aplicarCambio(partido, set) {
  const resultado = await Partido.updateOne(
    { _id: partido._id, api_id: partido.api_id, estado: { $in: ESTADOS_FINALIZADOS }, fecha_actualizacion: partido.fecha_actualizacion },
    { $set: set }
  );
  return resultado.modifiedCount === 1;
}

async function repararLote(lote, auditoria, contadores, cambios) {
  const porId = new Map(lote.map(p => [p.api_id, p]));
  const { data } = await cliente.get('/fixtures', { params: { ids: lote.map(p => p.api_id).join('-') } });
  contadores.llamadas += 1;
  const ahora = new Date();

  for (const detalle of data.response || []) {
    const partido = porId.get(detalle.fixture?.id);
    if (!partido) continue;
    porId.delete(detalle.fixture.id);
    const { clasificacion, diferencias, set } = planificarCambio(detalle, partido);
    const aplicado = set ? await aplicarCambio(partido, set) : false;
    if (set && !aplicado) contadores.omitidos_por_cambio_concurrente += 1;
    contadores[clasificacion] = (contadores[clasificacion] || 0) + 1;
    if (aplicado) cambios.push({ api_id: partido.api_id, clasificacion, diferencias, set });
    await auditoria.insertOne({
      api_id: partido.api_id, origen: 'auditarCerosEstadisticas',
      liga_id: partido.liga?.id, liga: partido.liga?.nombre, temporada: partido.liga?.temporada,
      categorias: partido.categorias, clasificacion, aplicado, diferencias, auditado_en: ahora
    });
  }

  for (const partido of porId.values()) {
    contadores.ausente_en_api += 1;
    await auditoria.insertOne({
      api_id: partido.api_id, origen: 'auditarCerosEstadisticas',
      liga_id: partido.liga?.id, liga: partido.liga?.nombre, temporada: partido.liga?.temporada,
      categorias: partido.categorias, clasificacion: 'ausente_en_api', aplicado: false, auditado_en: ahora
    });
  }
}

function rutaSalida() {
  const carpeta = path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(carpeta, { recursive: true });
  return path.join(carpeta, `auditoria-ceros-estadisticas-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
}

async function main() {
  const args = parseArgs();
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  if (args.execute && obtenerApiKeys().length === 0) throw new Error('Falta una clave de API-Football.');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`✅ Conectado a MongoDB: ${mongoose.connection.name}`);

  try {
    validarEjecucion(args);
    const control = crearControlCuota();
    const auditoria = mongoose.connection.db.collection(COLECCION_AUDITORIA);

    console.log('\n📊 Auditoría de ceros sospechosos en estadísticas');
    console.log(`   Filtro: finalizados con estadisticas_completas=true${args.incluirPendientes ? ' o pendientes de cobertura' : ''}${args.temporadaMin ? `, temporada ≥ ${args.temporadaMin}` : ''}${args.liga ? `, liga ${args.liga}` : ''}`);
    const resumen = await resumirSospechosos(args);
    console.log(`   Partidos sospechosos: ${resumen.total} (≈ ${resumen.llamadas_para_reparar_todo} llamadas para revisarlos todos)`);
    for (const item of resumen.por_categoria) console.log(`   - ${item.categoria.padEnd(36)} ${String(item.partidos).padStart(6)}  ${item.descripcion}`);

    const cuota = await llamadasDisponibles(control, args);
    console.log(`\n🔋 Cuota: usadas ${cuota.usadas}, restantes ${cuota.restantes}, reserva para cron ${cuota.reserva} → disponibles para esta corrida ${cuota.disponibles}`);

    const salida = rutaSalida();
    const informe = { generado_en: new Date().toISOString(), base: mongoose.connection.name, modo: args.execute ? 'execute' : 'dry-run', args, cuota, resumen };

    if (!args.execute) {
      fs.writeFileSync(salida, JSON.stringify(informe, null, 2));
      console.log(`\n🛑 Dry-run: no se llamó a la API ni se modificó la base. Informe: ${salida}`);
      console.log(esBaseStaging()
        ? '   Añade --execute para reparar en staging.'
        : `   Producción requiere --execute --allow-prod --confirm-production=${CONFIRMACION_PRODUCCION}`);
      return;
    }

    const yaAuditados = new Set((await auditoria.find({ origen: 'auditarCerosEstadisticas' }, { projection: { api_id: 1 } }).toArray()).map(d => d.api_id));
    const candidatos = await listarCandidatos(args, yaAuditados);
    const lotes = partir(candidatos).slice(0, args.maxLlamadas);
    console.log(`\n🔧 Reparación: ${candidatos.length} candidatos nuevos (${yaAuditados.size} ya auditados), ${lotes.length} lotes autorizados`);

    const contadores = { llamadas: 0, ausente_en_api: 0, omitidos_por_cambio_concurrente: 0 };
    const cambios = [];
    for (let indice = 0; indice < lotes.length; indice += 1) {
      if (indice) await esperar(args.pausaMs);
      await esperarCron(args);
      const disponible = await llamadasDisponibles(control, args);
      if (disponible.disponibles < 1) {
        console.log(`🛑 Sin cuota libre (restantes ${disponible.restantes}, reserva ${disponible.reserva}). Corrida reanudable más tarde.`);
        break;
      }
      try {
        await repararLote(lotes[indice], auditoria, contadores, cambios);
        console.log(`✓ Lote ${indice + 1}/${lotes.length}: ${JSON.stringify(contadores)}`);
      } catch (error) {
        console.error(`❌ Lote ${indice + 1}: ${error.message}`);
        if (['API_FOOTBALL_DAILY_QUOTA_EXHAUSTED', 'API_FOOTBALL_CIRCUIT_OPEN'].includes(error.code)) break;
      }
    }

    informe.contadores = contadores;
    informe.cambios = cambios;
    fs.writeFileSync(salida, JSON.stringify(informe, null, 2));
    console.log('\n🎉 Reparación terminada');
    console.log(JSON.stringify(contadores, null, 2));
    console.log(`Informe con cambios aplicados: ${salida}`);
    console.log('Estado de cuota:', JSON.stringify(controlTraficoApi.estado(), null, 2));
    if (cambios.length) await invalidarCacheDatosPartidos();
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async error => {
    console.error(`❌ ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = {
  CATEGORIAS, CONFIRMACION_PRODUCCION, TAMANO_LOTE,
  camposCobertura, filtroBase, horasRestantesDiaUtc, parseArgs, partir, pipelineSospechosos,
  planificarCambio, reservaParaCron, validarEjecucion
};

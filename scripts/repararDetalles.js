require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const axios = require('axios');
const https = require('https');
const Partido = require('../models/partido');
const { guardarDetalleFixture } = require('../services/fixtureDetail');
const { documentoFixture, ESTADOS_FINALIZADOS } = require('../services/fixtureCatalog');
const { instalarControlCuotaAxios, obtenerApiKeys } = require('../services/apiQuota');
const { controlTraficoApi } = require('../services/apiTrafficControl');

const cliente = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  httpsAgent: new https.Agent({ family: 4 }),
  timeout: 30000
});
instalarControlCuotaAxios(cliente);

const TAMANO_LOTE = 20;
const ESTADOS_ATRASADOS = ['NS', 'TBD', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT', 'SUSP'];
const CONFIRMACION_PRODUCCION = 'REPARAR_ESTADOS_PRODUCCION';

function nombreCamel(nombre) {
  return nombre.replace(/-([a-z])/g, (_, letra) => letra.toUpperCase());
}

function enteroPositivo(valor, predeterminado, nombre) {
  if (valor === undefined) return predeterminado;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) throw new Error(`${nombre} debe ser un entero positivo.`);
  return numero;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = argv.reduce((resultado, argumento) => {
    const [claveCruda, ...resto] = argumento.split('=');
    if (!claveCruda.startsWith('--')) throw new Error(`Argumento no reconocido: ${argumento}`);
    const clave = nombreCamel(claveCruda.slice(2));
    resultado[clave] = resto.length ? resto.join('=') : true;
    return resultado;
  }, {});

  args.dias = enteroPositivo(args.dias, 7, '--dias');
  args.horasGracia = enteroPositivo(args.horasGracia, 3, '--horas-gracia');
  args.horasReintento = enteroPositivo(args.horasReintento, 12, '--horas-reintento');
  args.maxPartidos = enteroPositivo(args.maxPartidos, 300, '--max-partidos');
  args.maxLlamadas = enteroPositivo(args.maxLlamadas, 15, '--max-llamadas');
  args.pausaMs = enteroPositivo(args.pausaMs, 5000, '--pausa-ms');
  return args;
}

function partir(items, tamano = TAMANO_LOTE) {
  const lotes = [];
  for (let indice = 0; indice < items.length; indice += tamano) {
    lotes.push(items.slice(indice, indice + tamano));
  }
  return lotes;
}

function esperar(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function esBaseStaging() {
  return /(?:^|[-_])staging(?:$|[-_])/i.test(mongoose.connection.name || '');
}

function validarEjecucion(args) {
  if (!args.execute) return;
  if (esBaseStaging()) return;
  if (!args.allowProd || args.confirmProduction !== CONFIRMACION_PRODUCCION) {
    throw new Error(
      `Producción bloqueada. Requiere --allow-prod ` +
      `--confirm-production=${CONFIRMACION_PRODUCCION}`
    );
  }
}

function crearFiltro(args, ahora = new Date()) {
  const fechaInicio = new Date(ahora.getTime() - (args.dias * 86400000));
  const fechaMaxima = new Date(ahora.getTime() - (args.horasGracia * 3600000));
  const reintentarAntesDe = new Date(ahora.getTime() - (args.horasReintento * 3600000));
  return {
    estado: { $in: ESTADOS_ATRASADOS },
    fecha: { $gte: fechaInicio, $lte: fechaMaxima },
    $or: [
      { estado_consultado_en: null },
      { estado_consultado_en: { $exists: false } },
      { estado_consultado_en: { $lt: reintentarAntesDe } }
    ]
  };
}

async function actualizarDesdeApi(detalle, partido) {
  const estado = detalle.fixture?.status?.short;
  await Partido.updateOne(
    { _id: partido._id },
    {
      $set: {
        ...documentoFixture(detalle),
        estado_consultado_en: new Date()
      }
    }
  );

  if (ESTADOS_FINALIZADOS.has(estado)) {
    await guardarDetalleFixture(detalle, partido);
  }
  return estado;
}

async function main() {
  const args = parseArgs();
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  if (args.execute && obtenerApiKeys().length === 0) throw new Error('Falta una clave de API-Football.');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`✅ Conectado a MongoDB: ${mongoose.connection.name}`);

  try {
    validarEjecucion(args);
    const filtro = crearFiltro(args);
    const pendientes = await Partido.find(filtro)
      .sort({ fecha: -1 })
      .limit(args.maxPartidos)
      .lean();
    const canceladosMalEscritos = await Partido.countDocuments({ estado: 'Canc' });
    const lotes = partir(pendientes).slice(0, args.maxLlamadas);

    console.log('\n📊 Auditoría de estados atrasados');
    console.log(`   Base: ${mongoose.connection.name}`);
    console.log(`   Ventana: últimos ${args.dias} días, con ${args.horasGracia} h de gracia`);
    console.log(`   Partidos encontrados: ${pendientes.length}`);
    console.log(`   Cancelados "Canc" por normalizar: ${canceladosMalEscritos}`);
    console.log(`   Llamadas necesarias/autorizadas: ${lotes.length}/${args.maxLlamadas}`);

    if (!args.execute) {
      console.log('\n🛑 Dry-run: no se llamó a la API ni se modificó la base.');
      console.log(
        esBaseStaging()
          ? '   Añade --execute para aplicar en staging.'
          : `   Producción requiere --execute --allow-prod --confirm-production=${CONFIRMACION_PRODUCCION}`
      );
      return;
    }

    if (canceladosMalEscritos) {
      await Partido.updateMany({ estado: 'Canc' }, { $set: { estado: 'CANC', fecha_actualizacion: new Date() } });
      console.log(`\n✓ ${canceladosMalEscritos} estados Canc normalizados a CANC sin gastar API.`);
    }

    let llamadas = 0;
    let recibidos = 0;
    let finalizados = 0;
    let siguenPendientes = 0;
    let ausentes = 0;

    for (let indice = 0; indice < lotes.length; indice += 1) {
      if (indice) await esperar(args.pausaMs);
      const lote = lotes[indice];
      const porId = new Map(lote.map(partido => [partido.api_id, partido]));

      try {
        const { data } = await cliente.get('/fixtures', {
          params: { ids: lote.map(partido => partido.api_id).join('-') }
        });
        llamadas += 1;

        for (const detalle of data.response || []) {
          const partido = porId.get(detalle.fixture?.id);
          if (!partido) continue;
          const estado = await actualizarDesdeApi(detalle, partido);
          recibidos += 1;
          if (ESTADOS_FINALIZADOS.has(estado)) finalizados += 1;
          else siguenPendientes += 1;
          porId.delete(detalle.fixture.id);
        }

        if (porId.size) {
          const idsAusentes = [...porId.values()].map(partido => partido._id);
          await Partido.updateMany(
            { _id: { $in: idsAusentes } },
            { $set: { estado_consultado_en: new Date() } }
          );
          ausentes += idsAusentes.length;
        }
        console.log(`✓ Lote ${indice + 1}/${lotes.length}: ${lote.length - porId.size}/${lote.length} recibidos`);
      } catch (error) {
        console.error(`❌ Lote ${indice + 1}: ${error.message}`);
        if (['API_FOOTBALL_DAILY_QUOTA_EXHAUSTED', 'API_FOOTBALL_CIRCUIT_OPEN'].includes(error.code)) break;
      }
    }

    console.log('\n🎉 Reparación terminada');
    console.log(JSON.stringify({ llamadas, recibidos, finalizados, siguenPendientes, ausentes }, null, 2));
    console.log('Estado de cuota:', JSON.stringify(controlTraficoApi.estado(), null, 2));
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

module.exports = { parseArgs, partir, crearFiltro, validarEjecucion };

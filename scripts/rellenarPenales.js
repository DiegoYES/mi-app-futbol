require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const https = require('https');
const Partido = require('../models/partido');
const { instalarControlCuotaAxios } = require('../services/apiQuota');
const { construirMarcador } = require('../services/fixtureCatalog');
instalarControlCuotaAxios(axios);

// Rellena la tanda de penales y la prórroga en partidos ya guardados.
//
// Sólo hace falta una vez: los partidos AET/PEN sincronizados antes de que
// `construirMarcador` existiera no tienen esos campos, así que la ficha los
// muestra como un empate liso. A partir de ahora el cron los guarda solo.
//
// SEGURIDAD
// - Arranca en simulación. Sin `--aplicar` no escribe absolutamente nada.
// - Sólo toca `penales.*`, `goles_prorroga.*` y `ganador_penales`. Nunca
//   modifica goles, resultado, estadísticas ni ningún otro campo.
// - Exige MONGODB_URI explícito y rechaza bases que no sean de staging salvo
//   que se confirme con PERMITIR_PRODUCCION=1.
// - Consume API-Football (1 petición por lote de hasta 20 partidos).
//
// Uso:
//   node scripts/rellenarPenales.js                 # simulación, no escribe
//   node scripts/rellenarPenales.js --aplicar       # escribe en la base de MONGODB_URI
//   node scripts/rellenarPenales.js --partido=123   # un solo partido
//   node scripts/rellenarPenales.js --desde=2026-01-01

const APLICAR = process.argv.includes('--aplicar');
const LOTE = 20;
const RETARDO = Number(process.env.SYNC_DELAY_MS) >= 0 ? Number(process.env.SYNC_DELAY_MS) : 800;
const httpsAgent = new https.Agent({ family: 4 });

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function argumento(nombre) {
  const encontrado = process.argv.find(arg => arg.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.split('=').slice(1).join('=') : null;
}

// Describe el destino sin revelar usuario ni contraseña.
function describirDestino(uri) {
  const sinCredenciales = uri.replace(/\/\/[^@/]*@/, '//');
  const match = sinCredenciales.match(/^mongodb(?:\+srv)?:\/\/([^/?]+)\/([^?]*)/);
  return { host: match?.[1] || 'desconocido', base: match?.[2] || '(no especificada)' };
}

function verificarDestino() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Falta MONGODB_URI. Este script nunca adivina la base.');

  const { host, base } = describirDestino(uri);
  const entorno = process.env.APP_ENVIRONMENT || 'no declarado';
  const pareceStaging = /staging/i.test(base) || /staging/i.test(entorno);

  console.log('──────────────── DESTINO ────────────────');
  console.log(`   Entorno lógico : ${entorno}`);
  console.log(`   Host           : ${host}`);
  console.log(`   Base           : ${base}`);
  console.log(`   Operación      : ${APLICAR ? 'ESCRITURA (penales/prórroga)' : 'SÓLO LECTURA (simulación)'}`);
  console.log('─────────────────────────────────────────');

  if (APLICAR && !pareceStaging && process.env.PERMITIR_PRODUCCION !== '1') {
    throw new Error(
      `La base "${base}" no parece de staging. Si de verdad quieres escribir ahí, ` +
      'vuelve a lanzarlo con PERMITIR_PRODUCCION=1.'
    );
  }
}

async function main() {
  verificarDestino();
  if (!process.env.API_FOOTBALL_KEY) throw new Error('Falta API_FOOTBALL_KEY.');

  await mongoose.connect(process.env.MONGODB_URI);

  const filtro = { estado: { $in: ['AET', 'PEN'] } };
  const unico = argumento('partido');
  if (unico) filtro.api_id = Number(unico);
  const desde = argumento('desde');
  if (desde) filtro.fecha = { $gte: new Date(desde) };
  // Sin --forzar, sólo los que aún no tienen la tanda guardada.
  if (!process.argv.includes('--forzar')) filtro['penales.local'] = { $in: [null, undefined] };

  const pendientes = await Partido.find(filtro).select('api_id fecha estado').sort({ fecha: -1 }).lean();
  console.log(`\n🔎 ${pendientes.length} partidos AET/PEN sin tanda guardada.`);
  if (!pendientes.length) return;

  let actualizados = 0;
  let sinDatos = 0;

  for (let i = 0; i < pendientes.length; i += LOTE) {
    const grupo = pendientes.slice(i, i + LOTE);
    const ids = grupo.map(p => p.api_id).join('-');

    const { data } = await axios.get('https://v3.football.api-sports.io/fixtures', {
      params: { ids },
      httpsAgent,
      timeout: 20000
    });

    for (const fixture of data.response || []) {
      const marcador = construirMarcador(fixture);
      if (marcador['penales.local'] === null && marcador['goles_prorroga.local'] === null) {
        sinDatos++;
        continue;
      }

      console.log(
        `   ${fixture.fixture.id} ${fixture.teams.home.name} ${fixture.goals.home}-${fixture.goals.away} ` +
        `${fixture.teams.away.name}` +
        (marcador['penales.local'] !== null
          ? ` · penales ${marcador['penales.local']}-${marcador['penales.visitante']}`
          : ' · sólo prórroga')
      );

      if (APLICAR) {
        await Partido.updateOne({ api_id: fixture.fixture.id }, { $set: marcador });
      }
      actualizados++;
    }

    if (i + LOTE < pendientes.length) await esperar(RETARDO);
  }

  console.log(
    `\n${APLICAR ? '✅ Actualizados' : '🧪 Se actualizarían'}: ${actualizados}. ` +
    `Sin datos de tanda en el proveedor: ${sinDatos}.`
  );
  if (!APLICAR) console.log('   Simulación: no se escribió nada. Añade --aplicar para persistir.');
}

main()
  .catch(error => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });

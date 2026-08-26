// Reparación de córners corruptos: revalida cada sospechoso contra la API y
// aplica cambios solo a casos confirmados (sin cobertura o discrepancia).
// Resumible: los casos ya registrados en auditoria_cobertura se omiten.
// Uso: node scripts/repararCorners.js [--temporada-min 2025] [--max-llamadas 2800] [--lote 20]
module.paths.push(__dirname + '/../node_modules');
require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const axios = require('axios');
const fs = require('fs');

const cliente = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
  timeout: 25000
});
const dormir = ms => new Promise(r => setTimeout(r, ms));
const args = process.argv.slice(2);
const opt = nombre => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : null;
};
const TEMP_MIN = Number(opt('--temporada-min') || 2025);
const MAX_LLAMADAS = Number(opt('--max-llamadas') || 2800);
const LOTE = Math.min(Number(opt('--lote') || 20), 20);
const MARGEN_CUOTA = 400;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const partidos = db.collection('partidos');
  const auditoria = db.collection('auditoria_cobertura');

  const filtro = {
    estado: { $in: ['FT', 'AET', 'PEN'] },
    estadisticas_completas: true,
    'equipo_local.corners': 0,
    'equipo_visitante.corners': 0,
    'liga.temporada': { $gte: TEMP_MIN }
  };
  const candidatos = await partidos.find(filtro, {
    projection: { api_id: 1, liga: 1, 'equipo_local.id': 1, 'equipo_visitante.id': 1 }
  }).sort({ fecha: 1 }).toArray();
  const yaProcesados = new Set((await auditoria.find({}, { projection: { api_id: 1 } }).toArray()).map(d => d.api_id));
  const pendientes = candidatos.filter(c => !yaProcesados.has(c.api_id));

  // Cuota disponible según contador local sincronizado (documento del día)
  const hoy = new Date().toISOString().slice(0, 10);
  const uso = await db.collection('usoapidiarios').findOne({ proveedor: 'api-football', dia: hoy });
  const restantesLocal = uso?.restantes_proveedor ?? 0;
  const presupuesto = Math.min(MAX_LLAMADAS, Math.max(restantesLocal - MARGEN_CUOTA, 0));

  console.log(`Candidatos: ${candidatos.length} | ya procesados: ${yaProcesados.size} | en esta corrida: ${Math.min(pendientes.length, presupuesto)} | presupuesto: ${presupuesto} llamadas`);

  let llamadas = 0, modificadosSinCobertura = 0, reales0_0 = 0, corregidosValores = 0, errores = 0;
  const listaModificados = [];

  for (const caso of pendientes) {
    if (llamadas >= presupuesto) { console.log('Presupuesto agotado; corrida terminable y resumible.'); break; }
    try {
      const r = await cliente.get('/fixtures', { params: { id: caso.api_id } });
      llamadas++;
      const f = (r.data.response || [])[0];
      const leerCorner = teamId => {
        const st = (f?.statistics || []).find(s => s.team?.id === teamId);
        const item = st?.statistics?.find(x => x.type === 'Corner Kicks');
        if (!st || !item || item.value === null || item.value === undefined || item.value === '') return null;
        const n = Number.parseInt(String(item.value), 10);
        return Number.isFinite(n) ? n : null;
      };
      const cL = f ? leerCorner(f.teams.home.id) : null;
      const cV = f ? leerCorner(f.teams.away.id) : null;
      const apiSinStats = !f || !Array.isArray(f.statistics) || f.statistics.length === 0;
      const apiSinCorners = Boolean(f) && Array.isArray(f.statistics) && cL === null && cV === null;

      let clasificacion, cambio = null;
      if (apiSinStats || apiSinCorners) {
        clasificacion = 'sin_cobertura_proveedor';
        cambio = {
          $set: {
            'equipo_local.corners': null,
            'equipo_visitante.corners': null,
            estadisticas_completas: false
          }
        };
      } else if (cL === 0 && cV === 0) {
        clasificacion = 'dato_real_0_0';
      } else {
        clasificacion = 'discrepancia_corregida';
        cambio = { $set: { 'equipo_local.corners': cL, 'equipo_visitante.corners': cV } };
      }

      let aplicado = false;
      if (cambio) {
        // Filtro defensivo: solo si sigue finalizado, con flag activo y ceros vigentes
        const res = await partidos.updateOne(
          { _id: caso._id, estado: { $in: ['FT', 'AET', 'PEN'] }, estadisticas_completas: true,
            'equipo_local.corners': 0, 'equipo_visitante.corners': 0, api_id: caso.api_id },
          cambio
        );
        aplicado = res.modifiedCount === 1;
        if (aplicado) listaModificados.push({ api_id: caso.api_id, clasificacion, cambio: cambio.$set });
      }
      if (clasificacion === 'sin_cobertura_proveedor' && aplicado) modificadosSinCobertura++;
      else if (clasificacion === 'discrepancia_corregida' && aplicado) corregidosValores++;
      else if (clasificacion === 'dato_real_0_0') reales0_0++;

      await auditoria.insertOne({
        api_id: caso.api_id,
        liga_id: caso.liga?.id, liga: caso.liga?.nombre, temporada: caso.liga?.temporada,
        clasificacion, aplicado,
        api_corners: (apiSinStats || apiSinCorners) ? null : `${cL}-${cV}`,
        auditado_en: new Date()
      });

      if ((llamadas % LOTE) === 0) {
        console.log(`  lote ${llamadas / LOTE}: ${llamadas} llamadas | sin-cobertura ${modificadosSinCobertura} | reales 0-0 ${reales0_0} | corregidos ${corregidosValores} | errores ${errores}`);
      }
      await dormir(140);
    } catch (e) {
      errores++;
      console.log(`  error api_id ${caso.api_id}: ${e.message}`);
      await dormir(600);
    }
  }

  fs.writeFileSync('/tmp/opencode/reparacion_modificados.json', JSON.stringify(listaModificados, null, 2));
  console.log('\n=== RESUMEN CORRIDA ===');
  console.log(`Llamadas: ${llamadas} | sin-cobertura reparados: ${modificadosSinCobertura} | valores reales corregidos: ${corregidosValores} | reales 0-0 intactos: ${reales0_0} | errores: ${errores}`);
  console.log(`Lista de modificados: /tmp/opencode/reparacion_modificados.json`);
  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error('ERROR FATAL:', e.message); process.exit(1); });

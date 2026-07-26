require('dotenv').config({ quiet: true });
const axios = require('axios');
const https = require('https');
const mongoose = require('mongoose');
const { instalarControlCuotaAxios } = require('../services/apiQuota');
const config = require('../config/leagues');

const cliente = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  httpsAgent: new https.Agent({ family: 4 }),
  timeout: 20000
});
instalarControlCuotaAxios(cliente);

const ligas = (process.env.SYNC_LEAGUES || '262,253,71,39,140,61,135,78')
  .split(',').map(Number).filter(Number.isInteger);
const espera = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const resultado = [];
    for (let indice = 0; indice < ligas.length; indice += 1) {
      if (indice) await espera(1000);
      const id = ligas[indice];
      const { data } = await cliente.get('/leagues', { params: { id } });
      const liga = data.response?.[0];
      resultado.push({
        id,
        nombre: liga?.league?.name || config.ligas[id]?.nombre || String(id),
        pais: liga?.country?.name || config.ligas[id]?.pais || null,
        temporadas: (liga?.seasons || []).filter(item => item.year >= 2025).map(item => ({
          year: item.year,
          inicio: item.start,
          fin: item.end,
          actual: item.current,
          cobertura: item.coverage || null
        }))
      });
    }
    console.log(JSON.stringify({ generado_en: new Date().toISOString(), ligas: resultado }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error(`❌ No se pudieron inspeccionar las temporadas: ${error.message}`);
  process.exitCode = 1;
});

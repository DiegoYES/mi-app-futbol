require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const { instalarControlCuotaAxios } = require('../services/apiQuota');

instalarControlCuotaAxios(axios);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const { data } = await axios.get('https://v3.football.api-sports.io/teams', {
      params: {
        league: Number(process.env.API_DIAGNOSTIC_LEAGUE || 39),
        season: Number(process.env.FOOTBALL_SEASON || 2024)
      },
      headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
      timeout: 15000
    });
    console.log(JSON.stringify({
      endpoint: data.get,
      parametros: data.parameters,
      errores: data.errors,
      resultados: data.results,
      paginacion: data.paging
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error(`❌ Diagnóstico fallido: ${error.message}`);
  process.exitCode = 1;
});

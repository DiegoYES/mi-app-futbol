require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const axios = require('axios');
const { crearControlCuota, instalarControlCuotaAxios, obtenerApiKeys } = require('../services/apiQuota');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  if (!obtenerApiKeys().length) throw new Error('Falta API_FOOTBALL_KEY.');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const control = crearControlCuota();
    const cliente = axios.create({ baseURL: 'https://v3.football.api-sports.io', timeout: 15000 });
    instalarControlCuotaAxios(cliente, { control });
    const { data } = await cliente.get('/status');
    const estado = await control.consultar();
    const suscripcion = data?.response?.subscription || {};
    console.log(JSON.stringify({
      plan: suscripcion.plan || null,
      activo: suscripcion.active ?? null,
      cuota_local: estado
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error(`❌ No se pudo sincronizar la cuota: ${error.message}`);
  process.exitCode = 1;
});

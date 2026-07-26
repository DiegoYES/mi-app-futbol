require('dotenv').config();
const mongoose = require('mongoose');
const { crearControlCuota, obtenerApiKeys } = require('../services/apiQuota');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const claves = obtenerApiKeys();
    const control = crearControlCuota();
    const usarAgotada = process.argv.includes('--agotada');
    const estado = usarAgotada
      ? await control.marcarAgotada({ endpoint: 'reconciliacion-dashboard' })
      : await control.consultar();
    console.log(JSON.stringify({
      ...estado,
      claves_configuradas: claves.length,
      failover_autorizado: /^(1|true|yes|si|sí)$/i.test(
        String(process.env.API_FOOTBALL_ALLOW_KEY_FAILOVER || '')
      )
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error(`❌ No se pudo consultar la cuota: ${error.message}`);
  process.exitCode = 1;
});

require('dotenv').config();
const mongoose = require('mongoose');
const { refrescarMercados } = require('../services/betting/marketCollectionService');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI.');
  await mongoose.connect(process.env.MONGODB_URI);
  const resultado = await refrescarMercados({ headless: !process.argv.includes('--headed') });
  console.log(JSON.stringify(resultado, null, 2));
  if (!resultado.selecciones_guardadas) process.exitCode = 2;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());

require('dotenv').config();
const mongoose = require('mongoose');
const Equipo = require('./models/Equipo');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado a MongoDB\n');

  const equipos = await Equipo.find({ liga: 39 }).sort({ nombre: 1 }).lean();
  
  if (equipos.length === 0) {
    console.log('⚠️ No hay equipos guardados para la Premier League (liga 39).');
  } else {
    console.log(`📋 ${equipos.length} equipos de Premier League:\n`);
    equipos.forEach(e => {
      console.log(`ID: ${e.api_id}  -  ${e.nombre}`);
    });
  }

  await mongoose.disconnect();
}

main().catch(console.error);
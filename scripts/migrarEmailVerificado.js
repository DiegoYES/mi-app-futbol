require('dotenv').config();
const mongoose = require('mongoose');
const Usuario = require('../models/Usuario');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI no está definido en el entorno.');
    process.exit(1);
  }

  console.log(`🔌 Conectando a MongoDB (${uri.replace(/:([^:@]{3,})@/, ':***@')})...`);
  await mongoose.connect(uri);

  const totalUsuarios = await Usuario.countDocuments();
  console.log(`👥 Total de usuarios registrados: ${totalUsuarios}`);

  const pendientes = await Usuario.countDocuments({ email_verificado: { $ne: true } });
  console.log(`⏳ Usuarios pendientes de marcar como verificados: ${pendientes}`);

  if (pendientes === 0) {
    console.log('✅ Todos los usuarios ya tienen email_verificado: true. Nada que hacer.');
    await mongoose.disconnect();
    return;
  }

  const resultado = await Usuario.updateMany(
    { email_verificado: { $ne: true } },
    {
      $set: {
        email_verificado: true,
        fecha_verificacion_email: new Date()
      }
    }
  );

  console.log(`🎉 Migración completada. Modificados: ${resultado.modifiedCount} usuarios.`);
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('❌ Error ejecutando migración:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});

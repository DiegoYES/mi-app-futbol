require('dotenv').config();
const mongoose = require('mongoose');
const Usuario = require('../models/Usuario');

async function main() {
  const args = process.argv.slice(2);
  const email = args[0]?.trim().toLowerCase();
  const rol = args[1]?.trim().toLowerCase();

  if (!email || !rol) {
    console.log('Uso: node scripts/asignarRol.js <email> <marketing|admin|usuario>');
    process.exit(1);
  }

  if (!['marketing', 'admin', 'usuario'].includes(rol)) {
    console.error('❌ Rol inválido. Debe ser: marketing, admin o usuario');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI no está definido.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const usuario = await Usuario.findOne({ email });
  if (!usuario) {
    console.error(`❌ Usuario con email "${email}" no encontrado.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const rolAnterior = usuario.rol;
  usuario.rol = rol;
  await usuario.save();

  console.log(`✅ Rol actualizado para ${email}: ${rolAnterior} ➔ ${rol}`);
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('❌ Error:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});

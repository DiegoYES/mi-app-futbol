require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');
const Usuario = require('../models/Usuario');

function preguntar(rl, texto, oculto = false) {
  return new Promise(resolve => {
    if (!oculto) return rl.question(texto, resolve);

    const stdin = process.stdin;
    process.stdout.write(texto);
    rl.question('', valor => {
      process.stdout.write('\n');
      resolve(valor);
    });
    stdin.on('data', () => {
      readline.moveCursor(process.stdout, 0, -1);
      readline.clearLine(process.stdout, 0);
      process.stdout.write(texto + '*'.repeat(rl.line.length));
    });
  });
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado a MongoDB\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const email = (await preguntar(rl, 'Email del administrador: ')).trim().toLowerCase();
  const nombre = (await preguntar(rl, 'Nombre: ')).trim();
  const password = await preguntar(rl, 'Contraseña (mín. 8 caracteres): ', true);

  rl.close();

  if (!email || password.length < 8) {
    console.error('\n❌ Email inválido o contraseña demasiado corta.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const existente = await Usuario.findOne({ email });
  if (existente) {
    existente.rol = 'admin';
    existente.password = password;
    await existente.save();
    console.log(`\n✅ El usuario ${email} fue promovido a administrador y su contraseña se actualizó.`);
  } else {
    await Usuario.create({ email, nombre, password, rol: 'admin' });
    console.log(`\n✅ Administrador ${email} creado correctamente.`);
  }

  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('❌ Error:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});

require('dotenv').config();
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { crearBloqueoTrabajo } = require('../services/jobLock');

function argumentos(argv = process.argv.slice(2)) {
  const separador = argv.indexOf('--');
  if (separador < 1 || !argv[separador + 1]) {
    throw new Error('Uso: node scripts/ejecutarConBloqueo.js <nombre> -- <comando> [args...]');
  }
  return { nombre: argv[0], comando: argv[separador + 1], args: argv.slice(separador + 2) };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Falta MONGODB_URI para coordinar el bloqueo.');
  const { nombre, comando, args } = argumentos();
  await mongoose.connect(process.env.MONGODB_URI);

  const bloqueo = crearBloqueoTrabajo();
  const estado = await bloqueo.adquirir(nombre);
  if (!estado.adquirido) {
    console.error(`⏭️ El trabajo ${nombre} ya se está ejecutando en otra instancia.`);
    process.exitCode = 75;
    await mongoose.disconnect();
    return;
  }

  console.log(`🔒 Bloqueo distribuido adquirido para ${nombre}.`);
  let perdida = false;
  let fallosRenovacion = 0;
  let renovando = false;
  let hijo;
  let intervalo;
  let codigo = 1;
  try {
    hijo = spawn(comando, args, {
      stdio: 'inherit',
      env: { ...process.env, SYNC_LOCK_HELD: '1' }
    });
    const reenviar = señal => hijo?.kill(señal);
    process.once('SIGTERM', () => reenviar('SIGTERM'));
    process.once('SIGINT', () => reenviar('SIGINT'));

    intervalo = setInterval(async () => {
      if (renovando) return;
      renovando = true;
      try {
        const renovado = await bloqueo.renovar(nombre);
        if (renovado) {
          fallosRenovacion = 0;
        } else {
          perdida = true;
          console.error(`⚠️ Se perdió el bloqueo ${nombre}; deteniendo el worker para evitar solapamiento.`);
          reenviar('SIGTERM');
        }
      } catch (error) {
        fallosRenovacion += 1;
        console.error(`⚠️ No se pudo renovar el bloqueo ${nombre}: ${error.message}`);
        // Dos intentos fallidos consumen aproximadamente 2/3 del lease. Se
        // detiene antes de que otra instancia pueda adquirirlo.
        if (fallosRenovacion >= 2) {
          perdida = true;
          reenviar('SIGTERM');
        }
      } finally {
        renovando = false;
      }
    }, Math.max(10_000, Math.floor(bloqueo.leaseMs / 3)));
    intervalo.unref();

    codigo = await new Promise((resolve, reject) => {
      hijo.once('error', reject);
      hijo.once('exit', (exitCode, signal) => resolve(signal ? 1 : (exitCode ?? 1)));
    });
  } finally {
    if (intervalo) clearInterval(intervalo);
    await bloqueo.liberar(nombre).catch(() => {});
    await mongoose.disconnect();
  }
  if (perdida && codigo === 0) {
    console.error(`⚠️ ${nombre} terminó, pero perdió su bloqueo durante la ejecución.`);
    process.exitCode = 74;
  } else {
    process.exitCode = codigo;
  }
}

if (require.main === module) {
  main().catch(async error => {
    console.error(`❌ No se pudo ejecutar el trabajo protegido: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = { argumentos };

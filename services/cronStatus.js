const fs = require('fs');
const path = require('path');

function rutaEstadoCron(env = process.env) {
  if (env.CRON_STATUS_FILE) return path.resolve(env.CRON_STATUS_FILE);
  return env.APP_ENVIRONMENT === 'staging'
    ? '/var/www/mi-app-futbol-staging/var/cron-status.json'
    : '/var/www/mi-app-futbol/var/cron-status.json';
}

function leerEstadoCron(env = process.env) {
  try {
    const datos = JSON.parse(fs.readFileSync(rutaEstadoCron(env), 'utf8'));
    return { disponible: true, ...datos };
  } catch {
    return { disponible: false, estado: 'sin_registro', ultima_ejecucion_exitosa: null };
  }
}

function registrarEstadoCron(estado, batch, env = process.env, ahora = new Date()) {
  const archivo = rutaEstadoCron(env);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const anterior = leerEstadoCron(env);
  const datos = {
    batch,
    estado,
    inicio: estado === 'ejecutando' ? ahora.toISOString() : anterior.inicio || null,
    ultima_ejecucion: ahora.toISOString(),
    ultima_ejecucion_exitosa: estado === 'exitoso' ? ahora.toISOString() : anterior.ultima_ejecucion_exitosa || null,
    ultimo_error: estado === 'fallido' ? ahora.toISOString() : null
  };
  const temporal = `${archivo}.${process.pid}.tmp`;
  fs.writeFileSync(temporal, `${JSON.stringify(datos, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(temporal, archivo);
  return datos;
}

module.exports = { leerEstadoCron, registrarEstadoCron, rutaEstadoCron };

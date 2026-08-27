const fs = require('fs');
const path = require('path');

function obtenerVersionRelease(cwd = process.cwd()) {
  try {
    const marcada = fs.readFileSync(path.join(cwd, 'RELEASE_COMMIT'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(marcada)) return marcada;
  } catch {}
  try {
    const nombre = path.basename(fs.realpathSync(cwd));
    if (/^[0-9a-f]{40}$/.test(nombre)) return nombre;
  } catch {}
  return 'desconocido';
}

module.exports = { obtenerVersionRelease };

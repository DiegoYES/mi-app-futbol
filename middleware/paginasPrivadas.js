const path = require('path');
const { usuarioDeSesion } = require('./auth');

// Normaliza la ruta pedida igual que lo haría express.static para que
// variantes como //admin.html, /./admin.html o /%61dmin.html no esquiven
// el control de acceso.
function normalizarRuta(url) {
  const soloRuta = String(url || '').split('?')[0].split('#')[0];
  let decodificada;
  try {
    decodificada = decodeURIComponent(soloRuta);
  } catch (_error) {
    return null;
  }
  if (decodificada.includes('\0')) return null;
  const normalizada = path.posix.normalize(decodificada).toLowerCase();
  return normalizada.length > 1 ? normalizada.replace(/\/+$/, '') : normalizada;
}

// Sirve páginas HTML que sólo deben existir para ciertos roles. Quien no
// cumple recibe 404 en vez de 403: así el panel no se anuncia a sí mismo.
function paginasPrivadas(reglas, directorio) {
  const rutas = new Map(
    Object.entries(reglas).map(([ruta, roles]) => [ruta.toLowerCase(), new Set(roles)])
  );

  return async function controlarPaginaPrivada(req, res, next) {
    if (!['GET', 'HEAD'].includes(req.method)) return next();

    const ruta = normalizarRuta(req.url);
    if (ruta === null) return res.status(400).type('text/plain').send('Solicitud inválida');

    const rolesPermitidos = rutas.get(ruta);
    if (!rolesPermitidos) return next();

    try {
      const usuario = await usuarioDeSesion(req);
      if (!usuario || !rolesPermitidos.has(usuario.rol)) {
        return res.status(404).type('text/plain').send('No encontrado');
      }
      res.set('Cache-Control', 'no-store');
      return res.sendFile(path.join(directorio, path.basename(ruta)));
    } catch (_error) {
      return res.status(404).type('text/plain').send('No encontrado');
    }
  };
}

module.exports = { paginasPrivadas, normalizarRuta };

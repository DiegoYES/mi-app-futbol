// Marca visual del entorno de prueba. Sólo se activa cuando
// APP_ENVIRONMENT=staging: en producción todo queda como no-op y no se
// inyecta ningún byte extra en las páginas.
const fs = require('fs');
const path = require('path');

const BANNER_ID = 'banner-entorno-prueba';
const BANNER_HTML = `<div id="${BANNER_ID}" style="position:sticky;top:0;z-index:9999;background:#b45309;color:#fff;text-align:center;font:600 13px/1.4 system-ui,sans-serif;padding:6px 12px;letter-spacing:.04em;">⚠️ ENTORNO DE PRUEBA — staging — los datos pueden ser sintéticos y borrarse en cualquier momento</div>`;

function esStaging(env = process.env) {
  return String(env.APP_ENVIRONMENT || '').trim().toLowerCase() === 'staging';
}

function inyectarBanner(html) {
  if (typeof html !== 'string' || html.includes(`id="${BANNER_ID}"`)) return html;
  const abre = html.search(/<body[^>]*>/i);
  if (abre === -1) return html;
  const fin = html.indexOf('>', abre) + 1;
  return `${html.slice(0, fin)}\n${BANNER_HTML}${html.slice(fin)}`;
}

// Reemplaza res.sendFile para las páginas HTML servidas por rutas explícitas.
function crearEnviadorHtml(publicDir, env = process.env) {
  const activo = esStaging(env);
  return function enviarHtml(res, archivo) {
    const ruta = path.join(publicDir, archivo);
    if (!activo) return res.sendFile(ruta);
    fs.readFile(ruta, 'utf8', (err, html) => {
      if (err) return res.status(404).end();
      res.type('html').send(inyectarBanner(html));
    });
  };
}

// Middleware para el resto de páginas .html estáticas. Debe registrarse
// DESPUÉS de paginasPrivadas (para no saltarse el control de admin.html) y
// antes de express.static. En producción devuelve un passthrough puro.
function bannerEstatico(publicDir, env = process.env) {
  if (!esStaging(env)) return (_req, _res, next) => next();
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rutaPedida;
    try {
      rutaPedida = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    if (!rutaPedida.toLowerCase().endsWith('.html')) return next();
    const archivo = path.normalize(path.join(publicDir, rutaPedida));
    if (!archivo.startsWith(publicDir + path.sep)) return next();
    fs.readFile(archivo, 'utf8', (err, html) => {
      if (err) return next();
      res.type('html').send(inyectarBanner(html));
    });
  };
}

module.exports = { BANNER_ID, BANNER_HTML, esStaging, inyectarBanner, crearEnviadorHtml, bannerEstatico };

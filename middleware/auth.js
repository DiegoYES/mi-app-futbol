const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const { limiteUsuario } = require('./security');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRA = process.env.JWT_EXPIRA || '30d';

if (!JWT_SECRET) {
  console.error('❌ Falta JWT_SECRET en el archivo .env. La autenticación no funcionará.');
}

function firmarToken(usuario) {
  return jwt.sign({
    id: usuario._id,
    rol: usuario.rol,
    sesion_version: Number(usuario.sesion_version || 0)
  }, JWT_SECRET, { expiresIn: JWT_EXPIRA });
}

function sesionCoincide(payload, usuario) {
  const versionToken = Number.isInteger(payload?.sesion_version) ? payload.sesion_version : 0;
  return versionToken === Number(usuario?.sesion_version || 0);
}

function extraerToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies && req.cookies.token) return req.cookies.token;
  return null;
}

// Resuelve el usuario de la cookie/cabecera sin escribir en la respuesta.
// Devuelve null cuando no hay sesión utilizable, para que quien llama decida
// si responde 401 (API) o 404 (páginas privadas).
async function usuarioDeSesion(req) {
  const token = extraerToken(req);
  if (!token || !JWT_SECRET) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const usuario = await Usuario.findById(payload.id);
    if (!usuario || !usuario.activo || !sesionCoincide(payload, usuario)) return null;
    return usuario;
  } catch (_error) {
    return null;
  }
}

// Verifica que haya sesión válida y carga req.usuario
async function requireAuth(req, res, next) {
  try {
    const token = extraerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'No autenticado', codigo: 'SIN_TOKEN' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const usuario = await Usuario.findById(payload.id);

    if (!usuario || !usuario.activo || !sesionCoincide(payload, usuario)) {
      return res.status(401).json({ error: 'Cuenta no disponible', codigo: 'CUENTA_INVALIDA' });
    }

    req.usuario = usuario;
    next();
  } catch (err) {
    const codigo = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO';
    return res.status(401).json({ error: 'Sesión inválida', codigo });
  }
}

// Requiere prueba vigente o suscripción activa
function requireAcceso(req, res, next) {
  const estado = req.usuario.estadoAcceso();
  if (!estado.tieneAcceso) {
    const bloqueoIP = estado.motivo === 'ip_duplicada';
    return res.status(403).json({
      error: bloqueoIP
        ? 'La prueba gratuita no se habilitó porque esta red ya fue utilizada por otra cuenta.'
        : 'Tu acceso ha expirado. Suscríbete para continuar.',
      codigo: 'ACCESO_EXPIRADO',
      plan: estado.plan,
      motivo: estado.motivo
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Requiere permisos de administrador', codigo: 'NO_ADMIN' });
  }
  next();
}

// Atajo para proteger endpoints de datos: sesión válida + acceso vigente
const protegido = [requireAuth, limiteUsuario, requireAcceso];

module.exports = {
  firmarToken,
  sesionCoincide,
  requireAuth,
  requireAcceso,
  requireAdmin,
  usuarioDeSesion,
  protegido
};

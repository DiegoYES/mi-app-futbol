const express = require('express');
const Usuario = require('../models/Usuario');
const { firmarToken, requireAuth } = require('../middleware/auth');
const { crearLimitador } = require('../middleware/rateLimit');
const { errorServidor } = require('../middleware/security');
const { registrarEventoProducto } = require('../services/productEvents');
const {
  normalizarNombreCuenta,
  normalizarPerfilCuenta,
  validarPasswordNueva
} = require('../services/accountSettings');
const { registrarEventoSeguridad } = require('../services/securityAudit');

const router = express.Router();

const limiteIntentos = crearLimitador('auth', {
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos. Espera 15 minutos.', codigo: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false
});
const limitePerfil = crearLimitador('cuenta-perfil', {
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: req => String(req.usuario?._id || 'sin-usuario'),
  message: { error: 'Demasiados cambios de perfil. Espera 15 minutos.', codigo: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false
});
const limitePassword = crearLimitador('cuenta-password', {
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: req => String(req.usuario?._id || 'sin-usuario'),
  message: { error: 'Demasiados intentos. Espera antes de volver a cambiar la contraseña.', codigo: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false
});

const OPCIONES_COOKIE = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000
};

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function obtenerIP(req) {
  // Express sólo honra X-Forwarded-For según TRUST_PROXY; nunca confiamos en
  // el encabezado directamente porque un cliente podría falsificarlo.
  return req.ip || req.socket?.remoteAddress || null;
}

router.post('/registro', limiteIntentos, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }
    if (email.length > 254 || !validarEmail(email)) {
      return res.status(400).json({ error: 'El email no tiene un formato válido' });
    }
    const nombreValidado = normalizarNombreCuenta(req.body?.nombre ?? '', { opcional: true });
    if (nombreValidado.error) {
      return res.status(400).json({ error: nombreValidado.error, codigo: 'NOMBRE_INVALIDO' });
    }
    const passwordValidada = validarPasswordNueva(password, {
      email,
      nombre: nombreValidado.valor
    });
    if (passwordValidada.error) {
      return res.status(400).json({ error: passwordValidada.error, codigo: 'PASSWORD_DEBIL' });
    }

    const existente = await Usuario.findOne({ email: email.toLowerCase() });
    if (existente) {
      return res.status(409).json({ error: 'Ese email ya está registrado' });
    }

    const ip = obtenerIP(req);

    // Bloquear automáticamente si ya existe una cuenta en prueba con esta IP
    const cuentaConMismaIP = ip
      ? await Usuario.findOne({ ip_registro: ip, rol: 'usuario', suscripcion_termina: null })
      : null;

    const usuario = await Usuario.create({
      email, password: passwordValidada.valor, nombre: nombreValidado.valor,
      ip_registro: ip,
      ip_ultimo_acceso: ip,
      bloqueado_ip_duplicada: !!cuentaConMismaIP
    });

    registrarEventoProducto(cuentaConMismaIP ? 'registration_ip_limited' : 'registration_active');

    const token = firmarToken(usuario);
    res.cookie('token', token, OPCIONES_COOKIE);
    res.status(201).json({ usuario: usuario.aJSON() });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'No se pudo completar el registro' });
  }
});

router.post('/login', limiteIntentos, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }
    if (email.length > 254 || password.length > 200) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    // El hash está excluido por defecto y sólo se carga para verificar el login.
    const usuario = await Usuario.findOne({ email: email.toLowerCase() })
      .select('+password');
    if (!usuario || !(await usuario.compararPassword(password))) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    if (!usuario.activo) {
      return res.status(403).json({ error: 'Esta cuenta está desactivada' });
    }

    usuario.ultimo_acceso = new Date();
    usuario.ip_ultimo_acceso = obtenerIP(req);
    await usuario.save();

    const token = firmarToken(usuario);
    res.cookie('token', token, OPCIONES_COOKIE);
    res.json({ usuario: usuario.aJSON() });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'No se pudo iniciar sesión' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token', { ...OPCIONES_COOKIE, maxAge: undefined });
  res.json({ mensaje: 'Sesión cerrada' });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ usuario: req.usuario.aJSON() });
});

router.patch('/perfil', requireAuth, limitePerfil, async (req, res) => {
  try {
    const perfil = normalizarPerfilCuenta(req.body);
    if (perfil.error) {
      return res.status(400).json({ error: perfil.error, codigo: 'PERFIL_INVALIDO' });
    }
    req.usuario.nombre = perfil.valor.nombre;
    req.usuario.preferencias = perfil.valor.preferencias;
    await req.usuario.save();
    registrarEventoSeguridad('account_profile_updated', req);
    return res.json({ usuario: req.usuario.aJSON(), mensaje: 'Configuración guardada.' });
  } catch (error) {
    return errorServidor(res, error, 'No se pudo guardar la configuración.');
  }
});

router.post('/cambiar-password', requireAuth, limitePassword, async (req, res) => {
  try {
    const actual = req.body?.password_actual;
    const nueva = req.body?.password_nueva;
    if (typeof actual !== 'string' || !actual || actual.length > 200) {
      return res.status(400).json({ error: 'Captura tu contraseña actual.', codigo: 'PASSWORD_ACTUAL_REQUERIDA' });
    }
    const passwordValidada = validarPasswordNueva(nueva, {
      email: req.usuario.email,
      nombre: req.usuario.nombre
    });
    if (passwordValidada.error) {
      return res.status(400).json({ error: passwordValidada.error, codigo: 'PASSWORD_DEBIL' });
    }
    const usuario = await Usuario.findById(req.usuario._id).select('+password');
    if (!usuario || !usuario.activo) {
      return res.status(401).json({ error: 'Cuenta no disponible.', codigo: 'CUENTA_INVALIDA' });
    }
    if (!(await usuario.compararPassword(actual))) {
      return res.status(400).json({ error: 'La contraseña actual no coincide.', codigo: 'PASSWORD_ACTUAL_INCORRECTA' });
    }
    if (await usuario.compararPassword(passwordValidada.valor)) {
      return res.status(400).json({ error: 'La nueva contraseña debe ser diferente.', codigo: 'PASSWORD_SIN_CAMBIOS' });
    }
    usuario.password = passwordValidada.valor;
    usuario.sesion_version = Number(usuario.sesion_version || 0) + 1;
    usuario.password_actualizada_en = new Date();
    await usuario.save();
    req.usuario = usuario;
    res.cookie('token', firmarToken(usuario), OPCIONES_COOKIE);
    registrarEventoSeguridad('account_password_changed', req);
    return res.json({ usuario: usuario.aJSON(), mensaje: 'Contraseña actualizada y otras sesiones cerradas.' });
  } catch (error) {
    return errorServidor(res, error, 'No se pudo cambiar la contraseña.');
  }
});

router.post('/revocar-sesiones', requireAuth, limitePerfil, async (req, res) => {
  try {
    req.usuario.sesion_version = Number(req.usuario.sesion_version || 0) + 1;
    await req.usuario.save();
    res.cookie('token', firmarToken(req.usuario), OPCIONES_COOKIE);
    registrarEventoSeguridad('account_sessions_revoked', req);
    return res.json({ mensaje: 'Las demás sesiones fueron cerradas.' });
  } catch (error) {
    return errorServidor(res, error, 'No se pudieron cerrar las demás sesiones.');
  }
});

module.exports = router;

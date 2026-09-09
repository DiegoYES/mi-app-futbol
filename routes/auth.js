const express = require('express');
const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');
const { firmarToken, requireAuth, usuarioDeSesion } = require('../middleware/auth');
const { crearLimitador } = require('../middleware/rateLimit');
const { errorServidor } = require('../middleware/security');
const { registrarEventoProducto } = require('../services/productEvents');
const {
  normalizarNombreCuenta,
  normalizarPerfilCuenta,
  validarPasswordNueva
} = require('../services/accountSettings');
const { registrarEventoSeguridad } = require('../services/securityAudit');
const { enviarEmailVerificacion } = require('../services/mailer');

// Hash bcrypt de costo 12 precalculado para neutralizar timing attacks cuando el correo no existe.
const HASH_DUMMY = '$2a$12$e8Yk1A6/f206rQkQO5D1kOQv2eG3L8lW9M4m2Q4m2Q4m2Q4m2Q4m2';

const router = express.Router();

const limiteIntentos = crearLimitador('auth', {
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos. Espera 15 minutos.', codigo: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false
});
const limiteReenvioVerificacion = crearLimitador('reenvio-verificacion', {
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiadas solicitudes de reenvío. Por favor espera 15 minutos.', codigo: 'RATE_LIMIT' },
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

    const usuario = new Usuario({
      email,
      password: passwordValidada.valor,
      nombre: nombreValidado.valor,
      ip_registro: ip,
      ip_ultimo_acceso: ip,
      bloqueado_ip_duplicada: !!cuentaConMismaIP,
      email_verificado: false
    });

    const tokenVerificacion = usuario.generarTokenVerificacion();
    await usuario.save();

    enviarEmailVerificacion({
      email: usuario.email,
      nombre: usuario.nombre,
      token: tokenVerificacion
    }).catch(err => console.error('[auth/registro] Error enviando correo de verificación:', err));

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
    const hashParaComparar = usuario?.password || HASH_DUMMY;
    const passwordCoincide = await bcrypt.compare(password, hashParaComparar);

    if (!usuario || !passwordCoincide) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    if (!usuario.activo) {
      return res.status(403).json({ error: 'Esta cuenta está desactivada' });
    }
    if (usuario.suspendido_hasta && usuario.suspendido_hasta > new Date()) {
      const fecha = usuario.suspendido_hasta.toLocaleDateString('es-MX', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
      return res.status(403).json({
        error: `Tu cuenta está suspendida temporalmente hasta el ${fecha}.`,
        codigo: 'CUENTA_SUSPENDIDA',
        suspendido_hasta: usuario.suspendido_hasta
      });
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

router.post('/logout', async (req, res) => {
  try {
    const usuario = await usuarioDeSesion(req);
    if (usuario) {
      usuario.sesion_version = Number(usuario.sesion_version || 0) + 1;
      await usuario.save();
      registrarEventoSeguridad('account_sessions_revoked', req);
    }
  } catch (error) {
    console.error('Error al revocar sesión en logout:', error);
  }
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

router.post('/verificar-email', limiteIntentos, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ error: 'Token de verificación no proporcionado.', codigo: 'TOKEN_REQUERIDO' });
    }

    const tokenHash = Usuario.hashearTokenVerificacion(token);
    const ahora = new Date();

    const usuario = await Usuario.findOne({
      token_verificacion: tokenHash,
      token_verificacion_expira: { $gt: ahora }
    }).select('+token_verificacion +token_verificacion_expira');

    if (!usuario) {
      return res.status(400).json({
        error: 'El enlace de verificación es inválido o ya ha expirado.',
        codigo: 'TOKEN_INVALIDO_O_EXPIRADO'
      });
    }

    usuario.email_verificado = true;
    usuario.fecha_verificacion_email = ahora;
    usuario.token_verificacion = null;
    usuario.token_verificacion_expira = null;
    await usuario.save();

    registrarEventoSeguridad('email_verified', { usuario, requestId: req.requestId });

    return res.json({
      mensaje: '¡Correo electrónico verificado exitosamente!',
      usuario: usuario.aJSON()
    });
  } catch (error) {
    return errorServidor(res, error, 'No se pudo verificar el correo.');
  }
});

router.post('/reenviar-verificacion', limiteReenvioVerificacion, async (req, res) => {
  try {
    let usuario = await usuarioDeSesion(req);
    if (!usuario && req.body?.email && typeof req.body.email === 'string') {
      usuario = await Usuario.findOne({ email: req.body.email.toLowerCase().trim() });
    }

    if (!usuario) {
      return res.status(400).json({ error: 'Debes iniciar sesión o indicar un correo registrado.', codigo: 'USUARIO_NO_ENCONTRADO' });
    }

    if (usuario.email_verificado) {
      return res.json({ mensaje: 'Tu correo ya está verificado.', ya_verificado: true });
    }

    const usuarioDoc = await Usuario.findById(usuario._id).select('+token_verificacion +token_verificacion_expira');
    if (!usuarioDoc) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const tokenVerificacion = usuarioDoc.generarTokenVerificacion();
    await usuarioDoc.save();

    enviarEmailVerificacion({
      email: usuarioDoc.email,
      nombre: usuarioDoc.nombre,
      token: tokenVerificacion
    }).catch(err => console.error('[auth/reenviar-verificacion] Error enviando correo:', err));

    return res.json({
      mensaje: 'Se ha enviado un nuevo enlace de verificación a tu correo.',
      ok: true
    });
  } catch (error) {
    return errorServidor(res, error, 'No se pudo reenviar la verificación.');
  }
});

module.exports = router;

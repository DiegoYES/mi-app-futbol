const express = require('express');
const rateLimit = require('express-rate-limit');
const Usuario = require('../models/Usuario');
const { firmarToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const limiteIntentos = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos. Espera 15 minutos.', codigo: 'RATE_LIMIT' },
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

router.post('/registro', limiteIntentos, async (req, res) => {
  try {
    const { email, password, nombre } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }
    if (!validarEmail(email)) {
      return res.status(400).json({ error: 'El email no tiene un formato válido' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const existente = await Usuario.findOne({ email: email.toLowerCase() });
    if (existente) {
      return res.status(409).json({ error: 'Ese email ya está registrado' });
    }

    const usuario = await Usuario.create({ email, password, nombre });
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
    const { email, password } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }

    const usuario = await Usuario.findOne({ email: email.toLowerCase() });
    if (!usuario || !(await usuario.compararPassword(password))) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    if (!usuario.activo) {
      return res.status(403).json({ error: 'Esta cuenta está desactivada' });
    }

    usuario.ultimo_acceso = new Date();
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

module.exports = router;

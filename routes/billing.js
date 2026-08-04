const express = require('express');
const rateLimit = require('express-rate-limit');
const Suscripcion = require('../models/Suscripcion');
const { requireAuth } = require('../middleware/auth');
const { errorServidor } = require('../middleware/security');
const {
  ErrorMercadoPago,
  PRECIO_MENSUAL,
  cancelarSuscripcion,
  crearSuscripcionPendiente
} = require('../services/mercadoPago');

const router = express.Router();
const limiteBilling = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });

router.get('/status', requireAuth, async (req, res) => {
  const suscripcion = await Suscripcion.findOne({ usuario: req.usuario._id }).lean();
  res.json({
    precio: PRECIO_MENSUAL,
    moneda: 'MXN',
    suscripcion: suscripcion ? {
      estado: suscripcion.estado,
      periodo_fin: suscripcion.periodo_fin,
      proximo_cobro: suscripcion.proximo_cobro,
      cancelada_en: suscripcion.cancelada_en
    } : null
  });
});

router.post('/subscribe', requireAuth, limiteBilling, async (req, res) => {
  try {
    const existente = await Suscripcion.findOne({ usuario: req.usuario._id });
    if (existente?.estado === 'autorizada') {
      return res.status(409).json({ error: 'Ya tienes una suscripción activa.', codigo: 'SUSCRIPCION_ACTIVA' });
    }
    if (existente?.estado === 'pendiente' && existente.checkout_url) {
      return res.json({ checkout_url: existente.checkout_url, reutilizada: true });
    }

    const remota = await crearSuscripcionPendiente({
      usuarioId: req.usuario._id,
      email: req.usuario.email
    });
    const suscripcion = await Suscripcion.findOneAndUpdate(
      { usuario: req.usuario._id },
      {
        proveedor: 'mercadopago',
        proveedor_suscripcion_id: String(remota.id),
        estado: 'pendiente',
        importe: PRECIO_MENSUAL,
        moneda: 'MXN',
        checkout_url: remota.init_point,
        ultimo_error: null
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ checkout_url: suscripcion.checkout_url });
  } catch (error) {
    if (error instanceof ErrorMercadoPago) {
      return res.status(502).json({ error: error.message, codigo: 'MERCADOPAGO_ERROR' });
    }
    return errorServidor(res, error, 'No se pudo iniciar la suscripción.');
  }
});

router.post('/cancel', requireAuth, limiteBilling, async (req, res) => {
  try {
    const suscripcion = await Suscripcion.findOne({ usuario: req.usuario._id });
    if (!suscripcion?.proveedor_suscripcion_id || !['pendiente', 'autorizada', 'pausada'].includes(suscripcion.estado)) {
      return res.status(409).json({ error: 'No existe una suscripción cancelable.', codigo: 'SIN_SUSCRIPCION' });
    }
    await cancelarSuscripcion(suscripcion.proveedor_suscripcion_id);
    suscripcion.estado = 'cancelada';
    suscripcion.cancelada_en = new Date();
    await suscripcion.save();
    res.json({ mensaje: 'La renovación fue cancelada.', acceso_hasta: suscripcion.periodo_fin });
  } catch (error) {
    if (error instanceof ErrorMercadoPago) {
      return res.status(502).json({ error: error.message, codigo: 'MERCADOPAGO_ERROR' });
    }
    return errorServidor(res, error, 'No se pudo cancelar la suscripción.');
  }
});

module.exports = router;

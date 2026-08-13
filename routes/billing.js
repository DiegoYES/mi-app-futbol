const express = require('express');
const Suscripcion = require('../models/Suscripcion');
const { requireAuth } = require('../middleware/auth');
const { crearLimitador } = require('../middleware/rateLimit');
const { errorServidor } = require('../middleware/security');
const { TERMS_VERSION, consentimientoValido } = require('../services/terms');
const {
  ErrorMercadoPago,
  PRECIO_MENSUAL,
  cancelarSuscripcion,
  crearSuscripcionPendiente,
  obtenerSuscripcion
} = require('../services/mercadoPago');

const router = express.Router();
const limiteBilling = crearLimitador('billing', { windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });

router.get('/status', requireAuth, async (req, res) => {
  let suscripcion = await Suscripcion.findOne({ usuario: req.usuario._id });

  // El webhook sigue siendo la vía principal, pero Mercado Pago puede tardar o
  // no entregar alguna notificación. Reconciliamos sólo estados pendientes para
  // no depender del navegador ni otorgar acceso sin verificarlo con la API.
  if (suscripcion?.estado === 'pendiente' && suscripcion.proveedor_suscripcion_id) {
    try {
      const remota = await obtenerSuscripcion(suscripcion.proveedor_suscripcion_id);
      if (['authorized', 'cancelled', 'paused'].includes(remota.status)) {
        const proximoCobro = remota.next_payment_date ? new Date(remota.next_payment_date) : null;
        const estado = ({ authorized: 'autorizada', cancelled: 'cancelada', paused: 'pausada' })[remota.status];
        suscripcion.estado = estado;
        suscripcion.periodo_inicio = remota.date_created ? new Date(remota.date_created) : new Date();
        suscripcion.periodo_fin = estado === 'autorizada' ? proximoCobro : null;
        suscripcion.proximo_cobro = estado === 'autorizada' ? proximoCobro : null;
        if (estado === 'cancelada') suscripcion.cancelada_en = new Date();
        suscripcion.ultimo_evento_en = new Date();
        suscripcion.ultimo_error = null;
        await suscripcion.save();

        if (estado === 'autorizada') {
          req.usuario.plan = 'premium';
          req.usuario.suscripcion_termina = proximoCobro;
          await req.usuario.save();
        }
      }
    } catch (error) {
      // El estado local continúa pendiente y podrá reconciliarse en la siguiente
      // consulta; no convertimos una indisponibilidad temporal en un rechazo.
      console.error('[billing reconcile]', error);
    }
  }

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
    if (!consentimientoValido(req.body)) {
      return res.status(400).json({
        error: 'Debes leer y aceptar los Términos y Condiciones antes de continuar.',
        codigo: 'TERMINOS_NO_ACEPTADOS'
      });
    }
    const aceptadosEn = new Date();
    const existente = await Suscripcion.findOne({ usuario: req.usuario._id });
    if (existente?.estado === 'autorizada') {
      return res.status(409).json({ error: 'Ya tienes una suscripción activa.', codigo: 'SUSCRIPCION_ACTIVA' });
    }
    if (existente?.estado === 'pendiente' && existente.checkout_url) {
      existente.terminos_aceptados_en = aceptadosEn;
      existente.terminos_version = TERMS_VERSION;
      await existente.save();
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
        terminos_aceptados_en: aceptadosEn,
        terminos_version: TERMS_VERSION,
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

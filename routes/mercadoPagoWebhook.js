const express = require('express');
const EventoPago = require('../models/EventoPago');
const Suscripcion = require('../models/Suscripcion');
const Usuario = require('../models/Usuario');
const { firmaWebhookValida, obtenerPagoAutorizado, obtenerSuscripcion } = require('../services/mercadoPago');

const router = express.Router();

function fecha(valor) {
  const resultado = valor ? new Date(valor) : null;
  return resultado && !Number.isNaN(resultado.valueOf()) ? resultado : null;
}

function estadoLocal(estado) {
  return ({ authorized: 'autorizada', pending: 'pendiente', paused: 'pausada', cancelled: 'cancelada' })[estado] || 'vencida';
}

router.post('/mercadopago', async (req, res) => {
  const dataId = String(req.query['data.id'] || req.body?.data?.id || '');
  const requestId = String(req.get('x-request-id') || '');
  const signature = String(req.get('x-signature') || '');
  const secret = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '');

  if (!firmaWebhookValida({ xSignature: signature, xRequestId: requestId, dataId, secret })) {
    return res.status(401).json({ error: 'Firma de webhook inválida.' });
  }

  const tipo = String(req.body?.type || req.query.type || 'desconocido');
  const clave = `${requestId}:${tipo}:${dataId}`;
  try {
    await EventoPago.create({ proveedor: 'mercadopago', clave, tipo, recurso_id: dataId });
  } catch (error) {
    if (error?.code === 11000) return res.status(200).json({ recibido: true, duplicado: true });
    throw error;
  }

  if (!['subscription_preapproval', 'subscription_authorized_payment'].includes(tipo)) {
    return res.status(200).json({ recibido: true });
  }

  try {
    let suscripcionId = dataId;
    if (tipo === 'subscription_authorized_payment') {
      const factura = await obtenerPagoAutorizado(dataId);
      if (factura.payment?.status !== 'approved') {
        return res.status(200).json({ recibido: true, pago: factura.payment?.status || factura.status });
      }
      suscripcionId = String(factura.preapproval_id || '');
    }
    const remota = await obtenerSuscripcion(suscripcionId);
    const usuarioId = String(remota.external_reference || '');
    const usuario = await Usuario.findById(usuarioId);
    if (!usuario) return res.status(200).json({ recibido: true, ignorado: true });

    const periodoInicio = fecha(remota.date_created);
    const proximoCobro = fecha(remota.next_payment_date);
    const estado = estadoLocal(remota.status);
    await Suscripcion.findOneAndUpdate(
      { usuario: usuario._id },
      {
        proveedor: 'mercadopago',
        proveedor_suscripcion_id: String(remota.id),
        estado,
        periodo_inicio: periodoInicio,
        periodo_fin: proximoCobro,
        proximo_cobro: estado === 'autorizada' ? proximoCobro : null,
        ultimo_evento_en: new Date(),
        ultimo_error: null
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (estado === 'autorizada' && proximoCobro) {
      usuario.plan = 'premium';
      usuario.suscripcion_termina = proximoCobro;
      await usuario.save();
    }
    return res.status(200).json({ recibido: true });
  } catch (error) {
    await EventoPago.deleteOne({ proveedor: 'mercadopago', clave });
    console.error(`[webhook mercadopago ${requestId}]`, error);
    return res.status(500).json({ error: 'No se pudo procesar la notificación.' });
  }
});

module.exports = router;

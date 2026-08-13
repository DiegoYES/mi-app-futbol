const express = require('express');
const Sugerencia = require('../models/Sugerencia');
const { crearLimitador } = require('../middleware/rateLimit');

const router = express.Router();
const TIPOS = new Set(['idea', 'mejora', 'error', 'otro']);

const limiteCreacion = crearLimitador('sugerencias', {
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Alcanzaste el límite de 10 tickets por hora. Intenta más tarde.' }
});

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

function serializar(ticket) {
  return {
    id: ticket._id,
    tipo: ticket.tipo,
    asunto: ticket.asunto,
    descripcion: ticket.descripcion,
    estado: ticket.estado,
    prioridad: ticket.prioridad,
    respuesta_admin: ticket.respuesta_admin,
    creada_en: ticket.creada_en,
    actualizada_en: ticket.actualizada_en,
    respondida_en: ticket.respondida_en
  };
}

router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const tickets = await Sugerencia.find({ usuario: req.usuario._id })
      .sort({ creada_en: -1 })
      .limit(100)
      .lean();
    res.json({ tickets: tickets.map(serializar) });
  } catch {
    res.status(500).json({ error: 'No se pudieron consultar tus tickets.' });
  }
});

router.post('/', limiteCreacion, async (req, res) => {
  try {
    const tipo = texto(req.body?.tipo);
    const asunto = texto(req.body?.asunto);
    const descripcion = texto(req.body?.descripcion);

    if (!TIPOS.has(tipo)) {
      return res.status(400).json({ error: 'Selecciona un tipo de ticket válido.' });
    }
    if (asunto.length < 5 || asunto.length > 120) {
      return res.status(400).json({ error: 'El asunto debe tener entre 5 y 120 caracteres.' });
    }
    if (descripcion.length < 20 || descripcion.length > 3000) {
      return res.status(400).json({ error: 'El detalle debe tener entre 20 y 3000 caracteres.' });
    }

    const ticket = await Sugerencia.create({ usuario: req.usuario._id, tipo, asunto, descripcion });
    res.status(201).json({
      mensaje: 'Ticket enviado. Gracias por ayudarnos a mejorar.',
      ticket: serializar(ticket)
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Revisa la información del ticket.' });
    }
    res.status(500).json({ error: 'No se pudo guardar el ticket.' });
  }
});

module.exports = router;

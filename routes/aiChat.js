const express = require('express');
const { crearLimitador } = require('../middleware/rateLimit');
const { errorServidor } = require('../middleware/security');
const { responderConsulta } = require('../services/aiChat');
const { registrarEventoProducto } = require('../services/productEvents');

const router = express.Router();

const limiteAsistente = crearLimitador('asistente-chat', {
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});

router.get('/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    disponible: true,
    activo: Boolean(process.env.GEMINI_API_KEY)
  });
});

router.post('/chat', limiteAsistente, async (req, res) => {
  try {
    const mensaje = req.body?.mensaje;
    if (typeof mensaje !== 'string') {
      return res.status(400).json({ error: 'El mensaje debe ser texto.', codigo: 'MENSAJE_INVALIDO' });
    }

    const texto = mensaje.trim();
    if (!texto) {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío.', codigo: 'MENSAJE_VACIO' });
    }
    if (texto.length > 400) {
      return res.status(400).json({ error: 'El mensaje no debe superar los 400 caracteres.', codigo: 'MENSAJE_DEMASIADO_LARGO' });
    }

    let contexto = null;
    if (req.body?.contexto && typeof req.body.contexto === 'object' && !Array.isArray(req.body.contexto)) {
      try {
        const serializado = JSON.stringify(req.body.contexto);
        if (serializado.length <= 2500) {
          contexto = req.body.contexto;
        }
      } catch (_) {}
    }

    const resultado = await responderConsulta(texto, { contexto });
    if (!resultado.ok) {
      return res.status(400).json({ error: resultado.error });
    }

    registrarEventoProducto('ai_assistant_message');
    return res.json({
      ok: true,
      respuesta: resultado.respuesta
    });
  } catch (error) {
    return errorServidor(res, error, 'No se pudo procesar la consulta del asistente.');
  }
});

module.exports = router;

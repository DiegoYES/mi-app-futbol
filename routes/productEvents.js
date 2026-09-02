const express = require('express');
const { esEventoNavegador, registrarEventoProducto } = require('../services/productEvents');
const { limiteEventosProducto } = require('../middleware/security');

const router = express.Router();

router.post('/', limiteEventosProducto, (req, res) => {
  const evento = req.body?.evento;
  if (!esEventoNavegador(evento)) {
    return res.status(400).json({ error: 'Evento no válido', codigo: 'EVENTO_NO_VALIDO' });
  }
  registrarEventoProducto(evento);
  return res.status(204).end();
});

module.exports = router;

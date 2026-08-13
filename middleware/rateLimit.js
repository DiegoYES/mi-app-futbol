const rateLimit = require('express-rate-limit');
const { crearStoreRateLimit } = require('../services/redisBackend');

function crearLimitador(nombre, opciones) {
  const store = crearStoreRateLimit(nombre);
  return rateLimit({
    ...opciones,
    ...(store ? { store, passOnStoreError: false } : {})
  });
}

module.exports = { crearLimitador };

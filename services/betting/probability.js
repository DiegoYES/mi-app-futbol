const { numeroFinitoNullable } = require('../statValue');

function probabilidadEmpirica(valores, lado, linea, alpha = 2, beta = 2) {
  const validos = valores.map(numeroFinitoNullable).filter(Number.isFinite);
  const limite = numeroFinitoNullable(linea);
  if (!validos.length || limite === null) return null;
  const entero = Number.isInteger(limite);
  const gana = valor => lado === 'OVER' ? valor > limite : valor < limite;
  const push = valor => entero && valor === limite;
  const victorias = validos.filter(gana).length;
  const pushes = validos.filter(push).length;
  const decisiones = validos.length - pushes;
  return {
    probabilidad: (victorias + alpha) / (decisiones + alpha + beta),
    push: pushes / validos.length,
    muestra: validos.length,
    victorias,
    pushes,
    metodo: 'empirical_beta'
  };
}

module.exports = { probabilidadEmpirica };

function probabilidadEmpirica(valores, lado, linea, alpha = 2, beta = 2) {
  const validos = valores.map(Number).filter(Number.isFinite);
  if (!validos.length || !Number.isFinite(Number(linea))) return null;
  const limite = Number(linea);
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

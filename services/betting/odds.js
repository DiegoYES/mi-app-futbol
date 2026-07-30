function cuotaDecimal(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).trim();
  const numero = Number(texto.replace(',', '.'));
  if (!Number.isFinite(numero)) return null;
  if (/^[+-]/.test(texto)) return numero > 0 ? Number((1 + numero / 100).toFixed(4)) : Number((1 + 100 / Math.abs(numero)).toFixed(4));
  return numero > 1 ? numero : null;
}

function probabilidadImplicita(cuota) { return cuota > 1 ? 1 / cuota : null; }

function sinVig(cuotaA, cuotaB) {
  const a = probabilidadImplicita(cuotaA); const b = probabilidadImplicita(cuotaB);
  if (a === null || b === null) return null;
  return { a: a / (a + b), b: b / (a + b), margen: a + b - 1 };
}

function valorEsperado(probabilidad, cuota, push = 0) {
  if (![probabilidad, push].every(Number.isFinite) || !Number.isFinite(cuota) || cuota <= 1) return null;
  const probabilidadIncondicional = probabilidad * (1 - push);
  return probabilidadIncondicional * cuota + push - 1;
}

module.exports = { cuotaDecimal, probabilidadImplicita, sinVig, valorEsperado };

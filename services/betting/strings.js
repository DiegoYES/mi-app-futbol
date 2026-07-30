const aliases = require('../../config/betting-aliases.json');

function normalizarTexto(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function aplicarAlias(tipo, valor) {
  const normalizado = normalizarTexto(valor);
  const tabla = aliases[tipo] || {};
  const encontrado = Object.entries(tabla).find(([origen]) => normalizarTexto(origen) === normalizado);
  return encontrado ? encontrado[1] : valor;
}

function similitud(a, b) {
  const aa = new Set(normalizarTexto(a).split(' ').filter(Boolean));
  const bb = new Set(normalizarTexto(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  const interseccion = [...aa].filter(token => bb.has(token)).length;
  return interseccion / new Set([...aa, ...bb]).size;
}

function resolverNombre(nombre, candidatos, tipo, umbral = 0.72) {
  const buscado = aplicarAlias(tipo, nombre);
  const exactos = candidatos.filter(item => normalizarTexto(item.nombre) === normalizarTexto(buscado));
  if (exactos.length === 1) return { estado: 'MATCHED', item: exactos[0], score: 1 };
  const puntuados = candidatos.map(item => ({ item, score: similitud(buscado, item.nombre) })).sort((a, b) => b.score - a.score);
  if (!puntuados[0] || puntuados[0].score < umbral) return { estado: 'NOT_MATCHED', item: null, score: puntuados[0]?.score || 0 };
  if (puntuados[1] && puntuados[0].score - puntuados[1].score < 0.08) return { estado: 'AMBIGUOUS', item: null, candidatos: puntuados.slice(0, 3) };
  return { estado: 'MATCHED', item: puntuados[0].item, score: puntuados[0].score };
}

module.exports = { aplicarAlias, normalizarTexto, resolverNombre, similitud };

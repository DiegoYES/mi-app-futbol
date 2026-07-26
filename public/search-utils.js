(function iniciarBusquedaTokenizada(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutbolSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function crearBusquedaTokenizada() {
  function normalizar(valor) {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function tokens(valor) {
    return normalizar(valor).split(/\s+/).filter(Boolean);
  }

  function coincide(texto, consulta) {
    const buscados = tokens(consulta);
    if (!buscados.length) return true;
    const disponibles = tokens(texto);
    return buscados.every(fragmento => disponibles.some(token => token.includes(fragmento)));
  }

  function puntuar(texto, consulta) {
    const nombre = normalizar(texto);
    const buscado = normalizar(consulta);
    if (!buscado) return 0;
    if (nombre === buscado) return 1000;
    if (nombre.startsWith(buscado)) return 700;
    const disponibles = tokens(nombre);
    return tokens(buscado).reduce((total, fragmento) => {
      const exacto = disponibles.some(token => token === fragmento);
      const prefijo = disponibles.some(token => token.startsWith(fragmento));
      return total + (exacto ? 100 : prefijo ? 60 : 25);
    }, 0);
  }

  function ordenar(items, consulta, selector = item => item) {
    return items
      .filter(item => coincide(selector(item), consulta))
      .map((item, indice) => ({ item, indice, puntos: puntuar(selector(item), consulta) }))
      .sort((a, b) => b.puntos - a.puntos || a.indice - b.indice)
      .map(resultado => resultado.item);
  }

  return { normalizar, tokens, coincide, puntuar, ordenar };
});

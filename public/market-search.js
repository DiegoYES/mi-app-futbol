(function iniciarExploradorMercados(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutbolMarketSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function crearExploradorMercados() {
  function normalizar(valor) {
    return String(valor || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function filtrar(mercados, filtros) {
    const consulta = normalizar(filtros.busqueda);
    const numero = consulta.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.');
    const pideOver = /\b(over|mas)\b/.test(consulta);
    const pideUnder = /\b(under|menos)\b/.test(consulta);
    const terminos = consulta
      .replace(/\b(over|under|mas|menos|de|del|la|el)\b/g, ' ')
      .replace(/\d+(?:[.,]\d+)?/g, ' ')
      .split(/\s+/).filter(Boolean);
    return mercados.filter(item => {
      if (item.categoria !== filtros.categoria) return false;
      if (filtros.alcance !== 'todos' && item.alcance !== filtros.alcance) return false;
      if (pideOver && item.tipo !== 'over') return false;
      if (pideUnder && item.tipo !== 'under') return false;
      if (numero && Number(item.linea) !== Number(numero)) return false;
      const nombre = normalizar(item.mercado);
      return terminos.every(termino => nombre.includes(termino));
    });
  }

  return { filtrar, normalizar };
});

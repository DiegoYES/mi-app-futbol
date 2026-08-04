(function iniciarExploradorMercados(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutbolMarketSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function crearExploradorMercados() {
  function normalizar(valor) {
    return String(valor || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function familia(item) {
    if (item.categoria !== 'tarjetas') return item.categoria;
    if (item.id?.startsWith('tarjetas_registradas_')) return 'registradas';
    if (item.id?.startsWith('rojas_')) return 'rojas';
    return 'amarillas';
  }

  function familias(mercados, categoria) {
    return [...new Set(mercados.filter(item => item.categoria === categoria && Number.isFinite(item.linea)).map(familia))];
  }

  function lineas(mercados, filtros) {
    return [...new Set(mercados.filter(item => (
      item.categoria === filtros.categoria &&
      (filtros.familia === 'todas' || familia(item) === filtros.familia) &&
      item.alcance === filtros.alcance &&
      item.tipo === filtros.tipo &&
      Number.isFinite(item.linea)
    )).map(item => item.linea))].sort((a, b) => a - b);
  }

  function filtrar(mercados, filtros) {
    const lineaInicial = Number(filtros.linea);
    return mercados.filter(item => {
      if (item.categoria !== filtros.categoria) return false;
      if (filtros.familia !== 'todas' && familia(item) !== filtros.familia) return false;
      if (item.alcance !== filtros.alcance || item.tipo !== filtros.tipo) return false;
      if (!Number.isFinite(item.linea) || !Number.isFinite(lineaInicial)) return false;
      return filtros.tipo === 'under' ? item.linea <= lineaInicial : item.linea >= lineaInicial;
    }).sort((a, b) => filtros.tipo === 'under' ? b.linea - a.linea : a.linea - b.linea);
  }

  return { familia, familias, filtrar, lineas, normalizar };
});

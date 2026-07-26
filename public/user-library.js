(function (global) {
  const FAVORITOS = 'futbol:favoritos:v1';
  const COMPARACIONES = 'futbol:comparaciones:v1';

  function crearBiblioteca(storage) {
    const leer = (clave) => {
      try {
        const valor = JSON.parse(storage.getItem(clave) || '[]');
        return Array.isArray(valor) ? valor : [];
      } catch { return []; }
    };
    const escribir = (clave, valor) => {
      try { storage.setItem(clave, JSON.stringify(valor)); return true; } catch { return false; }
    };
    const idEquipo = equipo => `${Number(equipo.id)}:${Number(equipo.league)}`;

    return {
      favoritos() { return leer(FAVORITOS); },
      esFavorito(id, league) { return leer(FAVORITOS).some(e => idEquipo(e) === `${Number(id)}:${Number(league)}`); },
      alternarFavorito(equipo) {
        const lista = leer(FAVORITOS);
        const clave = idEquipo(equipo);
        const indice = lista.findIndex(e => idEquipo(e) === clave);
        if (indice >= 0) lista.splice(indice, 1);
        else lista.unshift({ ...equipo, id: Number(equipo.id), league: Number(equipo.league), guardado_en: new Date().toISOString() });
        escribir(FAVORITOS, lista.slice(0, 30));
        return indice < 0;
      },
      comparaciones() { return leer(COMPARACIONES); },
      guardarComparacion(comparacion) {
        const lista = leer(COMPARACIONES).filter(item => item.id !== comparacion.id);
        lista.unshift({ ...comparacion, guardado_en: new Date().toISOString() });
        escribir(COMPARACIONES, lista.slice(0, 15));
        return lista[0];
      },
      quitarComparacion(id) {
        return escribir(COMPARACIONES, leer(COMPARACIONES).filter(item => item.id !== id));
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { crearBiblioteca };
  if (global?.localStorage) global.FutbolLibrary = crearBiblioteca(global.localStorage);
})(typeof window !== 'undefined' ? window : globalThis);

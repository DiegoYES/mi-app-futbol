// Marcador y estado de un partido, compartido por el servidor y el navegador.
//
// API-Football devuelve en `goals` el marcador con el que se liquidan los
// mercados (90' o 120' si hubo prórroga) y guarda la tanda de penales aparte,
// en `score.penalty`. Un partido que termina 1-1 y se define 4-3 desde el
// manchón sigue siendo un empate a efectos de 1X2: los penales sólo deciden
// quién avanza. Por eso aquí el marcador principal nunca los incluye y la
// tanda se expone siempre como dato adicional.
(function iniciarMarcador(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutbolMarcador = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function crearMarcador() {
  const ESTADOS_FINALIZADOS = ['FT', 'AET', 'PEN'];

  const ETIQUETAS_ESTADO = {
    PST: 'Aplazado',
    CANC: 'Cancelado',
    Canc: 'Cancelado',
    ABD: 'Abandonado',
    AWD: 'Adjudicado',
    WO: 'Walkover',
    SUSP: 'Suspendido',
    INT: 'Interrumpido',
    TBD: 'Por confirmar',
    '1H': 'En vivo',
    HT: 'Descanso',
    '2H': 'En vivo',
    ET: 'Prórroga',
    BT: 'Pausa',
    P: 'Penales'
  };

  function normalizarEstado(estado) {
    return String(estado || '').toUpperCase();
  }

  function esFinalizado(estado) {
    return ESTADOS_FINALIZADOS.includes(normalizarEstado(estado));
  }

  function numeroONulo(valor) {
    return Number.isFinite(Number(valor)) && valor !== null && valor !== '' ? Number(valor) : null;
  }

  // Devuelve { local, visitante } sólo si ambos lados traen un número.
  // Una tanda a medias no es información publicable.
  function marcadorParcial(origen) {
    if (!origen) return null;
    const local = numeroONulo(origen.local ?? origen.home);
    const visitante = numeroONulo(origen.visitante ?? origen.away);
    if (local === null || visitante === null) return null;
    return { local, visitante };
  }

  function penalesDe(partido) {
    return marcadorParcial(partido && partido.penales);
  }

  function prorrogaDe(partido) {
    return marcadorParcial(partido && partido.goles_prorroga);
  }

  // Quién avanza tras la tanda: 'local' | 'visitante' | null.
  function ganadorPenales(partido) {
    const tanda = penalesDe(partido);
    if (!tanda || tanda.local === tanda.visitante) return null;
    return tanda.local > tanda.visitante ? 'local' : 'visitante';
  }

  // Etiqueta corta de la columna de estado en el calendario.
  function etiquetaEstado(partido, alternativa = '') {
    const estado = normalizarEstado(partido && partido.estado);
    if (estado === 'PEN') return 'Penales';
    if (estado === 'AET') return 'Final (pró.)';
    if (estado === 'FT') return 'Final';
    return ETIQUETAS_ESTADO[estado] || alternativa || estado || '';
  }

  // Marcador principal, sin penales. Devuelve '' si aún no hay datos.
  function textoMarcador(partido) {
    if (!partido) return '';
    const local = numeroONulo(partido.local && partido.local.goles);
    const visitante = numeroONulo(partido.visitante && partido.visitante.goles);
    if (local === null && visitante === null) return '';
    return `${local ?? 0} - ${visitante ?? 0}`;
  }

  // Texto auxiliar con la tanda: '(4 - 3 pen.)'. Vacío si no hubo penales.
  function textoPenales(partido) {
    const tanda = penalesDe(partido);
    return tanda ? `(${tanda.local} - ${tanda.visitante} pen.)` : '';
  }

  // Lectura accesible completa: '1 - 1, 4 - 3 en penales'.
  function descripcionMarcador(partido) {
    const base = textoMarcador(partido);
    const tanda = penalesDe(partido);
    if (!base) return '';
    return tanda ? `${base}, ${tanda.local} - ${tanda.visitante} en penales` : base;
  }

  return {
    ESTADOS_FINALIZADOS,
    ETIQUETAS_ESTADO,
    esFinalizado,
    penalesDe,
    prorrogaDe,
    ganadorPenales,
    etiquetaEstado,
    textoMarcador,
    textoPenales,
    descripcionMarcador
  };
});

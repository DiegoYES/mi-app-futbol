function idLinea(linea) {
  return String(linea).replace('.', '_');
}

function crearMercado({ id, nombre, categoria, cumple, medir, unidad, requiereAvanzadas = false, tipo = null, linea = null, alcance = 'total' }) {
  return { id, nombre, categoria, cumple, medir, unidad, requiereAvanzadas, tipo, linea, alcance };
}

const MERCADOS_GOLES = [
  crearMercado({ id: 'over_0_5', nombre: 'Más de 0.5 goles', categoria: 'goles', tipo: 'over', linea: 0.5, unidad: 'goles', medir: (l, v) => l.goles + v.goles, cumple: (l, v) => l.goles + v.goles > 0.5 }),
  crearMercado({ id: 'over_1_5', nombre: 'Más de 1.5 goles', categoria: 'goles', tipo: 'over', linea: 1.5, unidad: 'goles', medir: (l, v) => l.goles + v.goles, cumple: (l, v) => l.goles + v.goles > 1.5 }),
  crearMercado({ id: 'over_2_5', nombre: 'Más de 2.5 goles', categoria: 'goles', tipo: 'over', linea: 2.5, unidad: 'goles', medir: (l, v) => l.goles + v.goles, cumple: (l, v) => l.goles + v.goles > 2.5 }),
  crearMercado({ id: 'over_3_5', nombre: 'Más de 3.5 goles', categoria: 'goles', tipo: 'over', linea: 3.5, unidad: 'goles', medir: (l, v) => l.goles + v.goles, cumple: (l, v) => l.goles + v.goles > 3.5 }),
  crearMercado({ id: 'under_1_5', nombre: 'Menos de 1.5 goles', categoria: 'goles', tipo: 'under', linea: 1.5, unidad: 'goles', medir: (l, v) => l.goles + v.goles, cumple: (l, v) => l.goles + v.goles < 1.5 }),
  crearMercado({ id: 'under_2_5', nombre: 'Menos de 2.5 goles', categoria: 'goles', tipo: 'under', linea: 2.5, unidad: 'goles', medir: (l, v) => l.goles + v.goles, cumple: (l, v) => l.goles + v.goles < 2.5 }),
  crearMercado({ id: 'under_3_5', nombre: 'Menos de 3.5 goles', categoria: 'goles', tipo: 'under', linea: 3.5, unidad: 'goles', medir: (l, v) => l.goles + v.goles, cumple: (l, v) => l.goles + v.goles < 3.5 }),
  crearMercado({ id: 'ambos_anotan', nombre: 'Ambos anotan', categoria: 'goles', unidad: 'marcador', medir: (l, v) => `${l.goles}-${v.goles}`, cumple: (l, v) => l.goles >= 1 && v.goles >= 1 }),
  crearMercado({ id: 'local_marca', nombre: 'Local marca', categoria: 'goles', alcance: 'local', unidad: 'goles', medir: l => l.goles, cumple: l => l.goles >= 1 }),
  crearMercado({ id: 'visitante_marca', nombre: 'Visitante marca', categoria: 'goles', alcance: 'visitante', unidad: 'goles', medir: (l, v) => v.goles, cumple: (l, v) => v.goles >= 1 }),
  crearMercado({ id: 'local_over_1_5', nombre: 'Local más de 1.5 goles', categoria: 'goles', tipo: 'over', linea: 1.5, alcance: 'local', unidad: 'goles', medir: l => l.goles, cumple: l => l.goles > 1.5 }),
  crearMercado({ id: 'visitante_over_1_5', nombre: 'Visitante más de 1.5 goles', categoria: 'goles', tipo: 'over', linea: 1.5, alcance: 'visitante', unidad: 'goles', medir: (l, v) => v.goles, cumple: (l, v) => v.goles > 1.5 }),
  crearMercado({ id: 'local_no_pierde', nombre: 'Local gana o empata', categoria: 'resultado', alcance: 'local', unidad: 'marcador', medir: (l, v) => `${l.goles}-${v.goles}`, cumple: (l, v) => l.goles >= v.goles })
];

const FAMILIAS_AVANZADAS = [
  { categoria: 'corners', estadistica: 'corners', etiqueta: 'córners', total: [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5], equipo: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5] },
  { categoria: 'tarjetas', estadistica: 'amarillas', etiqueta: 'tarjetas amarillas', total: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5], equipo: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5] },
  { categoria: 'tarjetas', estadistica: 'rojas', etiqueta: 'tarjetas rojas', total: [0.5, 1.5], equipo: [0.5] },
  { categoria: 'tiros', estadistica: 'tiros', etiqueta: 'tiros', total: [15.5, 17.5, 19.5, 21.5, 23.5, 25.5, 27.5, 29.5, 31.5, 33.5, 35.5], equipo: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5] },
  { categoria: 'tiros_puerta', estadistica: 'tiros_puerta', etiqueta: 'tiros a puerta', total: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5], equipo: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5] },
  { categoria: 'faltas', estadistica: 'faltas', etiqueta: 'faltas', total: [17.5, 19.5, 21.5, 23.5, 25.5, 27.5, 29.5, 31.5, 33.5], equipo: [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5] },
  { categoria: 'offsides', estadistica: 'offsides', etiqueta: 'fueras de juego', total: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5], equipo: [0.5, 1.5, 2.5, 3.5, 4.5] }
];

function crearMercadosNumericos() {
  const mercados = [];
  const dato = (equipo, campo) => Number.isFinite(equipo?.[campo]) ? equipo[campo] : null;
  const alcances = [
    { id: 'total', nombre: 'totales', valor: (l, v, campo) => {
      const local = dato(l, campo);
      const visitante = dato(v, campo);
      return local === null || visitante === null ? null : local + visitante;
    } },
    { id: 'local', nombre: 'del local', valor: (l, v, campo) => dato(l, campo) },
    { id: 'visitante', nombre: 'del visitante', valor: (l, v, campo) => dato(v, campo) }
  ];

  for (const familia of FAMILIAS_AVANZADAS) {
    for (const alcance of alcances) {
      const lineas = alcance.id === 'total' ? familia.total : familia.equipo;
      for (const linea of lineas) {
        for (const tipo of ['over', 'under']) {
          const mas = tipo === 'over';
          mercados.push(crearMercado({
            id: `${familia.estadistica}_${alcance.id}_${tipo}_${idLinea(linea)}`,
            nombre: `${mas ? 'Más' : 'Menos'} de ${linea} ${familia.etiqueta} ${alcance.nombre}`,
            categoria: familia.categoria,
            tipo,
            linea,
            alcance: alcance.id,
            unidad: familia.etiqueta,
            requiereAvanzadas: true,
            medir: (local, visitante) => alcance.valor(local, visitante, familia.estadistica),
            cumple: (local, visitante) => {
              const valor = alcance.valor(local, visitante, familia.estadistica);
              return valor === null ? false : mas ? valor > linea : valor < linea;
            }
          }));
        }
      }
    }
  }
  return mercados;
}

function crearMercadosTarjetasRegistradas() {
  const mercados = [];
  const tarjetas = equipo => Number.isFinite(equipo?.amarillas) && Number.isFinite(equipo?.rojas)
    ? equipo.amarillas + equipo.rojas
    : null;
  const total = (a, b) => a === null || b === null ? null : a + b;
  const alcances = [
    { id: 'total', nombre: 'totales', lineas: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5], valor: (l, v) => total(tarjetas(l), tarjetas(v)) },
    { id: 'local', nombre: 'del local', lineas: [0.5, 1.5, 2.5, 3.5, 4.5], valor: l => tarjetas(l) },
    { id: 'visitante', nombre: 'del visitante', lineas: [0.5, 1.5, 2.5, 3.5, 4.5], valor: (l, v) => tarjetas(v) }
  ];
  for (const alcance of alcances) {
    for (const linea of alcance.lineas) {
      for (const tipo of ['over', 'under']) {
        const mas = tipo === 'over';
        mercados.push(crearMercado({
          id: `tarjetas_registradas_${alcance.id}_${tipo}_${idLinea(linea)}`,
          nombre: `${mas ? 'Más' : 'Menos'} de ${linea} tarjetas registradas ${alcance.nombre}`,
          categoria: 'tarjetas', tipo, linea, alcance: alcance.id,
          unidad: 'tarjetas registradas', requiereAvanzadas: true,
          medir: alcance.valor,
          cumple: (local, visitante) => {
            const valor = alcance.valor(local, visitante);
            return valor === null ? false : mas ? valor > linea : valor < linea;
          }
        }));
      }
    }
  }
  return mercados;
}

const MERCADOS = [...MERCADOS_GOLES, ...crearMercadosNumericos(), ...crearMercadosTarjetasRegistradas()];
const MERCADOS_POR_ID = new Map(MERCADOS.map(mercado => [mercado.id, mercado]));

function crearMercadoDinamico(id) {
  if (typeof id !== 'string') return null;
  const coincidenciaLegacyGoles = id.match(/^(over|under)_(\d+(?:_\d+)?)$/);
  if (coincidenciaLegacyGoles) {
    const tipo = coincidenciaLegacyGoles[1];
    const linea = Number(coincidenciaLegacyGoles[2].replace('_', '.'));
    if (!Number.isFinite(linea) || linea <= 0) return null;
    const mas = tipo === 'over';
    return crearMercado({
      id,
      nombre: `${mas ? 'Más' : 'Menos'} de ${linea} goles`,
      categoria: 'goles',
      tipo,
      linea,
      alcance: 'total',
      unidad: 'goles',
      requiereAvanzadas: false,
      medir: (l, v) => (l?.goles ?? null) === null || (v?.goles ?? null) === null ? null : l.goles + v.goles,
      cumple: (l, v) => {
        const total = (l?.goles ?? null) === null || (v?.goles ?? null) === null ? null : l.goles + v.goles;
        return total === null ? false : mas ? total > linea : total < linea;
      }
    });
  }

  const coincidencia = id.match(/^([a-z_]+)_(total|local|visitante)_(over|under)_(\d+(?:_\d+)?)$/);
  if (!coincidencia) return null;
  const [, prefijo, alcanceId, tipo, lineaStr] = coincidencia;
  const linea = Number(lineaStr.replace('_', '.'));
  if (!Number.isFinite(linea) || linea <= 0) return null;

  const mas = tipo === 'over';
  const dato = (equipo, campo) => Number.isFinite(equipo?.[campo]) ? equipo[campo] : null;
  const nombresAlcance = { total: 'totales', local: 'del local', visitante: 'del visitante' };
  const etiquetaAlcance = nombresAlcance[alcanceId];
  if (!etiquetaAlcance) return null;

  if (prefijo === 'goles') {
    const valorGoles = alcanceId === 'total'
      ? (l, v) => ((l?.goles ?? null) === null || (v?.goles ?? null) === null ? null : l.goles + v.goles)
      : alcanceId === 'local'
        ? l => l?.goles ?? null
        : (l, v) => v?.goles ?? null;
    return crearMercado({
      id,
      nombre: `${mas ? 'Más' : 'Menos'} de ${linea} goles ${etiquetaAlcance}`,
      categoria: 'goles',
      tipo,
      linea,
      alcance: alcanceId,
      unidad: 'goles',
      requiereAvanzadas: false,
      medir: valorGoles,
      cumple: (local, visitante) => {
        const valor = valorGoles(local, visitante);
        return valor === null ? false : mas ? valor > linea : valor < linea;
      }
    });
  }

  if (prefijo === 'tarjetas_registradas') {
    const tarjetas = equipo => Number.isFinite(equipo?.amarillas) && Number.isFinite(equipo?.rojas)
      ? equipo.amarillas + equipo.rojas
      : null;
    const valorTR = alcanceId === 'total'
      ? (l, v) => (tarjetas(l) === null || tarjetas(v) === null ? null : tarjetas(l) + tarjetas(v))
      : alcanceId === 'local'
        ? l => tarjetas(l)
        : (l, v) => tarjetas(v);
    return crearMercado({
      id,
      nombre: `${mas ? 'Más' : 'Menos'} de ${linea} tarjetas registradas ${etiquetaAlcance}`,
      categoria: 'tarjetas',
      tipo,
      linea,
      alcance: alcanceId,
      unidad: 'tarjetas registradas',
      requiereAvanzadas: true,
      medir: valorTR,
      cumple: (local, visitante) => {
        const valor = valorTR(local, visitante);
        return valor === null ? false : mas ? valor > linea : valor < linea;
      }
    });
  }

  const familia = FAMILIAS_AVANZADAS.find(item => item.estadistica === prefijo);
  if (!familia) return null;

  const valorAvanzada = alcanceId === 'total'
    ? (l, v, campo) => {
      const local = dato(l, campo);
      const visitante = dato(v, campo);
      return local === null || visitante === null ? null : local + visitante;
    }
    : alcanceId === 'local'
      ? (l, v, campo) => dato(l, campo)
      : (l, v, campo) => dato(v, campo);

  return crearMercado({
    id,
    nombre: `${mas ? 'Más' : 'Menos'} de ${linea} ${familia.etiqueta} ${etiquetaAlcance}`,
    categoria: familia.categoria,
    tipo,
    linea,
    alcance: alcanceId,
    unidad: familia.etiqueta,
    requiereAvanzadas: true,
    medir: (local, visitante) => valorAvanzada(local, visitante, familia.estadistica),
    cumple: (local, visitante) => {
      const valor = valorAvanzada(local, visitante, familia.estadistica);
      return valor === null ? false : mas ? valor > linea : valor < linea;
    }
  });
}

function obtenerMercado(id) {
  let mercado = MERCADOS_POR_ID.get(id);
  if (mercado) return mercado;
  mercado = crearMercadoDinamico(id);
  if (mercado) {
    MERCADOS_POR_ID.set(id, mercado);
  }
  return mercado || null;
}

function estadisticaParaCategoria(categoria) {
  if (categoria === 'goles') return 'goles';
  if (categoria === 'tarjetas') return 'tarjetas_registradas';
  const familia = FAMILIAS_AVANZADAS.find(f => f.categoria === categoria);
  return familia ? familia.estadistica : null;
}

function construirMercadosPersonalizados({ categoria, alcance, linea }) {
  const numLinea = Number(linea);
  if (!Number.isFinite(numLinea) || numLinea <= 0) return [];
  const estadistica = estadisticaParaCategoria(categoria);
  if (!estadistica) return [];

  const alcances = alcance && ['local', 'visitante', 'total'].includes(alcance)
    ? [alcance]
    : ['total', 'local', 'visitante'];

  const mercados = [];
  for (const alc of alcances) {
    for (const tipo of ['over', 'under']) {
      const id = `${estadistica}_${alc}_${tipo}_${idLinea(numLinea)}`;
      const mercado = obtenerMercado(id);
      if (mercado) mercados.push(mercado);
    }
  }
  return mercados;
}

module.exports = {
  FAMILIAS_AVANZADAS,
  MERCADOS,
  construirMercadosPersonalizados,
  crearMercadoDinamico,
  idLinea,
  obtenerMercado
};

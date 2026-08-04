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
  { categoria: 'corners', estadistica: 'corners', etiqueta: 'córners', total: [6.5, 7.5, 8.5, 9.5, 10.5, 11.5], equipo: [2.5, 3.5, 4.5, 5.5, 6.5] },
  { categoria: 'tarjetas', estadistica: 'amarillas', etiqueta: 'tarjetas amarillas', total: [1.5, 2.5, 3.5, 4.5, 5.5], equipo: [0.5, 1.5, 2.5, 3.5] },
  { categoria: 'tarjetas', estadistica: 'rojas', etiqueta: 'tarjetas rojas', total: [0.5], equipo: [0.5] },
  { categoria: 'tiros', estadistica: 'tiros', etiqueta: 'tiros', total: [17.5, 19.5, 21.5, 23.5, 25.5, 27.5], equipo: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5] },
  { categoria: 'tiros_puerta', estadistica: 'tiros_puerta', etiqueta: 'tiros a puerta', total: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5], equipo: [1.5, 2.5, 3.5, 4.5, 5.5] },
  { categoria: 'faltas', estadistica: 'faltas', etiqueta: 'faltas', total: [19.5, 21.5, 23.5, 25.5, 27.5, 29.5], equipo: [8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5] },
  { categoria: 'offsides', estadistica: 'offsides', etiqueta: 'fueras de juego', total: [1.5, 2.5, 3.5, 4.5, 5.5], equipo: [0.5, 1.5, 2.5, 3.5] }
];

function crearMercadosNumericos() {
  const mercados = [];
  const alcances = [
    { id: 'total', nombre: 'totales', valor: (l, v, campo) => l[campo] + v[campo] },
    { id: 'local', nombre: 'del local', valor: (l, v, campo) => l[campo] },
    { id: 'visitante', nombre: 'del visitante', valor: (l, v, campo) => v[campo] }
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
              return mas ? valor > linea : valor < linea;
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
  const tarjetas = equipo => (Number(equipo?.amarillas) || 0) + (Number(equipo?.rojas) || 0);
  const alcances = [
    { id: 'total', nombre: 'totales', lineas: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5], valor: (l, v) => tarjetas(l) + tarjetas(v) },
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
          cumple: (local, visitante) => mas ? alcance.valor(local, visitante) > linea : alcance.valor(local, visitante) < linea
        }));
      }
    }
  }
  return mercados;
}

const MERCADOS = [...MERCADOS_GOLES, ...crearMercadosNumericos(), ...crearMercadosTarjetasRegistradas()];
const MERCADOS_POR_ID = new Map(MERCADOS.map(mercado => [mercado.id, mercado]));

function obtenerMercado(id) {
  return MERCADOS_POR_ID.get(id) || null;
}

module.exports = { FAMILIAS_AVANZADAS, MERCADOS, obtenerMercado };

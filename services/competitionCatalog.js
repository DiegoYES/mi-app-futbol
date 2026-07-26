function sumarCobertura(destino, cobertura = {}) {
  destino.estadisticas += Number(cobertura.estadisticas) || 0;
  destino.detalles += Number(cobertura.detalles) || 0;
  destino.jugadores += Number(cobertura.jugadores) || 0;
}

function construirCatalogo(filas, ligasConfiguradas, etiquetarTemporada) {
  const porLiga = new Map();

  for (const fila of filas) {
    const idCrudo = fila?._id?.id;
    const temporadaCruda = fila?._id?.temporada;
    if (idCrudo === null || idCrudo === undefined || idCrudo === ''
      || temporadaCruda === null || temporadaCruda === undefined || temporadaCruda === '') continue;
    const id = Number(idCrudo);
    const temporada = Number(temporadaCruda);
    if (!Number.isInteger(id) || !Number.isInteger(temporada)) continue;

    if (!porLiga.has(id)) {
      const configurada = ligasConfiguradas[id] || {};
      porLiga.set(id, {
        id,
        nombre: fila.nombre || configurada.nombre || `Competición ${id}`,
        pais: configurada.pais || 'Internacional',
        principal: configurada.liga_principal === true,
        temporadas: [],
        resumen: {
          partidos: 0,
          finalizados: 0,
          cobertura: { estadisticas: 0, detalles: 0, jugadores: 0 }
        }
      });
    }

    const competencia = porLiga.get(id);
    const cobertura = {
      estadisticas: Number(fila.estadisticas) || 0,
      detalles: Number(fila.detalles) || 0,
      jugadores: Number(fila.jugadores) || 0
    };
    competencia.temporadas.push({
      temporada,
      etiqueta: etiquetarTemporada(id, temporada),
      partidos: Number(fila.partidos) || 0,
      finalizados: Number(fila.finalizados) || 0,
      cobertura,
      desde: fila.desde || null,
      hasta: fila.hasta || null
    });
    competencia.resumen.partidos += Number(fila.partidos) || 0;
    competencia.resumen.finalizados += Number(fila.finalizados) || 0;
    sumarCobertura(competencia.resumen.cobertura, cobertura);
  }

  return [...porLiga.values()]
    .map(competencia => {
      competencia.temporadas.sort((a, b) => b.temporada - a.temporada);
      const actual = competencia.temporadas[0] || null;
      return {
        ...competencia,
        temporada: actual?.temporada ?? null,
        temporada_actual: actual?.temporada ?? null,
        temporada_actual_etiqueta: actual?.etiqueta ?? null
      };
    })
    .sort((a, b) => Number(b.principal) - Number(a.principal)
      || a.nombre.localeCompare(b.nombre, 'es'));
}

module.exports = { construirCatalogo };

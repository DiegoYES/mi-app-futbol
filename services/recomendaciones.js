const TIPOS = new Set(['pick', 'combinada', 'parlay']);
const VISIBILIDADES = new Set(['gratis', 'premium']);
const ESTADOS_PUBLICACION = new Set(['borrador', 'publicada']);
const RESULTADOS = new Set(['pendiente', 'acertado', 'fallado', 'anulado']);

function texto(valor, maximo) {
  return typeof valor === 'string' ? valor.trim().slice(0, maximo) : '';
}

function decimalAAmericano(decimal) {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
}

function americanoADecimal(americano) {
  if (!Number.isInteger(americano) || (americano > -100 && americano < 100)) return null;
  return americano > 0
    ? 1 + americano / 100
    : 1 + 100 / Math.abs(americano);
}

function normalizarMomio(valor, formato) {
  const capturado = typeof valor === 'number' ? String(valor) : texto(valor, 30);
  if (!capturado || !['decimal', 'americano'].includes(formato)) return null;
  if (formato === 'decimal') {
    const decimal = Number(capturado.replace(',', '.'));
    if (!Number.isFinite(decimal) || decimal <= 1 || decimal > 100000) return null;
    return {
      cuota: Number(decimal.toFixed(4)),
      americano: decimalAAmericano(decimal),
      formato,
      capturado
    };
  }
  if (!/^[+-]?\d+$/.test(capturado)) return null;
  const americanoCapturado = Number(capturado);
  const decimal = americanoADecimal(americanoCapturado);
  if (!decimal || decimal > 100000 || Math.abs(americanoCapturado) > 10000000) return null;
  const americano = americanoCapturado === -100 ? 100 : americanoCapturado;
  return {
    cuota: Number(decimal.toFixed(4)),
    americano,
    formato,
    capturado: americano > 0 ? `+${americano}` : String(americano)
  };
}

function normalizarRecomendacion(entrada = {}) {
  const tipo = TIPOS.has(entrada.tipo) ? entrada.tipo : null;
  const titulo = texto(entrada.titulo, 140);
  const visibilidad = VISIBILIDADES.has(entrada.visibilidad) ? entrada.visibilidad : null;
  const estadoPublicacion = ESTADOS_PUBLICACION.has(entrada.estado_publicacion)
    ? entrada.estado_publicacion : null;
  const resultado = RESULTADOS.has(entrada.resultado) ? entrada.resultado : null;
  const cierraEn = new Date(entrada.cierra_en);
  const selecciones = Array.isArray(entrada.selecciones)
    ? entrada.selecciones.slice(0, 20).map(item => {
        const momio = normalizarMomio(item?.momio, item?.formato_momio);
        return {
          partido_api_id: Number(item?.partido_api_id),
          mercado_id: texto(item?.mercado_id, 120),
          cuota: momio?.cuota,
          momio_americano: momio?.americano,
          formato_momio: momio?.formato,
          momio_capturado: momio?.capturado,
          casa: texto(item?.casa, 80)
        };
      })
    : [];
  const cuotaCalculada = selecciones.reduce((total, item) => total * (item.cuota || 1), 1);
  const formatoMomioTotal = ['decimal', 'americano'].includes(entrada.formato_momio_total)
    ? entrada.formato_momio_total : 'decimal';
  const momioTotal = normalizarMomio(
    entrada.momio_total === '' || entrada.momio_total === null || entrada.momio_total === undefined
      ? cuotaCalculada.toFixed(4)
      : entrada.momio_total,
    formatoMomioTotal
  );

  if (!tipo || !titulo || !visibilidad || !estadoPublicacion || !resultado) {
    return { error: 'Completa tipo, título, visibilidad, publicación y resultado.' };
  }
  if (Number.isNaN(cierraEn.getTime())) return { error: 'La fecha límite no es válida.' };
  if ((tipo === 'pick' && selecciones.length !== 1)
      || (tipo !== 'pick' && (selecciones.length < 2 || selecciones.length > 20))) {
    return { error: 'Un pick requiere una selección; una combinada o parlay, entre 2 y 20.' };
  }
  if (tipo === 'combinada'
      && new Set(selecciones.map(item => item.partido_api_id)).size !== 1) {
    return { error: 'Una combinada solo puede incluir selecciones del mismo partido.' };
  }
  if (selecciones.some(item => !Number.isInteger(item.partido_api_id) || !item.mercado_id)) {
    return { error: 'Cada selección necesita un partido y un mercado válidos.' };
  }
  if (selecciones.some(item => !Number.isFinite(item.cuota) || item.cuota > 1000)) {
    return { error: 'Captura un momio decimal mayor a 1 o americano desde +100/-100.' };
  }
  if (!momioTotal) {
    return { error: 'El momio total no es válido.' };
  }

  return { datos: {
    tipo,
    titulo,
    descripcion: texto(entrada.descripcion, 3000),
    visibilidad,
    estado_publicacion: estadoPublicacion,
    resultado,
    destacada: Boolean(entrada.destacada),
    selecciones,
    cuota_total: momioTotal.cuota,
    momio_total_americano: momioTotal.americano,
    formato_momio_total: momioTotal.formato,
    momio_total_capturado: momioTotal.capturado,
    cierra_en: cierraEn
  } };
}

function recomendacionParaUsuario(recomendacion, tieneAcceso) {
  const item = recomendacion.toObject ? recomendacion.toObject() : { ...recomendacion };
  const bloqueada = item.visibilidad === 'premium' && !tieneAcceso;
  if (!bloqueada) return { ...item, bloqueada: false };
  return {
    _id: item._id,
    tipo: item.tipo,
    titulo: item.titulo,
    visibilidad: item.visibilidad,
    estado_publicacion: item.estado_publicacion,
    resultado: item.resultado,
    destacada: item.destacada,
    cuota_total: item.cuota_total,
    momio_total_americano: item.momio_total_americano,
    cierra_en: item.cierra_en,
    publicada_en: item.publicada_en,
    bloqueada: true,
    selecciones: []
  };
}

module.exports = {
  americanoADecimal,
  decimalAAmericano,
  normalizarMomio,
  normalizarRecomendacion,
  recomendacionParaUsuario
};

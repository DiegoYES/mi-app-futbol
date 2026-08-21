const TIPOS = new Set(['pick', 'parlay']);
const VISIBILIDADES = new Set(['gratis', 'premium']);
const ESTADOS_PUBLICACION = new Set(['borrador', 'publicada']);
const RESULTADOS = new Set(['pendiente', 'acertado', 'fallado', 'anulado']);

function texto(valor, maximo) {
  return typeof valor === 'string' ? valor.trim().slice(0, maximo) : '';
}

function numeroOpcional(valor) {
  if (valor === '' || valor === null || valor === undefined) return undefined;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : NaN;
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
    ? entrada.selecciones.slice(0, 20).map(item => ({
        evento: texto(item?.evento, 140),
        mercado: texto(item?.mercado, 180),
        cuota: numeroOpcional(item?.cuota),
        casa: texto(item?.casa, 80)
      }))
    : [];
  const cuotaTotal = numeroOpcional(entrada.cuota_total);

  if (!tipo || !titulo || !visibilidad || !estadoPublicacion || !resultado) {
    return { error: 'Completa tipo, título, visibilidad, publicación y resultado.' };
  }
  if (Number.isNaN(cierraEn.getTime())) return { error: 'La fecha límite no es válida.' };
  if ((tipo === 'pick' && selecciones.length !== 1)
      || (tipo === 'parlay' && (selecciones.length < 2 || selecciones.length > 20))) {
    return { error: 'Un pick requiere una selección y un parlay entre 2 y 20.' };
  }
  if (selecciones.some(item => !item.evento || !item.mercado)) {
    return { error: 'Cada selección necesita evento y mercado.' };
  }
  if (selecciones.some(item => item.cuota !== undefined
      && (!Number.isFinite(item.cuota) || item.cuota < 1 || item.cuota > 1000))) {
    return { error: 'Las cuotas deben estar entre 1 y 1000.' };
  }
  if (cuotaTotal !== undefined
      && (!Number.isFinite(cuotaTotal) || cuotaTotal < 1 || cuotaTotal > 100000)) {
    return { error: 'La cuota total debe estar entre 1 y 100000.' };
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
    cuota_total: cuotaTotal,
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
    cierra_en: item.cierra_en,
    publicada_en: item.publicada_en,
    bloqueada: true,
    selecciones: []
  };
}

module.exports = { normalizarRecomendacion, recomendacionParaUsuario };

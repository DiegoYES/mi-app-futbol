const PlaydoitProvider = require('../../providers/PlaydoitProvider');
const ActualizacionMercados = require('../../models/ActualizacionMercados');
const { guardarLote } = require('./marketRepository');

let actualizacionEnCurso = null;

async function refrescarMercados(opciones = {}) {
  if (actualizacionEnCurso) return actualizacionEnCurso;
  actualizacionEnCurso = ejecutarActualizacion(opciones);
  try { return await actualizacionEnCurso; } finally { actualizacionEnCurso = null; }
}

async function ejecutarActualizacion(opciones = {}) {
  const proveedor = opciones.proveedor || new PlaydoitProvider(opciones);
  const lote = await ActualizacionMercados.create({ proveedor: proveedor.nombre, estrategia: 'pendiente' });
  try {
    const resultado = await proveedor.refreshMarkets();
    const validas = resultado.selecciones.filter(item => item.evento_nombre && item.mercado && item.texto_origen);
    const guardadas = await guardarLote(validas, lote._id);
    lote.estado = guardadas ? (resultado.problemas.length ? 'PARCIAL' : 'COMPLETA') : 'ERROR';
    lote.estrategia = resultado.estrategia;
    lote.terminada_en = new Date();
    lote.eventos = new Set(validas.map(item => item.evento_externo_id || item.evento_nombre)).size;
    lote.selecciones_detectadas = resultado.selecciones.length;
    lote.selecciones_guardadas = guardadas;
    lote.descartadas = resultado.selecciones.length - validas.length;
    lote.problemas = resultado.problemas.map(item => ({ fase: item.fase, mensaje: String(item.mensaje).slice(0, 500) }));
    lote.metadata = { url_final: resultado.urlFinal || null };
    await lote.save();
    return lote.toObject();
  } catch (error) {
    lote.estado = 'ERROR'; lote.terminada_en = new Date();
    lote.problemas.push({ fase: 'refresh', mensaje: String(error.message).slice(0, 500) });
    await lote.save(); throw error;
  }
}

module.exports = { ejecutarActualizacion, refrescarMercados };

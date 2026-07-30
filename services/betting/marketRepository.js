const MercadoCasa = require('../../models/MercadoCasa');

function ttlMs() { return Math.max(1, Number(process.env.MARKET_CACHE_TTL_MINUTES || 10)) * 60000; }

async function guardarLote(selecciones, loteId) {
  const ahora = new Date(); const expira = new Date(ahora.getTime() + ttlMs());
  const documentos = selecciones.map(item => ({ ...item, recolectado_en: ahora, expira_en: expira, lote_id: loteId }));
  if (documentos.length) await MercadoCasa.insertMany(documentos, { ordered: false });
  return documentos.length;
}

async function vigentes(proveedor = 'playdoit', filtro = {}) {
  const ultima = await MercadoCasa.findOne({ proveedor, expira_en: { $gt: new Date() }, ...filtro })
    .sort({ recolectado_en: -1 }).select('lote_id').lean();
  if (!ultima) return [];
  return MercadoCasa.find({ proveedor, lote_id: ultima.lote_id, expira_en: { $gt: new Date() }, ...filtro })
    .sort({ recolectado_en: -1 }).lean();
}

module.exports = { guardarLote, ttlMs, vigentes };

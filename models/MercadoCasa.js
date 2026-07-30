const mongoose = require('mongoose');

const mercadoCasaSchema = new mongoose.Schema({
  proveedor: { type: String, required: true, index: true },
  evento_externo_id: String,
  mercado_externo_id: String,
  seleccion_externa_id: String,
  evento_nombre: { type: String, required: true },
  local: String,
  visitante: String,
  inicio: Date,
  deporte: { type: String, default: 'football' },
  liga: String,
  jugador: String,
  equipo: String,
  mercado: { type: String, required: true },
  categoria: { type: String, required: true },
  lado: { type: String, enum: ['OVER', 'UNDER', 'YES', 'NO', 'HOME', 'AWAY', 'DRAW', 'OTHER'], default: 'OTHER' },
  linea: Number,
  cuota: Number,
  estado: { type: String, enum: ['OPEN', 'SUSPENDED', 'CLOSED', 'UNKNOWN'], default: 'UNKNOWN' },
  texto_origen: { type: String, required: true },
  ambiguo: { type: Boolean, default: false },
  problemas: [String],
  recolectado_en: { type: Date, required: true, default: Date.now },
  expira_en: { type: Date, required: true },
  lote_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ActualizacionMercados' }
}, { versionKey: false });

mercadoCasaSchema.index({ proveedor: 1, evento_externo_id: 1, mercado_externo_id: 1, seleccion_externa_id: 1, recolectado_en: -1 });
mercadoCasaSchema.index({ proveedor: 1, inicio: 1, recolectado_en: -1 });
mercadoCasaSchema.index({ expira_en: 1 }, { expireAfterSeconds: 86400 * 7, name: 'historial_mercados_7_dias' });

module.exports = mongoose.model('MercadoCasa', mercadoCasaSchema);

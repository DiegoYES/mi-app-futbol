const mongoose = require('mongoose');

const actualizacionMercadosSchema = new mongoose.Schema({
  proveedor: { type: String, required: true, index: true },
  estado: { type: String, enum: ['INICIADA', 'COMPLETA', 'PARCIAL', 'ERROR'], default: 'INICIADA' },
  estrategia: String,
  iniciada_en: { type: Date, default: Date.now },
  terminada_en: Date,
  eventos: { type: Number, default: 0 },
  selecciones_detectadas: { type: Number, default: 0 },
  selecciones_guardadas: { type: Number, default: 0 },
  descartadas: { type: Number, default: 0 },
  problemas: [{ fase: String, evento: String, mensaje: String }],
  metadata: mongoose.Schema.Types.Mixed
}, { versionKey: false });

actualizacionMercadosSchema.index({ proveedor: 1, iniciada_en: -1 });
module.exports = mongoose.model('ActualizacionMercados', actualizacionMercadosSchema);

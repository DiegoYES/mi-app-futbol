const mongoose = require('mongoose');

const eventoPagoSchema = new mongoose.Schema({
  proveedor: { type: String, enum: ['mercadopago'], required: true },
  clave: { type: String, required: true },
  tipo: { type: String, required: true },
  recurso_id: { type: String, required: true },
  procesado_en: { type: Date, default: Date.now }
}, { timestamps: true });

eventoPagoSchema.index({ proveedor: 1, clave: 1 }, { unique: true });

module.exports = mongoose.model('EventoPago', eventoPagoSchema);

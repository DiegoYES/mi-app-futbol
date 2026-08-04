const mongoose = require('mongoose');

const suscripcionSchema = new mongoose.Schema({
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, unique: true, index: true },
  proveedor: { type: String, enum: ['mercadopago'], default: 'mercadopago' },
  proveedor_suscripcion_id: { type: String, default: null, unique: true, sparse: true },
  estado: {
    type: String,
    enum: ['sin_suscripcion', 'pendiente', 'autorizada', 'pausada', 'cancelada', 'vencida'],
    default: 'sin_suscripcion',
    index: true
  },
  importe: { type: Number, default: 70 },
  moneda: { type: String, default: 'MXN' },
  checkout_url: { type: String, default: null },
  periodo_inicio: { type: Date, default: null },
  periodo_fin: { type: Date, default: null },
  proximo_cobro: { type: Date, default: null },
  cancelada_en: { type: Date, default: null },
  ultimo_evento_en: { type: Date, default: null },
  ultimo_error: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Suscripcion', suscripcionSchema);

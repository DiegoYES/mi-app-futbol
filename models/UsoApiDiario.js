const mongoose = require('mongoose');

const usoApiDiarioSchema = new mongoose.Schema({
  proveedor: {
    type: String,
    required: true,
    trim: true,
    default: 'api-football'
  },
  dia: {
    type: String,
    required: true,
    match: /^\d{4}-\d{2}-\d{2}$/
  },
  zona_horaria: { type: String, required: true, default: 'UTC' },
  limite: { type: Number, required: true, min: 1 },
  limite_origen: { type: String, enum: ['configuracion', 'proveedor'], default: 'configuracion' },
  margen_seguridad: { type: Number, required: true, min: 0, default: 5 },
  usadas: { type: Number, required: true, min: 0, default: 0 },
  reservas: { type: Number, required: true, min: 0, default: 0 },
  restantes_proveedor: { type: Number, min: 0, default: null },
  ultimo_endpoint: { type: String, trim: true, maxlength: 200, default: null },
  ultima_reserva: { type: Date, default: null },
  ultima_sincronizacion: { type: Date, default: null }
}, {
  timestamps: { createdAt: 'creado_en', updatedAt: 'actualizado_en' },
  versionKey: false
});

// Una sola fila por proveedor y día hace que $inc sea un contador atómico entre
// varios procesos de sincronización.
usoApiDiarioSchema.index(
  { proveedor: 1, dia: 1 },
  { unique: true, name: 'proveedor_dia_unico' }
);

module.exports = mongoose.model('UsoApiDiario', usoApiDiarioSchema);

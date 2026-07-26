const mongoose = require('mongoose');

const pickGuardadoSchema = new mongoose.Schema({
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  partido_api_id: { type: Number, required: true },
  fecha_partido: { type: Date, required: true },
  liga: {
    id: { type: Number, required: true },
    nombre: String,
    temporada: Number
  },
  local: {
    id: { type: Number, required: true },
    nombre: String,
    logo: String
  },
  visitante: {
    id: { type: Number, required: true },
    nombre: String,
    logo: String
  },
  mercado: {
    id: { type: String, required: true },
    nombre: { type: String, required: true },
    categoria: String,
    tipo: String,
    linea: Number,
    alcance: String
  },
  estimacion: { type: Number, required: true, min: 0, max: 100 },
  confianza: { type: String, enum: ['alta', 'media', 'baja'], required: true },
  muestra: { type: Number, required: true, min: 0 },
  evidencia: [String],
  estado: {
    type: String,
    enum: ['pendiente', 'acertado', 'fallado', 'anulado'],
    default: 'pendiente'
  },
  marcador_final: {
    local: Number,
    visitante: Number
  },
  liquidado_en: Date
}, { timestamps: { createdAt: 'creado_en', updatedAt: 'actualizado_en' } });

pickGuardadoSchema.index(
  { usuario: 1, partido_api_id: 1, 'mercado.id': 1 },
  { unique: true, name: 'pick_usuario_partido_mercado_unico' }
);
pickGuardadoSchema.index(
  { usuario: 1, estado: 1, fecha_partido: -1 },
  { name: 'pick_usuario_estado_fecha' }
);

module.exports = mongoose.model('PickGuardado', pickGuardadoSchema);

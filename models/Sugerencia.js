const mongoose = require('mongoose');

const sugerenciaSchema = new mongoose.Schema({
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  tipo: {
    type: String,
    enum: ['idea', 'mejora', 'error', 'otro'],
    required: true
  },
  asunto: { type: String, required: true, trim: true, minlength: 5, maxlength: 120 },
  descripcion: { type: String, required: true, trim: true, minlength: 20, maxlength: 3000 },
  estado: {
    type: String,
    enum: ['nueva', 'en_revision', 'planeada', 'resuelta', 'descartada'],
    default: 'nueva',
    index: true
  },
  prioridad: {
    type: String,
    enum: ['baja', 'media', 'alta', 'urgente'],
    default: 'media'
  },
  respuesta_admin: { type: String, trim: true, maxlength: 2000, default: '' },
  respondida_por: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
  respondida_en: { type: Date, default: null }
}, {
  timestamps: { createdAt: 'creada_en', updatedAt: 'actualizada_en' }
});

sugerenciaSchema.index({ estado: 1, creada_en: -1 });
sugerenciaSchema.index({ usuario: 1, creada_en: -1 });

module.exports = mongoose.model('Sugerencia', sugerenciaSchema);

const mongoose = require('mongoose');

const bloqueoTrabajoSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 120 },
  propietario: { type: String, default: null, trim: true, maxlength: 200 },
  adquirido_en: { type: Date, default: null },
  renovado_en: { type: Date, default: null },
  expira_en: { type: Date, required: true }
}, {
  timestamps: { createdAt: 'creado_en', updatedAt: 'actualizado_en' },
  versionKey: false
});

bloqueoTrabajoSchema.index({ nombre: 1 }, { unique: true, name: 'trabajo_unico' });
bloqueoTrabajoSchema.index({ expira_en: 1 }, { name: 'bloqueo_expiracion' });

module.exports = mongoose.model('BloqueoTrabajo', bloqueoTrabajoSchema);

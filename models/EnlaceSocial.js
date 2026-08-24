const mongoose = require('mongoose');

const enlaceSocialSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 50 },
  url: { type: String, required: true, trim: true, maxlength: 500 },
  icono: { type: String, required: true, trim: true, maxlength: 30 },
  activo: { type: Boolean, default: true },
  orden: { type: Number, default: 0, min: 0, max: 999 }
}, { timestamps: { createdAt: 'creado_en', updatedAt: 'actualizado_en' } });

enlaceSocialSchema.index({ activo: 1, orden: 1 });
module.exports = mongoose.model('EnlaceSocial', enlaceSocialSchema);

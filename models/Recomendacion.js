const mongoose = require('mongoose');

const seleccionRecomendadaSchema = new mongoose.Schema({
  evento: { type: String, required: true, trim: true, maxlength: 140 },
  mercado: { type: String, required: true, trim: true, maxlength: 180 },
  cuota: { type: Number, min: 1, max: 1000 },
  casa: { type: String, trim: true, maxlength: 80 }
}, { _id: false });

const recomendacionSchema = new mongoose.Schema({
  tipo: { type: String, enum: ['pick', 'parlay'], required: true },
  titulo: { type: String, required: true, trim: true, maxlength: 140 },
  descripcion: { type: String, trim: true, maxlength: 3000, default: '' },
  visibilidad: { type: String, enum: ['gratis', 'premium'], default: 'premium' },
  estado_publicacion: { type: String, enum: ['borrador', 'publicada'], default: 'borrador' },
  resultado: {
    type: String,
    enum: ['pendiente', 'acertado', 'fallado', 'anulado'],
    default: 'pendiente'
  },
  destacada: { type: Boolean, default: false },
  selecciones: {
    type: [seleccionRecomendadaSchema],
    validate: {
      validator(selecciones) {
        return this.tipo === 'pick'
          ? selecciones.length === 1
          : selecciones.length >= 2 && selecciones.length <= 20;
      },
      message: 'Un pick requiere una selección y un parlay entre 2 y 20.'
    }
  },
  cuota_total: { type: Number, min: 1, max: 100000 },
  cierra_en: { type: Date, required: true },
  publicada_en: { type: Date, default: null },
  creada_por: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true }
}, { timestamps: { createdAt: 'creada_en', updatedAt: 'actualizada_en' } });

recomendacionSchema.index(
  { estado_publicacion: 1, destacada: -1, cierra_en: -1, publicada_en: -1 },
  { name: 'recomendaciones_publicadas' }
);

module.exports = mongoose.model('Recomendacion', recomendacionSchema);

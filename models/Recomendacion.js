const mongoose = require('mongoose');

const seleccionRecomendadaSchema = new mongoose.Schema({
  partido_api_id: { type: Number, required: true },
  fecha_partido: { type: Date, required: true },
  liga: {
    id: { type: Number, required: true },
    nombre: String
  },
  local: {
    id: { type: Number, required: true },
    nombre: { type: String, required: true }
  },
  visitante: {
    id: { type: Number, required: true },
    nombre: { type: String, required: true }
  },
  evento: { type: String, required: true, trim: true, maxlength: 140 },
  mercado_id: { type: String, required: true, trim: true, maxlength: 120 },
  mercado: { type: String, required: true, trim: true, maxlength: 180 },
  cuota: { type: Number, required: true, min: 1.001, max: 1000 },
  momio_americano: { type: Number, required: true, min: -100000, max: 100000 },
  formato_momio: { type: String, enum: ['decimal', 'americano'], required: true },
  momio_capturado: { type: String, required: true, maxlength: 20 },
  casa: { type: String, trim: true, maxlength: 80 }
}, { _id: false });

const recomendacionSchema = new mongoose.Schema({
  tipo: { type: String, enum: ['pick', 'combinada', 'parlay'], required: true },
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
        if (this.tipo === 'pick') return selecciones.length === 1;
        if (selecciones.length < 2 || selecciones.length > 20) return false;
        return this.tipo !== 'combinada'
          || new Set(selecciones.map(item => item.partido_api_id)).size === 1;
      },
      message: 'Un pick requiere una selección; una combinada o parlay, entre 2 y 20. La combinada debe ser del mismo partido.'
    }
  },
  cuota_total: { type: Number, required: true, min: 1.001, max: 100000 },
  momio_total_americano: { type: Number, required: true, min: -10000000, max: 10000000 },
  formato_momio_total: { type: String, enum: ['decimal', 'americano'], required: true },
  momio_total_capturado: { type: String, required: true, maxlength: 30 },
  cierra_en: { type: Date, required: true },
  publicada_en: { type: Date, default: null },
  creada_por: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true }
}, { timestamps: { createdAt: 'creada_en', updatedAt: 'actualizada_en' } });

recomendacionSchema.index(
  { estado_publicacion: 1, destacada: -1, cierra_en: -1, publicada_en: -1 },
  { name: 'recomendaciones_publicadas' }
);

module.exports = mongoose.model('Recomendacion', recomendacionSchema);

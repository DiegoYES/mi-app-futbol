const mongoose = require('mongoose');

const seleccionSchema = new mongoose.Schema({
  clave: { type: String, required: true },
  partido_api_id: Number,
  liga: {
    id: { type: Number, required: true },
    nombre: String,
    temporada: Number
  },
  fuentes: {
    local: { id: Number, nombre: String, temporada: Number },
    visitante: { id: Number, nombre: String, temporada: Number }
  },
  local: { id: { type: Number, required: true }, nombre: String },
  visitante: { id: { type: Number, required: true }, nombre: String },
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
  fuentes: { type: Number, min: 1, max: 2 },
  evidencia: [String],
  configuracion: {
    local: { condicion: String, limite: Number, periodo: Number },
    visitante: { condicion: String, limite: Number, periodo: Number }
  }
}, { _id: false });

const boletaSchema = new mongoose.Schema({
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  nombre: { type: String, trim: true, maxlength: 100, default: 'Mi boleta' },
  estado: { type: String, enum: ['borrador', 'archivada'], default: 'borrador' },
  selecciones: {
    type: [seleccionSchema],
    validate: {
      validator: selecciones => selecciones.length >= 1 && selecciones.length <= 20,
      message: 'Una boleta debe tener entre 1 y 20 selecciones.'
    }
  }
}, { timestamps: { createdAt: 'creada_en', updatedAt: 'actualizada_en' } });

boletaSchema.index({ usuario: 1, creada_en: -1 }, { name: 'boleta_usuario_fecha' });

module.exports = mongoose.model('Boleta', boletaSchema);

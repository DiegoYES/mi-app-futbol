const mongoose = require('mongoose');

const equipoSchema = new mongoose.Schema({
  api_id: { type: Number, required: true, unique: true },
  nombre: String,
  liga: Number,
  ligas: { type: [Number], default: [] },
  pais: String,
  logo: String,
  fundacion: Number,
  estadio: {
    nombre: String,
    capacidad: Number,
    ciudad: String
  },
  ultima_actualizacion: { type: Date, default: Date.now }
});

equipoSchema.index({ liga: 1, nombre: 1 }, { name: 'liga_nombre' });
equipoSchema.index({ ligas: 1, nombre: 1 }, { name: 'ligas_nombre' });

module.exports = mongoose.model('Equipo', equipoSchema);

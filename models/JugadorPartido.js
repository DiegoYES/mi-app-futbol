const mongoose = require('mongoose');

const jugadorPartidoSchema = new mongoose.Schema({
  partido_api_id: { type: Number, required: true },
  fecha: { type: Date, required: true },
  liga: {
    id: { type: Number, required: true },
    temporada: Number,
    nombre: String
  },
  equipo: { id: Number, nombre: String, local: Boolean },
  jugador: { id: { type: Number, required: true }, nombre: String, foto: String },
  posicion: String,
  numero: Number,
  titular: Boolean,
  capitan: Boolean,
  minutos: Number,
  calificacion: Number,
  tiros: Number,
  tiros_puerta: Number,
  goles: Number,
  asistencias: Number,
  pases: Number,
  pases_clave: Number,
  precision_pases: Number,
  entradas: Number,
  intercepciones: Number,
  duelos: Number,
  duelos_ganados: Number,
  regates: Number,
  regates_exitosos: Number,
  faltas_recibidas: Number,
  faltas_cometidas: Number,
  amarillas: Number,
  rojas: Number,
  atajadas: Number,
  offsides: Number
}, {
  timestamps: { createdAt: 'creado_en', updatedAt: 'actualizado_en' },
  versionKey: false
});

jugadorPartidoSchema.index(
  { partido_api_id: 1, 'jugador.id': 1, 'equipo.id': 1 },
  { unique: true, name: 'partido_jugador_equipo_unico' }
);
jugadorPartidoSchema.index(
  { 'jugador.id': 1, 'liga.id': 1, 'liga.temporada': -1, fecha: -1 },
  { name: 'jugador_liga_temporada_fecha' }
);

module.exports = mongoose.model('JugadorPartido', jugadorPartidoSchema);

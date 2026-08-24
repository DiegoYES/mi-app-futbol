const mongoose = require('mongoose');

// Esquema para un evento individual (gol, tarjeta, córner, etc.)
const eventoSchema = new mongoose.Schema({
  minuto: Number,
  tipo_evento: String,
  detalle: String,
  jugador_id: Number,
  jugador: String,
  asistencia_id: Number,
  asistencia: String
}, { _id: false });

// Esquema para las estadísticas precalculadas de un equipo en un rango de tiempo
const rangoTiempoSchema = new mongoose.Schema({
  rango_minutos: String,
  goles: Number,
  amarillas: Number,
  rojas: Number,
  corners: Number,
  tiros_a_puerta: Number,
  faltas: Number,
  fueras_de_juego: Number
}, { _id: false });

// Esquema de estadísticas de un equipo (completo, 1T, 2T)
const estadisticasSchema = new mongoose.Schema({
  goles: Number,
  tiros_total: Number,
  tiros_puerta: Number,
  corners: Number,
  faltas: Number,
  tarjetas_amarillas: Number,
  tarjetas_rojas: Number,
  offsides: Number
}, { _id: false });

const partidoSchema = new mongoose.Schema({
  api_id: { type: Number, required: true, unique: true },
  fecha: { type: Date, required: true },
  estado: String,
  estado_consultado_en: { type: Date, default: null },
  minuto_juego: Number,
  arbitro: String,
  liga: {
    id: { type: Number, required: true },
    nombre: String,
    pais: String,
    temporada: Number,
    jornada: String
  },
  equipo_local: {
    id: Number,
    nombre: String,
    logo: String,
    goles: Number,
    goles_primer_tiempo: Number,
    posesion: Number,
    tiros_total: Number,
    tiros_puerta: Number,
    corners: Number,
    faltas: Number,
    tarjetas_amarillas: Number,
    tarjetas_rojas: Number,
    offsides: Number,
    formacion: String,
    entrenador: String,
    estadisticas_1t: estadisticasSchema,
    estadisticas_2t: estadisticasSchema,
    eventos: [eventoSchema],
    estadisticas_por_rango: [rangoTiempoSchema]
  },
  equipo_visitante: {
    id: Number,
    nombre: String,
    logo: String,
    goles: Number,
    goles_primer_tiempo: Number,
    posesion: Number,
    tiros_total: Number,
    tiros_puerta: Number,
    corners: Number,
    faltas: Number,
    tarjetas_amarillas: Number,
    tarjetas_rojas: Number,
    offsides: Number,
    formacion: String,
    entrenador: String,
    estadisticas_1t: estadisticasSchema,
    estadisticas_2t: estadisticasSchema,
    eventos: [eventoSchema],
    estadisticas_por_rango: [rangoTiempoSchema]
  },
  total_goles: { type: Number, default: 0 },
  ambos_anotan: { type: Boolean, default: false },
  // `resultado` se decide con el marcador de 90'/120', que es como se liquidan
  // los mercados 1X2. Un partido resuelto en penales sigue siendo 'empate'.
  resultado: String,
  // Goles anotados durante la prórroga y tanda de penales. Quedan en null
  // cuando el partido no llegó a esa fase; no son parte de `total_goles`.
  goles_prorroga: {
    local: { type: Number, default: null },
    visitante: { type: Number, default: null }
  },
  penales: {
    local: { type: Number, default: null },
    visitante: { type: Number, default: null }
  },
  // Quién avanzó tras la tanda: 'local' | 'visitante' | null.
  ganador_penales: { type: String, default: null },
  estadisticas_completas: { type: Boolean, default: false },
  estadisticas_no_disponibles: { type: Boolean, default: false },
  estadisticas_intentos: { type: Number, default: 0 },
  estadisticas_estado: { type: String, default: 'pendiente' },
  estadisticas_ausencia_motivo: { type: String, default: null },
  estadisticas_ultimo_intento_en: { type: Date, default: null },
  tiempos_completos: { type: Boolean, default: false },
  tiempos_consultados_en: { type: Date, default: null },
  tiempos_disponibles: { type: Boolean, default: null },
  eventos_completos: { type: Boolean, default: false },
  jugadores_completos: { type: Boolean, default: false },
  detalle_completo: { type: Boolean, default: false },
  detalle_consultado_en: { type: Date, default: null },
  cobertura_detalle: {
    estadisticas: { type: Boolean, default: false },
    eventos: { type: Boolean, default: false },
    alineaciones: { type: Boolean, default: false },
    jugadores: { type: Boolean, default: false }
  },
  fecha_actualizacion: { type: Date, default: Date.now }
});

// El calendario consulta y ordena siempre por fecha. Sin este índice MongoDB
// debe recorrer todos los partidos, independientemente del tamaño del rango.
partidoSchema.index({ fecha: 1 }, { name: 'fecha' });
partidoSchema.index({ 'liga.id': 1, fecha: 1 }, { name: 'liga_fecha' });
partidoSchema.index(
  { 'liga.id': 1, 'liga.temporada': -1, estado: 1, fecha: -1 },
  { name: 'liga_temporada_estado_fecha' }
);
partidoSchema.index(
  { 'equipo_local.id': 1, 'liga.id': 1, 'liga.temporada': -1, estado: 1, fecha: -1 },
  { name: 'local_liga_temporada_estado_fecha' }
);
partidoSchema.index(
  { 'equipo_visitante.id': 1, 'liga.id': 1, 'liga.temporada': -1, estado: 1, fecha: -1 },
  { name: 'visitante_liga_temporada_estado_fecha' }
);
partidoSchema.index(
  { arbitro: 1, 'liga.id': 1, 'liga.temporada': -1, estado: 1, fecha: -1 },
  { name: 'arbitro_liga_temporada_estado_fecha' }
);

module.exports = mongoose.model('Partido', partidoSchema);

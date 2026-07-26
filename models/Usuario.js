const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const DIAS_PRUEBA = 7;

const usuarioSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254
  },
  password: { type: String, required: true, minlength: 8 },
  nombre: { type: String, trim: true, maxlength: 80 },
  rol: { type: String, enum: ['usuario', 'admin'], default: 'usuario' },
  plan: { type: String, enum: ['prueba', 'premium', 'expirado'], default: 'prueba' },
  fecha_registro: { type: Date, default: Date.now },
  prueba_termina: {
    type: Date,
    default: () => new Date(Date.now() + DIAS_PRUEBA * 24 * 60 * 60 * 1000)
  },
  suscripcion_termina: { type: Date, default: null },
  meses_cortesia: { type: Number, default: 0 },
  ip_registro: { type: String, default: null },
  ip_ultimo_acceso: { type: String, default: null },
  suspendido_hasta: { type: Date, default: null },
  bloqueado_ip_duplicada: { type: Boolean, default: false },
  activo: { type: Boolean, default: true },
  ultimo_acceso: { type: Date, default: null }
});

usuarioSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

usuarioSchema.methods.compararPassword = function (passwordPlano) {
  return bcrypt.compare(passwordPlano, this.password);
};

// Devuelve el estado real de acceso calculado contra la fecha actual
usuarioSchema.methods.estadoAcceso = function () {
  const ahora = new Date();

  if (!this.activo) {
    return { tieneAcceso: false, motivo: 'cuenta_desactivada', plan: this.plan };
  }

  if (this.bloqueado_ip_duplicada) {
    return { tieneAcceso: false, motivo: 'ip_duplicada', plan: this.plan };
  }

  if (this.suspendido_hasta && this.suspendido_hasta > ahora) {
    return { tieneAcceso: false, motivo: 'suspendido', plan: this.plan, suspendido_hasta: this.suspendido_hasta };
  }

  if (this.rol === 'admin') {
    return { tieneAcceso: true, motivo: 'admin', plan: 'premium', diasRestantes: null };
  }

  if (this.suscripcion_termina && this.suscripcion_termina > ahora) {
    return {
      tieneAcceso: true,
      motivo: 'suscripcion_activa',
      plan: 'premium',
      diasRestantes: Math.ceil((this.suscripcion_termina - ahora) / 86400000),
      vence: this.suscripcion_termina
    };
  }

  if (this.prueba_termina && this.prueba_termina > ahora) {
    return {
      tieneAcceso: true,
      motivo: 'prueba_activa',
      plan: 'prueba',
      diasRestantes: Math.ceil((this.prueba_termina - ahora) / 86400000),
      vence: this.prueba_termina
    };
  }

  return { tieneAcceso: false, motivo: 'expirado', plan: 'expirado', diasRestantes: 0 };
};

usuarioSchema.methods.aJSON = function () {
  const estado = this.estadoAcceso();
  return {
    id: this._id,
    email: this.email,
    nombre: this.nombre,
    rol: this.rol,
    plan: estado.plan,
    tieneAcceso: estado.tieneAcceso,
    motivo: estado.motivo,
    diasRestantes: estado.diasRestantes,
    vence: estado.vence || null,
    fecha_registro: this.fecha_registro,
    ip_registro: this.ip_registro,
    ip_ultimo_acceso: this.ip_ultimo_acceso,
    suspendido_hasta: this.suspendido_hasta || null,
    bloqueado_ip_duplicada: this.bloqueado_ip_duplicada || false
  };
};

module.exports = mongoose.model('Usuario', usuarioSchema);
module.exports.DIAS_PRUEBA = DIAS_PRUEBA;

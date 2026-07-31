const os = require('os');
const crypto = require('crypto');
const BloqueoTrabajo = require('../models/BloqueoTrabajo');

function esClaveDuplicada(error) {
  return error?.code === 11000 || error?.code === 11001;
}

function crearBloqueoTrabajo({
  modelo = BloqueoTrabajo,
  propietario = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`,
  leaseMs = Number.parseInt(process.env.SYNC_LOCK_LEASE_MS, 10) || 120_000
} = {}) {
  const duracion = Math.min(Math.max(leaseMs, 30_000), 30 * 60_000);

  async function adquirir(nombre, ahora = new Date()) {
    const expira = new Date(ahora.getTime() + duracion);
    try {
      const documento = await modelo.findOneAndUpdate({
        nombre,
        $or: [
          { expira_en: { $lte: ahora } },
          { propietario }
        ]
      }, {
        $setOnInsert: { nombre },
        $set: {
          propietario,
          adquirido_en: ahora,
          renovado_en: ahora,
          expira_en: expira
        }
      }, {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true,
        lean: true
      });
      return documento ? { adquirido: true, propietario, expira_en: expira } : { adquirido: false };
    } catch (error) {
      if (esClaveDuplicada(error)) return { adquirido: false };
      throw error;
    }
  }

  async function renovar(nombre, ahora = new Date()) {
    const expira = new Date(ahora.getTime() + duracion);
    const resultado = await modelo.updateOne(
      { nombre, propietario, expira_en: { $gt: ahora } },
      { $set: { renovado_en: ahora, expira_en: expira } }
    );
    return resultado.modifiedCount === 1;
  }

  async function liberar(nombre, ahora = new Date()) {
    const resultado = await modelo.updateOne(
      { nombre, propietario },
      { $set: { propietario: null, renovado_en: ahora, expira_en: ahora } }
    );
    return resultado.modifiedCount === 1;
  }

  return { adquirir, renovar, liberar, propietario, leaseMs: duracion };
}

module.exports = { crearBloqueoTrabajo };

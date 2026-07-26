const express = require('express');
const Usuario = require('../models/Usuario');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { crearControlCuota } = require('../services/apiQuota');

const router = express.Router();

router.use(requireAuth, requireAdmin);

// Listado de usuarios con búsqueda y paginación
router.get('/usuarios', async (req, res) => {
  try {
    const pagina = Math.max(parseInt(req.query.pagina) || 1, 1);
    const porPagina = Math.min(parseInt(req.query.limite) || 50, 200);
    const busqueda = (req.query.q || '').trim();

    const filtro = busqueda
      ? { $or: [
          { email: { $regex: busqueda, $options: 'i' } },
          { nombre: { $regex: busqueda, $options: 'i' } }
        ] }
      : {};

    const [usuarios, total] = await Promise.all([
      Usuario.find(filtro).sort({ fecha_registro: -1 }).skip((pagina - 1) * porPagina).limit(porPagina),
      Usuario.countDocuments(filtro)
    ]);

    res.json({
      total,
      pagina,
      porPagina,
      usuarios: usuarios.map(u => ({
        ...u.aJSON(),
        activo: u.activo,
        ultimo_acceso: u.ultimo_acceso,
        prueba_termina: u.prueba_termina,
        suscripcion_termina: u.suscripcion_termina
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resumen para el panel
router.get('/resumen', async (req, res) => {
  try {
    const ahora = new Date();
    const [total, premium, enPrueba, totalCortesia, cuotaApi] = await Promise.all([
      Usuario.countDocuments({}),
      Usuario.countDocuments({ suscripcion_termina: { $gt: ahora } }),
      Usuario.countDocuments({
        prueba_termina: { $gt: ahora },
        $or: [{ suscripcion_termina: null }, { suscripcion_termina: { $lte: ahora } }]
      }),
      Usuario.aggregate([{ $group: { _id: null, total: { $sum: '$meses_cortesia' } } }]),
      crearControlCuota().consultar()
    ]);

    const mesesCortesia = totalCortesia[0]?.total || 0;
    res.json({ total, premium, enPrueba, expirados: total - premium - enPrueba, mesesCortesia, cuotaApi });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Activar o extender suscripción: suma meses desde hoy o desde el vencimiento actual
router.post('/usuarios/:id/suscripcion', async (req, res) => {
  try {
    const meses = parseInt(req.body.meses);
    if (!Number.isInteger(meses) || meses < 1 || meses > 24) {
      return res.status(400).json({ error: 'Los meses deben ser un entero entre 1 y 24' });
    }

    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const ahora = new Date();
    const base = usuario.suscripcion_termina && usuario.suscripcion_termina > ahora
      ? new Date(usuario.suscripcion_termina)
      : ahora;

    base.setMonth(base.getMonth() + meses);
    usuario.suscripcion_termina = base;
    usuario.plan = 'premium';
    await usuario.save();

    res.json({ mensaje: `Suscripción extendida ${meses} mes(es)`, usuario: usuario.aJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cortesía: extiende 1 mes sin contar como ingreso
router.post('/usuarios/:id/cortesia', async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const ahora = new Date();
    const base = usuario.suscripcion_termina && usuario.suscripcion_termina > ahora
      ? new Date(usuario.suscripcion_termina)
      : ahora;

    base.setMonth(base.getMonth() + 1);
    usuario.suscripcion_termina = base;
    usuario.plan = 'premium';
    usuario.meses_cortesia = (usuario.meses_cortesia || 0) + 1;
    await usuario.save();

    res.json({ mensaje: 'Cortesía de 1 mes aplicada', usuario: usuario.aJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


router.delete('/usuarios/:id/suscripcion', async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    usuario.suscripcion_termina = null;
    usuario.plan = usuario.estadoAcceso().plan;
    await usuario.save();

    res.json({ mensaje: 'Suscripción cancelada', usuario: usuario.aJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// IPs con más de una cuenta de usuario (posibles abusos)
router.get('/ips-duplicadas', async (req, res) => {
  try {
    const duplicadas = await Usuario.aggregate([
      { $match: { ip_registro: { $ne: null }, rol: 'usuario' } },
      { $group: {
        _id: '$ip_registro',
        cuentas: { $sum: 1 },
        usuarios: { $push: { id: '$_id', email: '$email', nombre: '$nombre', plan: '$plan', bloqueado: '$bloqueado_ip_duplicada' } }
      }},
      { $match: { cuentas: { $gte: 2 } } },
      { $sort: { cuentas: -1 } }
    ]);
    res.json({ duplicadas });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Suspensión temporal
router.post('/usuarios/:id/suspender', async (req, res) => {
  try {
    const dias = parseInt(req.body.dias);
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
      return res.status(400).json({ error: 'Los días deben ser un entero entre 1 y 365' });
    }
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (usuario._id.equals(req.usuario._id)) {
      return res.status(400).json({ error: 'No puedes suspenderte a ti mismo' });
    }
    const hasta = new Date();
    hasta.setDate(hasta.getDate() + dias);
    usuario.suspendido_hasta = hasta;
    await usuario.save();
    res.json({ mensaje: `Cuenta suspendida por ${dias} día(s)`, usuario: usuario.aJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Levantar suspensión temporal
router.delete('/usuarios/:id/suspension', async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    usuario.suspendido_hasta = null;
    await usuario.save();
    res.json({ mensaje: 'Suspensión levantada', usuario: usuario.aJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Desbloquear cuenta bloqueada por IP duplicada (cuando el usuario paga)
router.delete('/usuarios/:id/bloqueo-ip', async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    usuario.bloqueado_ip_duplicada = false;
    await usuario.save();
    res.json({ mensaje: 'Bloqueo por IP eliminado', usuario: usuario.aJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Activar o desactivar una cuenta
router.patch('/usuarios/:id/activo', async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (usuario._id.equals(req.usuario._id)) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    }
    usuario.activo = Boolean(req.body.activo);
    await usuario.save();
    res.json({ mensaje: usuario.activo ? 'Cuenta activada' : 'Cuenta desactivada', usuario: usuario.aJSON() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

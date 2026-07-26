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
    const [total, premium, enPrueba, cuotaApi] = await Promise.all([
      Usuario.countDocuments({}),
      Usuario.countDocuments({ suscripcion_termina: { $gt: ahora } }),
      Usuario.countDocuments({
        prueba_termina: { $gt: ahora },
        $or: [{ suscripcion_termina: null }, { suscripcion_termina: { $lte: ahora } }]
      }),
      crearControlCuota().consultar()
    ]);

    res.json({ total, premium, enPrueba, expirados: total - premium - enPrueba, cuotaApi });
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

// Cancelar suscripción (no borra la cuenta)
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

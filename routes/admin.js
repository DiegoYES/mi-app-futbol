const express = require('express');
const Usuario = require('../models/Usuario');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { errorServidor, escaparRegex, textoDeConsulta } = require('../middleware/security');
const { crearControlCuota } = require('../services/apiQuota');
const MercadoCasa = require('../models/MercadoCasa');
const ActualizacionMercados = require('../models/ActualizacionMercados');
const Sugerencia = require('../models/Sugerencia');
const { refrescarMercados } = require('../services/betting/marketCollectionService');
const { controlTraficoApi } = require('../services/apiTrafficControl');
const { obtenerApiKeys } = require('../services/apiQuota');
const { obtenerEstadisticasCache } = require('../middleware/cache');
const mongoose = require('mongoose');
const { obtenerMetricasHttp } = require('../middleware/observability');

const router = express.Router();

router.use(requireAuth, requireAdmin);

// Listado de usuarios con búsqueda y paginación
router.get('/usuarios', async (req, res) => {
  try {
    const pagina = Math.max(parseInt(req.query.pagina) || 1, 1);
    const porPagina = Math.min(parseInt(req.query.limite) || 50, 200);
    const busqueda = textoDeConsulta(req.query.q, 80);

    const patron = escaparRegex(busqueda);
    const filtro = busqueda
      ? { $or: [
          { email: { $regex: patron, $options: 'i' } },
          { nombre: { $regex: patron, $options: 'i' } }
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
    errorServidor(res, error);
  }
});

// Resumen para el panel
router.get('/resumen', async (req, res) => {
  try {
    const ahora = new Date();
    const [total, premium, enPrueba, totalCortesia, cuotaApi, ticketsAbiertos] = await Promise.all([
      Usuario.countDocuments({}),
      Usuario.countDocuments({ suscripcion_termina: { $gt: ahora } }),
      Usuario.countDocuments({
        prueba_termina: { $gt: ahora },
        $or: [{ suscripcion_termina: null }, { suscripcion_termina: { $lte: ahora } }]
      }),
      Usuario.aggregate([{ $group: { _id: null, total: { $sum: '$meses_cortesia' } } }]),
      crearControlCuota().consultar(),
      Sugerencia.countDocuments({ estado: { $in: ['nueva', 'en_revision', 'planeada'] } })
    ]);

    const mesesCortesia = totalCortesia[0]?.total || 0;
    res.json({ total, premium, enPrueba, expirados: total - premium - enPrueba, mesesCortesia, cuotaApi, ticketsAbiertos });
  } catch (error) {
    errorServidor(res, error);
  }
});

const ESTADOS_TICKET = new Set(['nueva', 'en_revision', 'planeada', 'resuelta', 'descartada']);
const TIPOS_TICKET = new Set(['idea', 'mejora', 'error', 'otro']);
const PRIORIDADES_TICKET = new Set(['baja', 'media', 'alta', 'urgente']);

router.get('/sugerencias', async (req, res) => {
  try {
    const pagina = Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1);
    const limite = Math.min(Math.max(Number.parseInt(req.query.limite, 10) || 50, 1), 100);
    const filtro = {};
    if (ESTADOS_TICKET.has(req.query.estado)) filtro.estado = req.query.estado;
    if (TIPOS_TICKET.has(req.query.tipo)) filtro.tipo = req.query.tipo;

    const [tickets, total] = await Promise.all([
      Sugerencia.find(filtro)
        .populate('usuario', 'nombre email')
        .sort({ creada_en: -1 })
        .skip((pagina - 1) * limite)
        .limit(limite)
        .lean(),
      Sugerencia.countDocuments(filtro)
    ]);
    res.json({ tickets, total, pagina, limite });
  } catch {
    res.status(500).json({ error: 'No se pudieron consultar los tickets.' });
  }
});

router.patch('/sugerencias/:id', async (req, res) => {
  try {
    const estado = req.body?.estado;
    const prioridad = req.body?.prioridad;
    const respuesta = typeof req.body?.respuesta_admin === 'string'
      ? req.body.respuesta_admin.trim()
      : undefined;
    const cambios = {};

    if (estado !== undefined) {
      if (!ESTADOS_TICKET.has(estado)) return res.status(400).json({ error: 'Estado no válido.' });
      cambios.estado = estado;
    }
    if (prioridad !== undefined) {
      if (!PRIORIDADES_TICKET.has(prioridad)) return res.status(400).json({ error: 'Prioridad no válida.' });
      cambios.prioridad = prioridad;
    }
    if (respuesta !== undefined) {
      if (respuesta.length > 2000) return res.status(400).json({ error: 'La respuesta no puede superar 2000 caracteres.' });
      cambios.respuesta_admin = respuesta;
      cambios.respondida_por = respuesta ? req.usuario._id : null;
      cambios.respondida_en = respuesta ? new Date() : null;
    }
    if (!Object.keys(cambios).length) {
      return res.status(400).json({ error: 'No hay cambios válidos.' });
    }

    const ticket = await Sugerencia.findByIdAndUpdate(req.params.id, { $set: cambios }, {
      new: true,
      runValidators: true
    }).populate('usuario', 'nombre email');
    if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });
    res.json({ mensaje: 'Ticket actualizado.', ticket });
  } catch (error) {
    if (error.name === 'CastError') return res.status(404).json({ error: 'Ticket no encontrado.' });
    res.status(500).json({ error: 'No se pudo actualizar el ticket.' });
  }
});

// Estado operativo sin valores secretos. Útil para alertas y diagnóstico.
router.get('/produccion/estado', async (_req, res) => {
  try {
    const cuotaApi = await crearControlCuota().consultar();
    res.json({
      estado: 'ok',
      proceso: {
        uptime_segundos: Math.floor(process.uptime()),
        memoria_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        entorno: process.env.NODE_ENV || 'development'
      },
      mongodb: mongoose.connection.readyState === 1 ? 'ok' : 'no_disponible',
      api_football: {
        configurada: obtenerApiKeys().length > 0,
        claves_configuradas: obtenerApiKeys().length,
        cuota_diaria: cuotaApi,
        trafico: controlTraficoApi.estado()
      },
      cache: obtenerEstadisticasCache(),
      http: obtenerMetricasHttp()
    });
  } catch (error) {
    res.status(503).json({ estado: 'degradado', error: 'No se pudo consultar el estado operativo.' });
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
    errorServidor(res, error);
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
    errorServidor(res, error);
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
    errorServidor(res, error);
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
    errorServidor(res, error);
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
    errorServidor(res, error);
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
    errorServidor(res, error);
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
    errorServidor(res, error);
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
    errorServidor(res, error);
  }
});

// Diagnóstico y actualización de mercados. Ambas rutas heredan autenticación admin.
router.post('/mercados/actualizar', async (_req, res) => {
  try {
    const resultado = await refrescarMercados();
    res.status(resultado.selecciones_guardadas ? 200 : 422).json({ resultado });
  } catch (error) {
    errorServidor(res, error, "No se pudo contactar al proveedor de mercados.");
  }
});

router.get('/mercados/diagnostico', async (_req, res) => {
  try {
    const ahora = new Date();
    const [ultima, vigentes, categorias, estados, problemas] = await Promise.all([
      ActualizacionMercados.findOne({ proveedor: 'playdoit' }).sort({ iniciada_en: -1 }).lean(),
      MercadoCasa.countDocuments({ proveedor: 'playdoit', expira_en: { $gt: ahora } }),
      MercadoCasa.aggregate([{ $match: { proveedor: 'playdoit', expira_en: { $gt: ahora } } }, { $group: { _id: '$categoria', total: { $sum: 1 } } }, { $sort: { total: -1 } }]),
      MercadoCasa.aggregate([{ $match: { proveedor: 'playdoit', expira_en: { $gt: ahora } } }, { $group: { _id: '$estado', total: { $sum: 1 } } }, { $sort: { total: -1 } }]),
      MercadoCasa.aggregate([{ $match: { proveedor: 'playdoit', problemas: { $ne: [] } } }, { $unwind: '$problemas' }, { $group: { _id: '$problemas', total: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 20 }])
    ]);
    res.json({ ultima_actualizacion: ultima, selecciones_vigentes: vigentes, categorias, estados, problemas_normalizacion: problemas });
  } catch (error) {
    errorServidor(res, error);
  }
});

router.get('/mercados', async (req, res) => {
  try {
    const limite = Math.min(Math.max(Number.parseInt(req.query.limite, 10) || 100, 1), 500);
    const pagina = Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1);
    const filtro = { proveedor: 'playdoit' };
    if (req.query.vigentes !== 'false') filtro.expira_en = { $gt: new Date() };
    const categoria = textoDeConsulta(req.query.categoria, 60);
    if (categoria) filtro.categoria = categoria;
    const [selecciones, total] = await Promise.all([
      MercadoCasa.find(filtro).sort({ recolectado_en: -1 }).skip((pagina - 1) * limite).limit(limite).lean(),
      MercadoCasa.countDocuments(filtro)
    ]);
    res.json({ total, pagina, limite, selecciones });
  } catch (error) {
    errorServidor(res, error);
  }
});

module.exports = router;

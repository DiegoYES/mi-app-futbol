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
const Recomendacion = require('../models/Recomendacion');
const Boleta = require('../models/Boleta');
const { normalizarRecomendacion, normalizarMomio } = require('../services/recomendaciones');
const Partido = require('../models/partido');
const { obtenerMercado } = require('../services/marketCatalog');
const { analizarPartido } = require('./picks');
const EnlaceSocial = require('../models/EnlaceSocial');
const { ICONOS_SOCIALES, normalizarEnlaceSocial } = require('../services/socialLinks');
const { obtenerCalidadDatos } = require('../services/dataQuality');
const { evaluarAlertas } = require('../services/operationalAlerts');
const { reintentarEstadisticasPendientes, revalidarPartidoPorId, revalidarPendientesLiga } = require('../services/fixtureRevalidation');

const router = express.Router();

router.use(requireAuth, requireAdmin);

function validarIdMongo(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Identificador no válido.', codigo: 'ID_INVALIDO' });
  }
  next();
}

router.get('/calidad-datos', async (_req, res) => {
  try {
    const calidad = await obtenerCalidadDatos();
    res.set('Cache-Control', 'no-store');
    res.json({ ...calidad, alertas: evaluarAlertas(calidad, obtenerMetricasHttp()) });
  } catch (error) { errorServidor(res, error); }
});

router.post('/calidad-datos/revalidar/:apiId', async (req, res) => {
  try {
    const apiId = Number.parseInt(req.params.apiId, 10);
    if (!Number.isInteger(apiId) || apiId <= 0) return res.status(400).json({ error: 'ID de partido inválido.' });
    if (req.body?.confirmacion !== 'REVALIDAR') return res.status(400).json({ error: 'Escribe REVALIDAR para confirmar una consulta al proveedor.' });
    const resultado = await revalidarPartidoPorId(apiId);
    if (!resultado.encontrado) return res.status(404).json({ error: 'Partido no encontrado.' });
    res.json({ mensaje: 'Partido revalidado.', resultado });
  } catch (error) { errorServidor(res, error); }
});

router.post('/calidad-datos/revalidar-liga/:ligaId', async (req, res) => {
  try {
    const ligaId = Number.parseInt(req.params.ligaId, 10);
    const temporada = Number.parseInt(req.body?.temporada, 10);
    if (!Number.isInteger(ligaId) || ligaId <= 0 || !Number.isInteger(temporada)) return res.status(400).json({ error: 'Liga o temporada inválida.' });
    if (req.body?.confirmacion !== 'REVALIDAR LIGA') return res.status(400).json({ error: 'Escribe REVALIDAR LIGA para confirmar hasta 10 consultas.' });
    const resultado = await revalidarPendientesLiga(ligaId, temporada);
    res.json({ mensaje: `${resultado.consultados} partido(s) revalidados.`, resultado });
  } catch (error) { errorServidor(res, error); }
});

router.post('/calidad-datos/reintentar-estadisticas', async (req, res) => {
  try {
    if (req.body?.confirmacion !== 'REINTENTAR 10') return res.status(400).json({ error: 'Escribe REINTENTAR 10 para confirmar hasta 10 consultas.' });
    const resultado = await reintentarEstadisticasPendientes();
    res.json({ mensaje: `${resultado.consultados} partido(s) consultados para completar estadísticas.`, resultado });
  } catch (error) { errorServidor(res, error); }
});

router.get('/redes-sociales', async (_req, res) => {
  try {
    const enlaces = await EnlaceSocial.find({}).sort({ orden: 1, creado_en: 1 }).lean();
    res.json({ enlaces, iconos: ICONOS_SOCIALES });
  } catch (error) { errorServidor(res, error); }
});

router.post('/redes-sociales', async (req, res) => {
  try {
    const normalizado = normalizarEnlaceSocial(req.body);
    if (normalizado.error) return res.status(400).json({ error: normalizado.error });
    const enlace = await EnlaceSocial.create(normalizado.datos);
    res.status(201).json({ mensaje: 'Enlace social creado.', enlace });
  } catch (error) { errorServidor(res, error); }
});

router.patch('/redes-sociales/:id', validarIdMongo, async (req, res) => {
  try {
    const normalizado = normalizarEnlaceSocial(req.body);
    if (normalizado.error) return res.status(400).json({ error: normalizado.error });
    const enlace = await EnlaceSocial.findByIdAndUpdate(req.params.id, { $set: normalizado.datos }, { new: true, runValidators: true });
    if (!enlace) return res.status(404).json({ error: 'Enlace no encontrado.' });
    res.json({ mensaje: 'Enlace actualizado.', enlace });
  } catch (error) {
    if (error.name === 'CastError') return res.status(404).json({ error: 'Enlace no encontrado.' });
    errorServidor(res, error);
  }
});

router.delete('/redes-sociales/:id', validarIdMongo, async (req, res) => {
  try {
    const enlace = await EnlaceSocial.findByIdAndDelete(req.params.id);
    if (!enlace) return res.status(404).json({ error: 'Enlace no encontrado.' });
    res.json({ mensaje: 'Enlace eliminado.' });
  } catch (error) {
    if (error.name === 'CastError') return res.status(404).json({ error: 'Enlace no encontrado.' });
    errorServidor(res, error);
  }
});

async function esAdministradorPrincipal(usuario) {
  const primerAdmin = await Usuario.findOne({ rol: 'admin' })
    .sort({ fecha_registro: 1, _id: 1 }).select('_id').lean();
  return Boolean(primerAdmin && String(primerAdmin._id) === String(usuario._id));
}

const CAMPOS_PARTIDO_RECOMENDACION = [
  'api_id', 'fecha', 'estado',
  'liga.id', 'liga.nombre',
  'equipo_local.id', 'equipo_local.nombre',
  'equipo_visitante.id', 'equipo_visitante.nombre'
].join(' ');

router.get('/recomendaciones/partidos', async (req, res) => {
  try {
    const ahora = new Date();
    const hasta = new Date(req.query.hasta);
    const maximo = new Date(ahora.getTime() + 31 * 86400000);
    if (Number.isNaN(hasta.getTime()) || hasta <= ahora || hasta > maximo) {
      return res.status(400).json({ error: 'El límite debe estar entre ahora y los próximos 31 días.' });
    }
    const partidos = await Partido.find({
      fecha: { $gte: ahora, $lte: hasta },
      estado: { $nin: ['FT', 'AET', 'PEN'] }
    }).select(CAMPOS_PARTIDO_RECOMENDACION).sort({ fecha: 1 }).lean();
    res.json({ desde: ahora, hasta, partidos: partidos.map(partido => ({
      api_id: partido.api_id,
      fecha: partido.fecha,
      liga: partido.liga,
      local: partido.equipo_local,
      visitante: partido.equipo_visitante
    })) });
  } catch (error) {
    errorServidor(res, error);
  }
});

router.get('/recomendaciones/partidos/:id/mercados', async (req, res) => {
  try {
    const partidoId = Number.parseInt(req.params.id, 10);
    const periodo = Number.parseInt(req.query.periodo ?? '0', 10);
    if (!Number.isInteger(partidoId)) return res.status(400).json({ error: 'Partido inválido.' });
    if (![0, 1, 2].includes(periodo)) return res.status(400).json({ error: 'El período debe ser partido completo, primer tiempo o segundo tiempo.' });
    const partido = await Partido.findOne({ api_id: partidoId });
    if (!partido) return res.status(404).json({ error: 'Partido no encontrado.' });
    const analisis = await analizarPartido(partido.toObject(), 10, periodo);
    res.json({ periodo, mercados: analisis.mercados.map(mercado => ({
      id: mercado.id,
      nombre: mercado.mercado,
      categoria: mercado.categoria,
      alcance: mercado.alcance,
      tipo: mercado.tipo,
      linea: mercado.linea,
      estimacion: mercado.estimacion,
      confianza: mercado.confianza,
      muestra: mercado.muestra
    })) });
  } catch (error) {
    errorServidor(res, error);
  }
});

async function enriquecerRecomendacion(datos) {
  const ids = [...new Set(datos.selecciones.map(item => item.partido_api_id))];
  const partidos = await Partido.find({ api_id: { $in: ids } })
    .select(CAMPOS_PARTIDO_RECOMENDACION).lean();
  const porId = new Map(partidos.map(partido => [partido.api_id, partido]));
  const selecciones = [];

  for (const seleccion of datos.selecciones) {
    const partido = porId.get(seleccion.partido_api_id);
    if (!partido) return { error: 'Uno de los partidos seleccionados ya no está disponible.' };
    if (partido.fecha > datos.cierra_en) {
      return { error: 'Todos los partidos deben comenzar antes de la fecha límite.' };
    }
    const periodo = [1, 2].includes(seleccion.periodo) ? seleccion.periodo : 0;
    const mercado = obtenerMercado(seleccion.mercado_id);
    if (!mercado) return { error: 'Uno de los mercados seleccionados no es válido.' };
    selecciones.push({
      ...seleccion,
      fecha_partido: partido.fecha,
      liga: { id: partido.liga.id, nombre: partido.liga.nombre },
      local: { id: partido.equipo_local.id, nombre: partido.equipo_local.nombre },
      visitante: { id: partido.equipo_visitante.id, nombre: partido.equipo_visitante.nombre },
      evento: `${partido.equipo_local.nombre} vs ${partido.equipo_visitante.nombre}`,
      periodo,
      mercado: mercado.nombre + (periodo ? ` · ${periodo}T` : ``)
    });
  }
  return { datos: { ...datos, selecciones } };
}

router.get('/recomendaciones', async (_req, res) => {
  try {
    const recomendaciones = await Recomendacion.find({})
      .sort({ destacada: -1, creada_en: -1 })
      .limit(200)
      .lean();
    res.json({ recomendaciones });
  } catch (error) {
    errorServidor(res, error);
  }
});

router.post('/recomendaciones', async (req, res) => {
  try {
    const normalizada = normalizarRecomendacion(req.body);
    if (normalizada.error) return res.status(400).json({ error: normalizada.error });
    const enriquecida = await enriquecerRecomendacion(normalizada.datos);
    if (enriquecida.error) return res.status(400).json({ error: enriquecida.error });
    const datos = enriquecida.datos;
    const recomendacion = await Recomendacion.create({
      ...datos,
      creada_por: req.usuario._id,
      publicada_en: datos.estado_publicacion === 'publicada' ? new Date() : null
    });
    res.status(201).json({ mensaje: 'Recomendación creada.', recomendacion });
  } catch (error) {
    if (error.name === 'ValidationError') return res.status(400).json({ error: 'Revisa los datos de la recomendación.' });
    errorServidor(res, error);
  }
});

router.post('/recomendaciones/desde-boleta/:id', validarIdMongo, async (req, res) => {
  try {
    const boleta = await Boleta.findById(req.params.id).lean();
    if (!boleta) return res.status(404).json({ error: 'Boleta no encontrada.' });
    if (!boleta.selecciones || !boleta.selecciones.length) {
      return res.status(400).json({ error: 'La boleta no contiene selecciones.' });
    }
    if (boleta.selecciones.length > 20) {
      return res.status(400).json({ error: 'Una recomendación no puede exceder 20 selecciones.' });
    }

    const ahora = new Date();
    const seleccionesEnriquecidas = [];
    let fechaMinima = null;

    for (const sel of boleta.selecciones) {
      let partido = null;
      if (sel.partido_api_id) {
        partido = await Partido.findOne({ api_id: sel.partido_api_id }).lean();
      }
      if (!partido && sel.local?.id && sel.visitante?.id) {
        partido = await Partido.findOne({
          'equipo_local.id': sel.local.id,
          'equipo_visitante.id': sel.visitante.id,
          fecha: { $gte: new Date(ahora.getTime() - 4 * 3600000) }
        }).sort({ fecha: 1 }).lean();
      }

      const fechaPartido = partido?.fecha || new Date(ahora.getTime() + 24 * 3600000);
      if (!fechaMinima || fechaPartido < fechaMinima) {
        fechaMinima = fechaPartido;
      }

      const partidoApiId = partido?.api_id || sel.partido_api_id || (sel.local.id * 10000 + sel.visitante.id);
      const periodo = sel.configuracion?.local?.periodo || sel.mercado?.periodo || 0;
      const estimacion = Math.min(Math.max(Number(sel.estimacion) || 50, 5), 98);
      const cuotaCalculada = Number((100 / estimacion).toFixed(2));
      const momioObj = normalizarMomio(cuotaCalculada, 'decimal');

      const mercadoCatalogo = obtenerMercado(sel.mercado?.base_id || sel.mercado?.id);
      const nombreMercado = (mercadoCatalogo?.nombre || sel.mercado?.nombre || 'Mercado') + (periodo ? ` · ${periodo}T` : '');

      seleccionesEnriquecidas.push({
        partido_api_id: partidoApiId,
        fecha_partido: fechaPartido,
        liga: {
          id: partido?.liga?.id || sel.liga?.id || 1,
          nombre: partido?.liga?.nombre || sel.liga?.nombre || 'Competición'
        },
        local: {
          id: sel.local.id,
          nombre: partido?.equipo_local?.nombre || sel.local.nombre || 'Local'
        },
        visitante: {
          id: sel.visitante.id,
          nombre: partido?.equipo_visitante?.nombre || sel.visitante.nombre || 'Visitante'
        },
        evento: `${partido?.equipo_local?.nombre || sel.local.nombre} vs ${partido?.equipo_visitante?.nombre || sel.visitante.nombre}`,
        mercado_id: sel.mercado.id,
        mercado: nombreMercado,
        periodo,
        cuota: momioObj.cuota,
        momio_americano: momioObj.americano,
        formato_momio: momioObj.formato,
        momio_capturado: momioObj.capturado,
        casa: req.body?.casa ? String(req.body.casa).trim().slice(0, 80) : ''
      });
    }

    const n = seleccionesEnriquecidas.length;
    const esMismoPartido = new Set(seleccionesEnriquecidas.map(s => s.partido_api_id)).size === 1;
    const tipo = n === 1 ? 'pick' : (esMismoPartido ? 'combinada' : 'parlay');

    const titulo = (typeof req.body?.titulo === 'string' && req.body.titulo.trim())
      ? req.body.titulo.trim().slice(0, 140)
      : (boleta.nombre || `Pick del Día ${ahora.toLocaleDateString('es-MX')}`).slice(0, 140);

    const visibilidad = ['gratis', 'premium'].includes(req.body?.visibilidad) ? req.body.visibilidad : 'premium';
    const estadoPublicacion = ['borrador', 'publicada'].includes(req.body?.estado_publicacion) ? req.body.estado_publicacion : 'publicada';
    const descripcion = typeof req.body?.descripcion === 'string' ? req.body.descripcion.trim().slice(0, 3000) : '';
    const destacada = Boolean(req.body?.destacada);

    const cierraEn = (req.body?.cierra_en && !Number.isNaN(new Date(req.body.cierra_en).getTime()))
      ? new Date(req.body.cierra_en)
      : (fechaMinima && fechaMinima > ahora ? fechaMinima : new Date(ahora.getTime() + 24 * 3600000));

    const cuotaTotalCalculada = seleccionesEnriquecidas.reduce((acc, item) => acc * (item.cuota || 1), 1);
    const formatoMomioTotal = ['decimal', 'americano'].includes(req.body?.formato_momio_total) ? req.body.formato_momio_total : 'decimal';
    const momioTotal = normalizarMomio(
      req.body?.momio_total ? req.body.momio_total : cuotaTotalCalculada.toFixed(2),
      formatoMomioTotal
    ) || normalizarMomio(cuotaTotalCalculada.toFixed(2), 'decimal');

    const recomendacion = await Recomendacion.create({
      tipo,
      titulo,
      descripcion,
      visibilidad,
      estado_publicacion: estadoPublicacion,
      resultado: 'pendiente',
      destacada,
      selecciones: seleccionesEnriquecidas,
      cuota_total: momioTotal.cuota,
      momio_total_americano: momioTotal.americano,
      formato_momio_total: momioTotal.formato,
      momio_total_capturado: momioTotal.capturado,
      cierra_en: cierraEn,
      publicada_en: estadoPublicacion === 'publicada' ? new Date() : null,
      creada_por: req.usuario._id
    });

    res.status(201).json({
      mensaje: 'Recomendación creada a partir de la boleta.',
      recomendacion
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Revisa los datos de la recomendación.' });
    }
    errorServidor(res, error);
  }
});

router.patch('/recomendaciones/:id', validarIdMongo, async (req, res) => {
  try {
    const normalizada = normalizarRecomendacion(req.body);
    if (normalizada.error) return res.status(400).json({ error: normalizada.error });
    const enriquecida = await enriquecerRecomendacion(normalizada.datos);
    if (enriquecida.error) return res.status(400).json({ error: enriquecida.error });
    const actual = await Recomendacion.findById(req.params.id);
    if (!actual) return res.status(404).json({ error: 'Recomendación no encontrada.' });
    const antesPublicada = actual.estado_publicacion === 'publicada';
    Object.assign(actual, enriquecida.datos);
    if (!antesPublicada && actual.estado_publicacion === 'publicada') actual.publicada_en = new Date();
    if (actual.estado_publicacion === 'borrador') actual.publicada_en = null;
    await actual.save();
    res.json({ mensaje: 'Recomendación actualizada.', recomendacion: actual });
  } catch (error) {
    if (error.name === 'CastError') return res.status(404).json({ error: 'Recomendación no encontrada.' });
    if (error.name === 'ValidationError') return res.status(400).json({ error: 'Revisa los datos de la recomendación.' });
    errorServidor(res, error);
  }
});

router.delete('/recomendaciones/:id', validarIdMongo, async (req, res) => {
  try {
    const eliminada = await Recomendacion.findByIdAndDelete(req.params.id);
    if (!eliminada) return res.status(404).json({ error: 'Recomendación no encontrada.' });
    res.json({ mensaje: 'Recomendación eliminada.' });
  } catch (error) {
    if (error.name === 'CastError') return res.status(404).json({ error: 'Recomendación no encontrada.' });
    errorServidor(res, error);
  }
});

// Listado de usuarios con búsqueda y paginación
router.get('/usuarios', async (req, res) => {
  try {
    const pagina = Math.max(parseInt(req.query.pagina) || 1, 1);
    const porPagina = Math.min(parseInt(req.query.limite) || 50, 200);
    const busqueda = textoDeConsulta(req.query.q, 80);
    const estado = textoDeConsulta(req.query.estado, 30);
    const estadosPermitidos = new Set(['premium', 'prueba', 'expirado', 'suspendido', 'desactivado', 'bloqueado_ip', 'admin']);
    const ahora = new Date();

    const patron = escaparRegex(busqueda);
    const condiciones = [];
    if (busqueda) condiciones.push({ $or: [
      { email: { $regex: patron, $options: 'i' } },
      { nombre: { $regex: patron, $options: 'i' } }
    ] });
    if (estadosPermitidos.has(estado)) {
      const disponible = { activo: { $ne: false }, suspendido_hasta: { $not: { $gt: ahora } } };
      const sinSuscripcion = { $or: [{ suscripcion_termina: null }, { suscripcion_termina: { $exists: false } }, { suscripcion_termina: { $lte: ahora } }] };
      const porEstado = {
        premium: { ...disponible, rol: { $ne: 'admin' }, suscripcion_termina: { $gt: ahora } },
        prueba: { ...disponible, rol: { $ne: 'admin' }, bloqueado_ip_duplicada: { $ne: true }, prueba_termina: { $gt: ahora }, ...sinSuscripcion },
        expirado: { ...disponible, rol: { $ne: 'admin' }, bloqueado_ip_duplicada: { $ne: true }, prueba_termina: { $not: { $gt: ahora } }, ...sinSuscripcion },
        suspendido: { activo: { $ne: false }, suspendido_hasta: { $gt: ahora } },
        desactivado: { activo: false },
        bloqueado_ip: { ...disponible, bloqueado_ip_duplicada: true, ...sinSuscripcion },
        admin: { ...disponible, rol: 'admin' }
      };
      condiciones.push(porEstado[estado]);
    }
    const filtro = condiciones.length ? { $and: condiciones } : {};

    const [usuarios, total, puedeGestionarAdmins] = await Promise.all([
      Usuario.find(filtro).sort({ fecha_registro: -1 }).skip((pagina - 1) * porPagina).limit(porPagina),
      Usuario.countDocuments(filtro),
      esAdministradorPrincipal(req.usuario)
    ]);

    res.json({
      total,
      pagina,
      porPagina,
      puedeGestionarAdmins,
      usuarios: usuarios.map(u => ({
        esAdministradorPrincipal: puedeGestionarAdmins && String(u._id) === String(req.usuario._id),
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
      Usuario.aggregate([{ $group: { _id: null, total: { $sum: '$meses_cortesia' } } }]).option({ maxTimeMS: 5000 }),
      crearControlCuota().consultar(),
      Sugerencia.countDocuments({ estado: { $in: ['nueva', 'en_revision', 'planeada'] } })
    ]);

    const mesesCortesia = totalCortesia[0]?.total || 0;
    res.json({ total, premium, enPrueba, expirados: total - premium - enPrueba, mesesCortesia, diasCortesia: Math.round(mesesCortesia * 30), cuotaApi, ticketsAbiertos });
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

router.patch('/sugerencias/:id', validarIdMongo, async (req, res) => {
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
router.post('/usuarios/:id/suscripcion', validarIdMongo, async (req, res) => {
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

// Cortesía: extiende una cantidad exacta de días sin contar como ingreso
router.post('/usuarios/:id/cortesia', validarIdMongo, async (req, res) => {
  try {
    const dias = Number.parseInt(req.body.dias, 10);
    if (!Number.isInteger(dias) || dias < 1 || dias > 3650) {
      return res.status(400).json({ error: 'Los días deben ser un entero entre 1 y 3650' });
    }
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const ahora = new Date();
    const base = usuario.suscripcion_termina && usuario.suscripcion_termina > ahora
      ? new Date(usuario.suscripcion_termina)
      : ahora;

    base.setUTCDate(base.getUTCDate() + dias);
    usuario.suscripcion_termina = base;
    usuario.plan = 'premium';
    usuario.meses_cortesia = (usuario.meses_cortesia || 0) + (dias / 30);
    await usuario.save();

    res.json({ mensaje: `Cortesía de ${dias} día(s) aplicada`, usuario: usuario.aJSON() });
  } catch (error) {
    errorServidor(res, error);
  }
});


router.patch('/usuarios/:id/rol', validarIdMongo, async (req, res) => {
  try {
    if (!(await esAdministradorPrincipal(req.usuario))) return res.status(403).json({ error: 'Solo el administrador principal puede gestionar administradores' });
    const rol = req.body?.rol;
    if (!['usuario', 'admin'].includes(rol)) return res.status(400).json({ error: 'Rol no válido' });
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (usuario._id.equals(req.usuario._id)) return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
    usuario.rol = rol;
    await usuario.save();
    res.json({ mensaje: rol === 'admin' ? 'Permisos de administrador otorgados' : 'Permisos de administrador retirados', usuario: usuario.aJSON() });
  } catch (error) {
    errorServidor(res, error);
  }
});

router.delete('/usuarios/:id/suscripcion', validarIdMongo, async (req, res) => {
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
    ]).option({ maxTimeMS: 5000 });
    res.json({ duplicadas });
  } catch (error) {
    errorServidor(res, error);
  }
});

// Suspensión temporal
router.post('/usuarios/:id/suspender', validarIdMongo, async (req, res) => {
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
    usuario.sesion_version = Number(usuario.sesion_version || 0) + 1;
    await usuario.save();
    res.json({ mensaje: `Cuenta suspendida por ${dias} día(s)`, usuario: usuario.aJSON() });
  } catch (error) {
    errorServidor(res, error);
  }
});

// Levantar suspensión temporal
router.delete('/usuarios/:id/suspension', validarIdMongo, async (req, res) => {
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
router.delete('/usuarios/:id/bloqueo-ip', validarIdMongo, async (req, res) => {
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
router.patch('/usuarios/:id/activo', validarIdMongo, async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (usuario._id.equals(req.usuario._id)) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    }
    usuario.activo = Boolean(req.body.activo);
    if (!usuario.activo) {
      usuario.sesion_version = Number(usuario.sesion_version || 0) + 1;
    }
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
      MercadoCasa.aggregate([{ $match: { proveedor: 'playdoit', expira_en: { $gt: ahora } } }, { $group: { _id: '$categoria', total: { $sum: 1 } } }, { $sort: { total: -1 } }]).option({ maxTimeMS: 5000 }),
      MercadoCasa.aggregate([{ $match: { proveedor: 'playdoit', expira_en: { $gt: ahora } } }, { $group: { _id: '$estado', total: { $sum: 1 } } }, { $sort: { total: -1 } }]).option({ maxTimeMS: 5000 }),
      MercadoCasa.aggregate([{ $match: { proveedor: 'playdoit', problemas: { $ne: [] } } }, { $unwind: '$problemas' }, { $group: { _id: '$problemas', total: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 20 }]).option({ maxTimeMS: 5000 })
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

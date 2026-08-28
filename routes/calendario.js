const express = require('express');
const { errorServidor } = require('../middleware/security');
const Partido = require('../models/partido');
const Equipo = require('../models/Equipo');
const config = require('../config/leagues');
const { cacheMiddleware } = require('../middleware/cache');
const { analizarPartidosCalendario } = require('../services/calendarPicks');
const { fechaISOEnZona, horaEnZona, zonaHorariaValida } = require('../services/timeZone');

const router = express.Router();

// El documento Partido también guarda eventos, alineaciones y estadísticas por
// periodos. Traerlo completo para pintar una fila del calendario desperdicia
// memoria y ancho de banda entre MongoDB y Node.
const CAMPOS_CALENDARIO = [
  'api_id', 'fecha', 'estado',
  'liga.id', 'liga.nombre', 'liga.pais', 'liga.temporada', 'liga.jornada',
  'equipo_local.id', 'equipo_local.nombre', 'equipo_local.logo', 'equipo_local.goles',
  'equipo_visitante.id', 'equipo_visitante.nombre', 'equipo_visitante.logo', 'equipo_visitante.goles',
  'penales.local', 'penales.visitante', 'ganador_penales',
  'goles_prorroga.local', 'goles_prorroga.visitante'
].join(' ');

async function paisesDeEquipos(partidos) {
  const ids = [...new Set(partidos.flatMap(p => [p.equipo_local?.id, p.equipo_visitante?.id]).filter(Number.isFinite))];
  if (!ids.length) return new Map();
  const equipos = await Equipo.find({ api_id: { $in: ids } }).select('api_id pais').lean();
  return new Map(equipos.filter(e => e.pais).map(e => [e.api_id, e.pais]));
}

function paisDePartido(partido, paises) {
  const configurado = config.ligas[partido.liga?.id]?.pais;
  if (configurado) return configurado;
  if (partido.liga?.pais) return partido.liga.pais;
  const local = paises.get(partido.equipo_local?.id);
  const visitante = paises.get(partido.equipo_visitante?.id);
  return local && local === visitante ? local : (local || visitante || '');
}

// Normaliza la tanda para el cliente. Devuelve null salvo que ambos lados
// traigan número: media tanda no se publica.
function marcadorExtra(origen) {
  const local = origen?.local;
  const visitante = origen?.visitante;
  if (typeof local !== 'number' || typeof visitante !== 'number') return null;
  return { local, visitante };
}

// Convierte 'YYYY-MM-DD' al rango [00:00, 23:59:59.999] de ese día en hora local
function rangoDelDia(textoFecha) {
  const [anio, mes, dia] = textoFecha.split('-').map(Number);
  if (!anio || !mes || !dia) return null;
  const inicio = new Date(anio, mes - 1, dia, 0, 0, 0, 0);
  const fin = new Date(anio, mes - 1, dia, 23, 59, 59, 999);
  if (isNaN(inicio.getTime())) return null;
  return { inicio, fin };
}

function esFinalizado(estado) {
  return ['FT', 'AET', 'PEN'].includes(estado);
}

// Etiqueta legible para un día: "Hoy", "Mañana" o "lunes 28 de julio"
function etiquetaDia(fecha) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const objetivo = new Date(fecha);
  objetivo.setHours(0, 0, 0, 0);
  const diff = Math.round((objetivo - hoy) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  return objetivo.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Partidos de una fecha concreta, agrupados por competición
router.get('/dia', cacheMiddleware, async (req, res) => {
  try {
    const zonaHoraria = zonaHorariaValida(req.query.tz);
    const texto = req.query.fecha || fechaISOEnZona(new Date(), zonaHoraria);
    const rango = rangoDelDia(texto);
    if (!rango) return res.status(400).json({ error: 'Fecha inválida. Usa el formato YYYY-MM-DD' });

    const filtro = { fecha: { $gte: new Date(rango.inicio.getTime() - 86400000), $lte: new Date(rango.fin.getTime() + 86400000) } };
    if (req.query.league) filtro['liga.id'] = parseInt(req.query.league);

    const candidatos = await Partido.find(filtro).select(CAMPOS_CALENDARIO).sort({ fecha: 1 }).lean();
    const partidos = candidatos.filter(p => fechaISOEnZona(p.fecha, zonaHoraria) === texto);
    const paises = await paisesDeEquipos(partidos);

    const porLiga = new Map();
    for (const p of partidos) {
      const idLiga = p.liga?.id;
      if (!porLiga.has(idLiga)) {
        porLiga.set(idLiga, {
          liga_id: idLiga,
          liga: p.liga?.nombre || config.ligas[idLiga]?.nombre || `Liga ${idLiga}`,
          pais: paisDePartido(p, paises),
          partidos: []
        });
      }

      const finalizado = esFinalizado(p.estado);
      porLiga.get(idLiga).partidos.push({
        api_id: p.api_id,
        penales: marcadorExtra(p.penales),
        goles_prorroga: marcadorExtra(p.goles_prorroga),
        ganador_penales: p.ganador_penales || null,
        fecha: p.fecha,
        hora: horaEnZona(p.fecha, zonaHoraria),
        estado: p.estado,
        finalizado,
        jornada: p.liga?.jornada || '',
        local: {
          id: p.equipo_local?.id,
          nombre: p.equipo_local?.nombre,
          logo: p.equipo_local?.logo,
          goles: p.equipo_local?.goles ?? null
        },
        visitante: {
          id: p.equipo_visitante?.id,
          nombre: p.equipo_visitante?.nombre,
          logo: p.equipo_visitante?.logo,
          goles: p.equipo_visitante?.goles ?? null
        }
      });
    }

    res.json({
      fecha: texto,
      zona_horaria: zonaHoraria,
      total: partidos.length,
      competiciones: ordenarCompeticiones(porLiga.values())
    });
  } catch (error) {
    errorServidor(res, error);
  }
});

// Partidos de los próximos N días (por defecto 7), agrupados por día y competición
router.get('/proximos', cacheMiddleware, async (req, res) => {
  try {
    const zonaHoraria = zonaHorariaValida(req.query.tz);
    const dias = Math.min(Math.max(parseInt(req.query.dias) || 7, 1), 30);
    const desde = req.query.desde ? rangoDelDia(req.query.desde)?.inicio : null;
    const inicio = desde || new Date(new Date().setHours(0, 0, 0, 0));
    const fin = new Date(inicio);
    fin.setDate(fin.getDate() + dias - 1);
    fin.setHours(23, 59, 59, 999);

    const filtro = { fecha: { $gte: new Date(inicio.getTime() - 86400000), $lte: new Date(fin.getTime() + 86400000) } };
    if (req.query.league) filtro['liga.id'] = parseInt(req.query.league);

    const candidatos = await Partido.find(filtro).select(CAMPOS_CALENDARIO).sort({ fecha: 1 }).lean();

    // Prepara un contenedor por cada día del rango, aunque no tenga partidos
    const porDia = new Map();
    for (let i = 0; i < dias; i++) {
      const d = new Date(inicio);
      d.setDate(d.getDate() + i);
      const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      porDia.set(clave, { fecha: clave, etiqueta: etiquetaDia(d), total: 0, competiciones: new Map() });
    }

    const partidos = candidatos.filter(p => porDia.has(fechaISOEnZona(p.fecha, zonaHoraria)));
    const paises = await paisesDeEquipos(partidos);

    for (const p of partidos) {
      const clave = fechaISOEnZona(p.fecha, zonaHoraria);
      const dia = porDia.get(clave);
      if (!dia) continue;

      const idLiga = p.liga?.id;
      if (!dia.competiciones.has(idLiga)) {
        dia.competiciones.set(idLiga, {
          liga_id: idLiga,
          liga: p.liga?.nombre || config.ligas[idLiga]?.nombre || `Liga ${idLiga}`,
          pais: paisDePartido(p, paises),
          partidos: []
        });
      }

      const finalizado = esFinalizado(p.estado);
      dia.competiciones.get(idLiga).partidos.push({
        api_id: p.api_id,
        penales: marcadorExtra(p.penales),
        goles_prorroga: marcadorExtra(p.goles_prorroga),
        ganador_penales: p.ganador_penales || null,
        fecha: p.fecha,
        hora: horaEnZona(p.fecha, zonaHoraria),
        estado: p.estado,
        finalizado,
        jornada: p.liga?.jornada || '',
        local: {
          id: p.equipo_local?.id,
          nombre: p.equipo_local?.nombre,
          logo: p.equipo_local?.logo,
          goles: p.equipo_local?.goles ?? null
        },
        visitante: {
          id: p.equipo_visitante?.id,
          nombre: p.equipo_visitante?.nombre,
          logo: p.equipo_visitante?.logo,
          goles: p.equipo_visitante?.goles ?? null
        }
      });
      dia.total++;
    }

    res.json({
      desde: `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-${String(inicio.getDate()).padStart(2, '0')}`,
      dias,
      zona_horaria: zonaHoraria,
      total: partidos.length,
      catalogo: Object.entries(config.ligas).map(([id, liga]) => ({
        id: Number(id),
        nombre: liga.nombre,
        pais: liga.pais || ''
      })),
      jornadas: Array.from(porDia.values()).map(d => ({
        ...d,
        competiciones: ordenarCompeticiones(d.competiciones.values())
      }))
    });
  } catch (error) {
    errorServidor(res, error);
  }
});

// Picks compactos para el calendario. Se calculan en lote y se cachean 10 minutos.
router.get('/picks', cacheMiddleware, async (req, res) => {
  try {
    const zonaHoraria = zonaHorariaValida(req.query.tz);
    const texto = req.query.fecha || req.query.desde || fechaISOEnZona(new Date(), zonaHoraria);
    const rango = rangoDelDia(texto);
    if (!rango) return res.status(400).json({ error: 'Fecha inválida. Usa el formato YYYY-MM-DD' });
    const dias = req.query.fecha ? 1 : Math.min(Math.max(Number.parseInt(req.query.dias || '7', 10), 1), 7);
    const fin = new Date(rango.inicio);
    fin.setDate(fin.getDate() + dias - 1);
    fin.setHours(23, 59, 59, 999);
    const candidatos = await Partido.find({ fecha: { $gte: new Date(rango.inicio.getTime() - 86400000), $lte: new Date(fin.getTime() + 86400000) } })
      .select(CAMPOS_CALENDARIO)
      .sort({ fecha: 1 })
      .lean();
    const hasta = fechaISOEnZona(fin, zonaHoraria);
    const partidos = candidatos.filter(p => {
      const dia = fechaISOEnZona(p.fecha, zonaHoraria);
      return dia >= texto && dia <= hasta;
    });
    const analisis = await analizarPartidosCalendario(partidos);
    const porPartido = Object.fromEntries(analisis.map(item => [item.partido_id, item.picks]));
    const candidatosGenerales = analisis.flatMap(item => item.candidatos.map(pick => ({
      partido_id: item.partido_id,
      fecha: item.fecha,
      liga: item.liga,
      local: item.local,
      visitante: item.visitante,
      pick
    })));
    const catalogoGeneral = {
      categorias: [...new Set(candidatosGenerales.map(item => item.pick.categoria))].sort(),
      direcciones: [...new Set(candidatosGenerales.map(item => item.pick.tipo).filter(Boolean))].sort(),
      lineas: [...new Set(candidatosGenerales.map(item => item.pick.linea).filter(Number.isFinite))].sort((a, b) => a - b)
    };
    const categoria = String(req.query.categoria || '');
    const direccion = String(req.query.direccion || '');
    const lineaTexto = String(req.query.linea || '');
    const linea = lineaTexto === '' ? null : Number(lineaTexto);
    if (lineaTexto && !Number.isFinite(linea)) return res.status(400).json({ error: 'Línea inválida.' });
    const mejoresGeneral = candidatosGenerales
      .filter(item => !categoria || item.pick.categoria === categoria)
      .filter(item => !direccion || item.pick.tipo === direccion)
      .filter(item => linea === null || item.pick.linea === linea)
      .sort((a, b) => b.pick.estimacion - a.pick.estimacion || b.pick.muestra - a.pick.muestra || new Date(a.fecha) - new Date(b.fecha))
      .slice(0, 40);
    const mejores = analisis
      .filter(item => item.picks.length)
      .map(item => ({ ...item, pick: item.picks[0] }))
      .sort((a, b) => b.pick.estimacion - a.pick.estimacion || b.pick.muestra - a.pick.muestra)
      .slice(0, 5);
    res.json({
      desde: texto, dias, partidos: analisis.length, fuente_picks: 'modelo_historico',
      por_partido: porPartido, mejores,
      ...(req.query.general === '1' ? { catalogo_general: catalogoGeneral, mejores_general: mejoresGeneral } : {})
    });
  } catch (error) {
    errorServidor(res, error);
  }
});

// Días con partidos dentro de un mes, para marcarlos en el navegador de fechas
router.get('/mes', cacheMiddleware, async (req, res) => {
  try {
    const zonaHoraria = zonaHorariaValida(req.query.tz);
    const anio = parseInt(req.query.anio);
    const mes = parseInt(req.query.mes); // 1-12
    if (!anio || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ error: 'Parámetros anio y mes (1-12) obligatorios' });
    }

    const inicio = new Date(anio, mes - 1, 1, 0, 0, 0, 0);
    const fin = new Date(anio, mes, 0, 23, 59, 59, 999);
    inicio.setDate(inicio.getDate() - 1);
    fin.setDate(fin.getDate() + 1);

    const dias = await Partido.aggregate([
      { $match: { fecha: { $gte: inicio, $lte: fin } } },
      { $group: { _id: { $dateToString: { date: '$fecha', format: '%Y-%m-%d', timezone: zonaHoraria } }, total: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      anio,
      mes,
      zona_horaria: zonaHoraria,
      dias: dias
        .filter(d => d._id.startsWith(`${anio}-${String(mes).padStart(2, '0')}-`))
        .map(d => ({ dia: Number(d._id.slice(-2)), partidos: d.total }))
    });
  } catch (error) {
    errorServidor(res, error);
  }
});

// Rango global de fechas disponibles, para limitar la navegación
router.get('/rango', cacheMiddleware, async (req, res) => {
  try {
    const [primero, ultimo, total] = await Promise.all([
      Partido.findOne({}).sort({ fecha: 1 }).select('fecha').lean(),
      Partido.findOne({}).sort({ fecha: -1 }).select('fecha').lean(),
      Partido.estimatedDocumentCount()
    ]);

    if (!primero || !ultimo) return res.json({ desde: null, hasta: null, total: 0 });

    res.json({
      desde: primero.fecha?.toISOString().slice(0, 10),
      hasta: ultimo.fecha?.toISOString().slice(0, 10),
      total
    });
  } catch (error) {
    errorServidor(res, error);
  }
});

module.exports = router;

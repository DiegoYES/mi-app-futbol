const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Recomendacion = require('../models/Recomendacion');
const {
  americanoADecimal,
  decimalAAmericano,
  normalizarMomio,
  normalizarRecomendacion,
  recomendacionParaUsuario,
  filtroRecomendacionesPublicas,
  enriquecerRecomendacionesConEvaluacion
} = require('../services/recomendaciones');

const entradaBase = {
  tipo: 'pick',
  titulo: 'Pick del viernes',
  descripcion: 'Análisis editorial',
  visibilidad: 'premium',
  estado_publicacion: 'publicada',
  resultado: 'pendiente',
  cierra_en: '2030-08-23T20:00:00.000Z',
  selecciones: [{
    partido_api_id: 123,
    mercado_id: 'over_2_5',
    formato_momio: 'decimal',
    momio: '1.85'
  }]
};

test('la vista pública incluye recomendaciones activas y recientes de las últimas 48h', () => {
  const ahora = new Date('2026-08-22T00:00:00.000Z');
  const limite48h = new Date('2026-08-20T00:00:00.000Z');
  assert.deepEqual(filtroRecomendacionesPublicas(ahora), {
    estado_publicacion: 'publicada',
    cierra_en: { $gte: limite48h }
  });

  assert.deepEqual(filtroRecomendacionesPublicas(ahora, { soloFuturas: true }), {
    estado_publicacion: 'publicada',
    cierra_en: { $gt: ahora }
  });

  assert.deepEqual(filtroRecomendacionesPublicas(ahora, { todasPublicadas: true }), {
    estado_publicacion: 'publicada'
  });
});

test('normaliza un pick editorial válido sin duplicar el sistema de acceso', () => {
  const resultado = normalizarRecomendacion(entradaBase);

  assert.equal(resultado.error, undefined);
  assert.equal(resultado.datos.tipo, 'pick');
  assert.equal(resultado.datos.selecciones[0].cuota, 1.85);
  assert.equal(resultado.datos.selecciones[0].momio_americano, -118);
  assert.equal(resultado.datos.cuota_total, 1.85);
  assert.ok(resultado.datos.cierra_en instanceof Date);
});

test(`conserva el período elegido y usa partido completo por defecto`, () => {
  const primerTiempo = normalizarRecomendacion({ ...entradaBase, selecciones: [{ ...entradaBase.selecciones[0], periodo: 1 }] });
  const completo = normalizarRecomendacion(entradaBase);
  assert.equal(primerTiempo.datos.selecciones[0].periodo, 1);
  assert.equal(completo.datos.selecciones[0].periodo, 0);
});

test('un parlay exige por lo menos dos selecciones', () => {
  const resultado = normalizarRecomendacion({ ...entradaBase, tipo: 'parlay' });

  assert.match(resultado.error, /entre 2 y 20/);
});

test('una combinada exige varias selecciones del mismo partido', () => {
  const segunda = { ...entradaBase.selecciones[0], mercado_id: 'corners_total_over_8.5', momio: '1.90' };
  const valida = normalizarRecomendacion({
    ...entradaBase,
    tipo: 'combinada',
    selecciones: [...entradaBase.selecciones, segunda]
  });
  const otroPartido = normalizarRecomendacion({
    ...entradaBase,
    tipo: 'combinada',
    selecciones: [...entradaBase.selecciones, { ...segunda, partido_api_id: 456 }]
  });

  assert.equal(valida.error, undefined);
  assert.equal(valida.datos.tipo, 'combinada');
  assert.match(otroPartido.error, /mismo partido/);
});

test('convierte momios americanos positivos y negativos a decimal y viceversa', () => {
  assert.equal(americanoADecimal(100), 2);
  assert.equal(Number(americanoADecimal(-110).toFixed(4)), 1.9091);
  assert.equal(decimalAAmericano(2.5), 150);
  assert.equal(decimalAAmericano(1.91), -110);
  assert.equal(normalizarMomio('+150', 'americano').cuota, 2.5);
  assert.deepEqual(normalizarMomio('-100', 'americano'), {
    cuota: 2,
    americano: 100,
    formato: 'americano',
    capturado: '+100'
  });
  assert.equal(normalizarMomio('-99', 'americano'), null);
});

test('una cuenta sin acceso no recibe el análisis ni las selecciones premium', () => {
  const item = {
    _id: 'rec-1',
    ...entradaBase,
    descripcion: 'Análisis editorial',
    selecciones: [{ evento: 'Local vs Visitante', mercado: 'Más de 2.5 goles', cuota: 1.85 }],
    secreta: 'no debe salir'
  };
  const visible = recomendacionParaUsuario(item, true);
  const bloqueada = recomendacionParaUsuario(item, false);

  assert.equal(visible.descripcion, 'Análisis editorial');
  assert.equal(visible.selecciones.length, 1);
  assert.equal(bloqueada.bloqueada, true);
  assert.equal(bloqueada.descripcion, undefined);
  assert.deepEqual(bloqueada.selecciones, []);
  assert.equal(bloqueada.secreta, undefined);
});

test('las recomendaciones gratuitas conservan su contenido aunque no haya acceso premium', () => {
  const gratis = recomendacionParaUsuario({ ...entradaBase, visibilidad: 'gratis' }, false);

  assert.equal(gratis.bloqueada, false);
  assert.equal(gratis.selecciones.length, 1);
});

test('el modelo declara el índice de publicaciones y valida la cantidad por tipo', async () => {
  const nombres = Recomendacion.schema.indexes().map(([, opciones]) => opciones.name);
  assert.ok(nombres.includes('recomendaciones_publicadas'));

  const invalida = new Recomendacion({
    tipo: 'parlay',
    titulo: entradaBase.titulo,
    visibilidad: entradaBase.visibilidad,
    estado_publicacion: entradaBase.estado_publicacion,
    resultado: entradaBase.resultado,
    cierra_en: entradaBase.cierra_en,
    cuota_total: 1.85,
    momio_total_americano: -118,
    formato_momio_total: 'decimal',
    momio_total_capturado: '1.85',
    selecciones: [{
      partido_api_id: 123,
      fecha_partido: entradaBase.cierra_en,
      liga: { id: 1, nombre: 'Liga' },
      local: { id: 10, nombre: 'Local' },
      visitante: { id: 20, nombre: 'Visitante' },
      evento: 'Local vs Visitante',
      mercado_id: 'over_2_5',
      mercado: 'Más de 2.5 goles',
      cuota: 1.85,
      momio_americano: -118,
      formato_momio: 'decimal',
      momio_capturado: '1.85'
    }],
    creada_por: new mongoose.Types.ObjectId()
  });
  await assert.rejects(invalida.validate(), /entre 2 y 20/);
});

test('enriquecerRecomendacionesConEvaluacion resuelve pick individual como acertado o fallado', async () => {
  const partidosMap = new Map([
    [101, {
      api_id: 101,
      estado: 'FT',
      fecha: new Date(),
      equipo_local: { goles: 2 },
      equipo_visitante: { goles: 1 }
    }],
    [102, {
      api_id: 102,
      estado: 'FT',
      fecha: new Date(),
      equipo_local: { goles: 0 },
      equipo_visitante: { goles: 0 }
    }]
  ]);

  const recomendaciones = [
    {
      _id: 'rec-1',
      tipo: 'pick',
      resultado: 'pendiente',
      selecciones: [{ partido_api_id: 101, mercado_id: 'over_2_5' }]
    },
    {
      _id: 'rec-2',
      tipo: 'pick',
      resultado: 'pendiente',
      selecciones: [{ partido_api_id: 102, mercado_id: 'over_2_5' }]
    }
  ];

  const enriquecidas = await enriquecerRecomendacionesConEvaluacion(recomendaciones, { persistir: false, partidosMap });
  assert.equal(enriquecidas[0].resultado, 'acertado');
  assert.equal(enriquecidas[0].selecciones[0].estado_seleccion, 'acertado');
  assert.equal(enriquecidas[0].selecciones[0].partido_info.goles_local, 2);

  assert.equal(enriquecidas[1].resultado, 'fallado');
  assert.equal(enriquecidas[1].selecciones[0].estado_seleccion, 'fallado');
});

test('enriquecerRecomendacionesConEvaluacion evalúa combinadas y parlays correctamente', async () => {
  const partidosMap = new Map([
    [201, {
      api_id: 201,
      estado: 'FT',
      fecha: new Date(),
      equipo_local: { goles: 1, corners: 6, tarjetas_amarillas: 2 },
      equipo_visitante: { goles: 1, corners: 4, tarjetas_amarillas: 1 },
      estadisticas_completas: true,
      tiempos_completos: true
    }],
    [202, {
      api_id: 202,
      estado: 'FT',
      fecha: new Date(),
      equipo_local: { goles: 0 },
      equipo_visitante: { goles: 0 }
    }],
    [203, {
      api_id: 203,
      estado: 'NS',
      fecha: new Date(),
      equipo_local: { goles: null },
      equipo_visitante: { goles: null }
    }],
    [204, {
      api_id: 204,
      estado: 'CANC',
      fecha: new Date(),
      equipo_local: { goles: null },
      equipo_visitante: { goles: null }
    }]
  ]);

  // Combinada ganada (ambas selecciones cumplen)
  const combinadaGanada = [
    {
      _id: 'rec-comb-win',
      tipo: 'combinada',
      resultado: 'pendiente',
      selecciones: [
        { partido_api_id: 201, mercado_id: 'ambos_anotan' },
        { partido_api_id: 201, mercado_id: 'corners_total_over_8_5' }
      ]
    }
  ];
  const resComb = await enriquecerRecomendacionesConEvaluacion(combinadaGanada, { persistir: false, partidosMap });
  assert.equal(resComb[0].resultado, 'acertado');
  assert.equal(resComb[0].selecciones[0].estado_seleccion, 'acertado');
  assert.equal(resComb[0].selecciones[1].estado_seleccion, 'acertado');

  // Parlay donde 1 falla -> global fallado
  const parlayPerdido = [
    {
      _id: 'rec-parlay-loss',
      tipo: 'parlay',
      resultado: 'pendiente',
      selecciones: [
        { partido_api_id: 201, mercado_id: 'ambos_anotan' },
        { partido_api_id: 202, mercado_id: 'over_2_5' }
      ]
    }
  ];
  const resParlay = await enriquecerRecomendacionesConEvaluacion(parlayPerdido, { persistir: false, partidosMap });
  assert.equal(resParlay[0].resultado, 'fallado');
  assert.equal(resParlay[0].selecciones[0].estado_seleccion, 'acertado');
  assert.equal(resParlay[0].selecciones[1].estado_seleccion, 'fallado');

  // Parlay con partido pendiente -> global pendiente
  const parlayPendiente = [
    {
      _id: 'rec-parlay-pend',
      tipo: 'parlay',
      resultado: 'pendiente',
      selecciones: [
        { partido_api_id: 201, mercado_id: 'ambos_anotan' },
        { partido_api_id: 203, mercado_id: 'over_2_5' }
      ]
    }
  ];
  const resPend = await enriquecerRecomendacionesConEvaluacion(parlayPendiente, { persistir: false, partidosMap });
  assert.equal(resPend[0].resultado, 'pendiente');
  assert.equal(resPend[0].selecciones[0].estado_seleccion, 'acertado');
  assert.equal(resPend[0].selecciones[1].estado_seleccion, 'pendiente');

  // Pick cancelado -> global anulado
  const pickCancelado = [
    {
      _id: 'rec-canc',
      tipo: 'pick',
      resultado: 'pendiente',
      selecciones: [{ partido_api_id: 204, mercado_id: 'over_2_5' }]
    }
  ];
  const resCanc = await enriquecerRecomendacionesConEvaluacion(pickCancelado, { persistir: false, partidosMap });
  assert.equal(resCanc[0].resultado, 'anulado');
  assert.equal(resCanc[0].selecciones[0].estado_seleccion, 'anulado');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Recomendacion = require('../models/Recomendacion');
const {
  americanoADecimal,
  decimalAAmericano,
  normalizarMomio,
  normalizarRecomendacion,
  recomendacionParaUsuario
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

test('normaliza un pick editorial válido sin duplicar el sistema de acceso', () => {
  const resultado = normalizarRecomendacion(entradaBase);

  assert.equal(resultado.error, undefined);
  assert.equal(resultado.datos.tipo, 'pick');
  assert.equal(resultado.datos.selecciones[0].cuota, 1.85);
  assert.equal(resultado.datos.selecciones[0].momio_americano, -118);
  assert.equal(resultado.datos.cuota_total, 1.85);
  assert.ok(resultado.datos.cierra_en instanceof Date);
});

test('un parlay exige por lo menos dos selecciones', () => {
  const resultado = normalizarRecomendacion({ ...entradaBase, tipo: 'parlay' });

  assert.match(resultado.error, /entre 2 y 20/);
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

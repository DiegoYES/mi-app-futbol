const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Recomendacion = require('../models/Recomendacion');
const { normalizarRecomendacion, recomendacionParaUsuario } = require('../services/recomendaciones');

const entradaBase = {
  tipo: 'pick',
  titulo: 'Pick del viernes',
  descripcion: 'Análisis editorial',
  visibilidad: 'premium',
  estado_publicacion: 'publicada',
  resultado: 'pendiente',
  cierra_en: '2030-08-23T20:00:00.000Z',
  selecciones: [{ evento: 'Local vs Visitante', mercado: 'Más de 2.5 goles', cuota: '1.85' }]
};

test('normaliza un pick editorial válido sin duplicar el sistema de acceso', () => {
  const resultado = normalizarRecomendacion(entradaBase);

  assert.equal(resultado.error, undefined);
  assert.equal(resultado.datos.tipo, 'pick');
  assert.equal(resultado.datos.selecciones[0].cuota, 1.85);
  assert.ok(resultado.datos.cierra_en instanceof Date);
});

test('un parlay exige por lo menos dos selecciones', () => {
  const resultado = normalizarRecomendacion({ ...entradaBase, tipo: 'parlay' });

  assert.match(resultado.error, /entre 2 y 20/);
});

test('una cuenta sin acceso no recibe el análisis ni las selecciones premium', () => {
  const item = {
    _id: 'rec-1',
    ...entradaBase,
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
    ...entradaBase,
    tipo: 'parlay',
    creada_por: new mongoose.Types.ObjectId()
  });
  await assert.rejects(invalida.validate(), /entre 2 y 20/);
});

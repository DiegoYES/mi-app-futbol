const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Boleta = require('../models/Boleta');
const Recomendacion = require('../models/Recomendacion');
const { normalizarMomio } = require('../services/recomendaciones');

test('normalizarMomio calcula momios decimales y americanos correctamente', () => {
  const decimal = normalizarMomio('2.50', 'decimal');
  assert.equal(decimal.cuota, 2.5);
  assert.equal(decimal.americano, 150);

  const americano = normalizarMomio('+200', 'americano');
  assert.equal(americano.cuota, 3.0);
  assert.equal(americano.americano, 200);
});

test('esquema de Recomendacion valida tipo pick con 1 seleccion y parlay con varias', () => {
  const adminId = new mongoose.Types.ObjectId();
  const fecha = new Date(Date.now() + 86400000);

  const seleccion1 = {
    partido_api_id: 1001,
    fecha_partido: fecha,
    liga: { id: 1, nombre: 'Liga MX' },
    local: { id: 10, nombre: 'América' },
    visitante: { id: 20, nombre: 'Chivas' },
    evento: 'América vs Chivas',
    mercado_id: 'goles_mas_1_5',
    mercado: 'Más de 1.5 goles',
    periodo: 0,
    cuota: 1.45,
    momio_americano: -222,
    formato_momio: 'decimal',
    momio_capturado: '1.45'
  };

  const pick = new Recomendacion({
    tipo: 'pick',
    titulo: 'Pick del Día',
    visibilidad: 'premium',
    estado_publicacion: 'publicada',
    resultado: 'pendiente',
    cuota_total: 1.45,
    momio_total_americano: -222,
    formato_momio_total: 'decimal',
    momio_total_capturado: '1.45',
    cierra_en: fecha,
    creada_por: adminId,
    selecciones: [seleccion1]
  });

  const errPick = pick.validateSync();
  assert.equal(errPick, undefined);

  const seleccion2 = {
    partido_api_id: 1002,
    fecha_partido: fecha,
    liga: { id: 1, nombre: 'Liga MX' },
    local: { id: 30, nombre: 'Cruz Azul' },
    visitante: { id: 40, nombre: 'Pumas' },
    evento: 'Cruz Azul vs Pumas',
    mercado_id: 'goles_ambos_anotan',
    mercado: 'Ambos anotan - Sí',
    periodo: 0,
    cuota: 1.80,
    momio_americano: -125,
    formato_momio: 'decimal',
    momio_capturado: '1.80'
  };

  const parlay = new Recomendacion({
    tipo: 'parlay',
    titulo: 'Parlay Estelar',
    visibilidad: 'premium',
    estado_publicacion: 'publicada',
    resultado: 'pendiente',
    cuota_total: 2.61,
    momio_total_americano: 161,
    formato_momio_total: 'decimal',
    momio_total_capturado: '2.61',
    cierra_en: fecha,
    creada_por: adminId,
    selecciones: [seleccion1, seleccion2]
  });

  const errParlay = parlay.validateSync();
  assert.equal(errParlay, undefined);
});

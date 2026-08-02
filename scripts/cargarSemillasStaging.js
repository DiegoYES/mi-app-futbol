#!/usr/bin/env node
// Carga de datos SEMILLA sintéticos para la base de STAGING.
//
// SEGURIDAD:
//  - Se niega a ejecutarse si el nombre de la base no termina en "-staging".
//  - Se niega a ejecutarse si APP_ENVIRONMENT no es "staging".
//  - Exige confirmación explícita: STAGING_SEED_CONFIRM=SEMILLAS.
//  - Nunca borra nada: sólo inserta si los documentos no existen (upsert-safe).
//  - No consume API-Football ni ejecuta sincronizaciones.
//  - NO se ejecuta automáticamente desde ningún script de despliegue; el
//    operador debe lanzarlo a mano: npm run seed:staging
//
// Variables:
//  MONGODB_URI                 URI de la base de staging (obligatoria).
//  APP_ENVIRONMENT             debe ser exactamente "staging".
//  STAGING_SEED_CONFIRM        debe ser exactamente "SEMILLAS" (confirmación).
//  STAGING_SEED_EMAIL          Email de la cuenta de prueba (obligatoria).
//  STAGING_SEED_PASSWORD       Contraseña de la cuenta de prueba (obligatoria,
//                              mínimo 12 caracteres; nunca la de producción).

require('dotenv').config();
const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI || '';
const SEED_EMAIL = process.env.STAGING_SEED_EMAIL || '';
const SEED_PASSWORD = process.env.STAGING_SEED_PASSWORD || '';

function nombreBase(uri) {
  try {
    const sinCredenciales = uri.replace(/\/\/[^@/]+@/, '//');
    const ruta = new URL(sinCredenciales).pathname.replace(/^\//, '');
    return ruta.split('?')[0];
  } catch {
    return '';
  }
}

function hostSinCredenciales(uri) {
  try {
    return new URL(uri.replace(/\/\/[^@/]+@/, '//')).host;
  } catch {
    return '(host no reconocible)';
  }
}

async function main() {
  if (!URI) throw new Error('Falta MONGODB_URI.');
  const base = nombreBase(URI);
  if (!base.endsWith('-staging')) {
    throw new Error(
      `BLOQUEADO: la base "${base || '(desconocida)'}" no termina en "-staging". ` +
      'Este script sólo puede escribir en una base de staging, nunca en producción.'
    );
  }
  if (String(process.env.APP_ENVIRONMENT || '').trim().toLowerCase() !== 'staging') {
    throw new Error('BLOQUEADO: APP_ENVIRONMENT debe ser "staging" para cargar semillas.');
  }
  if (process.env.STAGING_SEED_CONFIRM !== 'SEMILLAS') {
    throw new Error('Confirmación requerida: vuelve a ejecutar con STAGING_SEED_CONFIRM=SEMILLAS.');
  }
  if (!SEED_EMAIL || !SEED_PASSWORD) {
    throw new Error('Define STAGING_SEED_EMAIL y STAGING_SEED_PASSWORD (nunca credenciales de producción).');
  }
  if (SEED_PASSWORD.length < 12) throw new Error('STAGING_SEED_PASSWORD debe tener al menos 12 caracteres.');

  console.log('Entorno lógico : staging');
  console.log(`Host           : ${hostSinCredenciales(URI)}`);
  console.log(`Base de datos  : ${base}`);
  console.log('Operación      : ESCRITURA (sólo inserciones sintéticas, sin borrados)');

  await mongoose.connect(URI);
  const Usuario = require('../models/Usuario');
  const Equipo = require('../models/Equipo');
  const Partido = require('../models/partido');

  // Cuenta de prueba con acceso vigente (para el smoke test).
  const existente = await Usuario.findOne({ email: SEED_EMAIL.toLowerCase() });
  if (existente) {
    console.log(`Usuario semilla ya existe: ${SEED_EMAIL}`);
  } else {
    await Usuario.create({
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
      nombre: 'Cuenta Staging',
      rol: 'usuario',
      plan: 'premium',
      suscripcion_termina: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    });
    console.log(`Usuario semilla creado: ${SEED_EMAIL}`);
  }

  // Equipos y partido sintéticos con api_id negativos: imposibles de
  // confundir con datos reales de API-Football.
  const equipos = [
    { api_id: -1001, nombre: 'Staging FC', liga: -90, ligas: [-90], pais: 'Testland' },
    { api_id: -1002, nombre: 'Prueba United', liga: -90, ligas: [-90], pais: 'Testland' }
  ];
  for (const eq of equipos) {
    const ya = await Equipo.findOne({ api_id: eq.api_id });
    if (!ya) {
      await Equipo.create(eq);
      console.log(`Equipo sintético creado: ${eq.nombre}`);
    }
  }

  const partidoSemilla = {
    api_id: -50001,
    fecha: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    estado: 'NS',
    liga: { id: -90, nombre: 'Liga Sintética Staging', temporada: 2026, jornada: 'Jornada 1' },
    equipo_local: { id: -1001, nombre: 'Staging FC', goles: null },
    equipo_visitante: { id: -1002, nombre: 'Prueba United', goles: null }
  };
  const partidoYa = await Partido.findOne({ api_id: partidoSemilla.api_id });
  if (!partidoYa) {
    await Partido.create(partidoSemilla);
    console.log('Partido sintético creado (api_id -50001).');
  }

  await mongoose.disconnect();
  console.log('Semillas de staging listas.');
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});

#!/usr/bin/env node
'use strict';

// Copia exclusivamente datos futbolísticos de producción a una base nueva de
// staging. Nunca borra, reemplaza ni actualiza documentos existentes.
require('dotenv').config();
const { MongoClient } = require('mongodb');

const COLECCIONES = [
  'equipos',
  'partidos',
  'jugadorpartidos',
  'mercadocasas',
  'actualizacionmercados'
];
const LOTE = 1000;

function fallo(mensaje) {
  console.error(`ERROR: ${mensaje}`);
  process.exitCode = 1;
}

function nombreBase(uri) {
  const ruta = new URL(uri).pathname.replace(/^\//, '').split('/')[0];
  return decodeURIComponent(ruta || '');
}

function opcionesIndice(indice) {
  const permitidas = [
    'name', 'unique', 'sparse', 'expireAfterSeconds',
    'partialFilterExpression', 'collation', 'hidden'
  ];
  return Object.fromEntries(permitidas.filter((k) => indice[k] !== undefined).map((k) => [k, indice[k]]));
}

async function copiarColeccion(origen, destino, nombre) {
  await destino.createCollection(nombre);
  const entrada = origen.collection(nombre);
  const salida = destino.collection(nombre);
  const cursor = entrada.find({}, { noCursorTimeout: true }).batchSize(LOTE);
  let lote = [];
  let copiados = 0;

  for await (const documento of cursor) {
    lote.push(documento);
    if (lote.length === LOTE) {
      await salida.insertMany(lote, { ordered: true });
      copiados += lote.length;
      lote = [];
      if (copiados % 100000 === 0) console.log(`  ${nombre}: ${copiados} documentos`);
    }
  }
  if (lote.length) {
    await salida.insertMany(lote, { ordered: true });
    copiados += lote.length;
  }

  const indices = await entrada.indexes();
  for (const indice of indices) {
    if (indice.name === '_id_') continue;
    await salida.createIndex(indice.key, opcionesIndice(indice));
  }

  const verificados = await salida.countDocuments();
  if (verificados !== copiados) throw new Error(`${nombre}: se copiaron ${copiados}, pero el destino cuenta ${verificados}`);
  console.log(`  ${nombre}: ${copiados} documentos e índices verificados`);
  return copiados;
}

async function main() {
  const uriOrigen = process.env.SOURCE_MONGODB_URI || process.env.MONGODB_URI || '';
  const uriDestino = process.env.TARGET_MONGODB_URI || '';
  if (!uriOrigen || !uriDestino) throw new Error('define SOURCE_MONGODB_URI/MONGODB_URI y TARGET_MONGODB_URI');

  const baseOrigen = nombreBase(uriOrigen);
  const baseDestino = nombreBase(uriDestino);
  if (!baseOrigen) throw new Error('la URI de origen no contiene nombre de base');
  if (!baseDestino.includes('snapshot') || !baseDestino.endsWith('-staging')) {
    throw new Error(`la base destino debe contener "snapshot" y terminar en "-staging"; recibido: ${baseDestino || '(vacío)'}`);
  }
  if (baseOrigen === baseDestino) throw new Error('origen y destino no pueden ser la misma base');
  if (baseOrigen.endsWith('-staging')) throw new Error('el origen parece ser staging; este script espera producción como origen');
  if (process.env.SNAPSHOT_CONFIRM !== 'COPIAR') throw new Error('define SNAPSHOT_CONFIRM=COPIAR para confirmar la escritura en la base nueva');

  console.log('Snapshot sanitizado:');
  console.log(`  Origen lógico : ${baseOrigen} (solo lectura)`);
  console.log(`  Destino lógico: ${baseDestino} (base nueva)`);
  console.log(`  Lista blanca  : ${COLECCIONES.join(', ')}`);
  console.log('  Excluidas     : usuarios, boletas, picks, sugerencias, cuota API y bloqueos');

  const clienteOrigen = new MongoClient(uriOrigen, { maxPoolSize: 4 });
  const clienteDestino = new MongoClient(uriDestino, { maxPoolSize: 4 });
  await clienteOrigen.connect();
  await clienteDestino.connect();
  try {
    const origen = clienteOrigen.db(baseOrigen);
    const destino = clienteDestino.db(baseDestino);
    const existentesDestino = await destino.listCollections({}, { nameOnly: true }).toArray();
    if (existentesDestino.length) {
      throw new Error(`el destino ya contiene colecciones (${existentesDestino.map((c) => c.name).join(', ')}); no se sobrescribe nada`);
    }
    const existentesOrigen = new Set((await origen.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const nombre of COLECCIONES) {
      if (!existentesOrigen.has(nombre)) throw new Error(`falta la colección permitida ${nombre} en el origen`);
    }

    const totales = {};
    for (const nombre of COLECCIONES) totales[nombre] = await copiarColeccion(origen, destino, nombre);

    const nombresFinales = (await destino.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
    const inesperadas = nombresFinales.filter((n) => !COLECCIONES.includes(n));
    if (inesperadas.length) throw new Error(`el destino contiene colecciones no permitidas: ${inesperadas.join(', ')}`);
    console.log(`Snapshot completado sin identidades: ${JSON.stringify(totales)}`);
  } finally {
    await Promise.allSettled([clienteOrigen.close(), clienteDestino.close()]);
  }
}

main().catch((error) => fallo(error.message));

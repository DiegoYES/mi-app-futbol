const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const habilitada = Boolean(process.env.REDIS_URL || process.env.REDIS_SOCKET);

test('Redis comparte rate limit y caché entre consumidores', { skip: !habilitada }, async () => {
  const {
    cerrarRedis,
    claveRedis,
    conectarRedis,
    crearStoreRateLimit,
    obtenerClienteRedis
  } = require('../services/redisBackend');
  const { cacheMiddleware, limpiarCache } = require('../middleware/cache');

  await conectarRedis();
  const storeA = crearStoreRateLimit('integracion');
  const storeB = crearStoreRateLimit('integracion');
  await Promise.all([storeA.init({ windowMs: 60_000 }), storeB.init({ windowMs: 60_000 })]);

  const identidad = 'usuario-integracion';
  await storeA.resetKey(identidad);
  assert.equal((await storeA.increment(identidad)).totalHits, 1);
  assert.equal((await storeB.increment(identidad)).totalHits, 2);

  class Respuesta extends EventEmitter {
    constructor() {
      super();
      this.statusCode = 200;
      this.headers = {};
      this.body = undefined;
    }

    set(nombre, valor) {
      this.headers[nombre] = valor;
      return this;
    }

    json(body) {
      this.body = body;
      this.emit('finish');
      return this;
    }
  }

  const ruta = '/api/redis-integration?fixture=1';
  const primera = new Respuesta();
  let consultas = 0;
  await cacheMiddleware({ originalUrl: ruta }, primera, () => {
    consultas += 1;
    return primera.json({ compartido: true });
  });

  const cliente = obtenerClienteRedis();
  const clave = claveRedis('cache', ruta);
  for (let intento = 0; intento < 20 && !(await cliente.exists(clave)); intento += 1) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(await cliente.exists(clave), 1);

  const segunda = new Respuesta();
  await cacheMiddleware({ originalUrl: ruta }, segunda, () => {
    consultas += 1;
    return segunda.json({ compartido: false });
  });
  assert.equal(consultas, 1);
  assert.equal(segunda.headers['X-Cache'], 'HIT');
  assert.deepEqual(segunda.body, { compartido: true });

  await storeA.resetKey(identidad);
  await limpiarCache('redis-integration');
  assert.equal(await cliente.exists(clave), 0);
  await cerrarRedis();
});

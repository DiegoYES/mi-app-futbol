const test = require('node:test');
const assert = require('node:assert/strict');
const { crearBloqueoTrabajo } = require('../services/jobLock');

test('adquiere un lease atómico y lo limita por nombre', async () => {
  let llamada;
  const modelo = {
    async findOneAndUpdate(filtro, cambios, opciones) {
      llamada = { filtro, cambios, opciones };
      return { nombre: filtro.nombre };
    },
    async updateOne() { return { modifiedCount: 1 }; }
  };
  const bloqueo = crearBloqueoTrabajo({ modelo, propietario: 'worker-1', leaseMs: 60_000 });
  const ahora = new Date('2026-07-29T12:00:00.000Z');
  const resultado = await bloqueo.adquirir('cron:batch1', ahora);

  assert.equal(resultado.adquirido, true);
  assert.equal(llamada.filtro.nombre, 'cron:batch1');
  assert.deepEqual(llamada.filtro.$or[0], { expira_en: { $lte: ahora } });
  assert.equal(llamada.opciones.upsert, true);
  assert.equal(resultado.expira_en.toISOString(), '2026-07-29T12:01:00.000Z');
});

test('una clave duplicada representa un trabajo activo, no un fallo fatal', async () => {
  const modelo = {
    async findOneAndUpdate() {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
  };
  const bloqueo = crearBloqueoTrabajo({ modelo, propietario: 'worker-2' });
  assert.deepEqual(await bloqueo.adquirir('cron:batch1'), { adquirido: false });
});

test('sólo el propietario puede renovar o liberar el lease', async () => {
  const filtros = [];
  const modelo = {
    async updateOne(filtro) {
      filtros.push(filtro);
      return { modifiedCount: 1 };
    }
  };
  const bloqueo = crearBloqueoTrabajo({ modelo, propietario: 'worker-seguro' });

  assert.equal(await bloqueo.renovar('sync'), true);
  assert.equal(await bloqueo.liberar('sync'), true);
  assert.equal(filtros[0].propietario, 'worker-seguro');
  assert.equal(filtros[1].propietario, 'worker-seguro');
});

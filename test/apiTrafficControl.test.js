const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ApiFootballCircuitOpenError,
  crearControlTraficoApi,
  esperaIndicadaMs
} = require('../services/apiTrafficControl');

test('serializa solicitudes a cuatro por segundo de forma predeterminada', async () => {
  let ahora = 1_000;
  const esperas = [];
  const control = crearControlTraficoApi({
    env: {},
    reloj: () => ahora,
    dormir: async ms => { esperas.push(ms); ahora += ms; },
    aleatorio: () => 0
  });

  await control.antesDeSolicitar();
  await control.antesDeSolicitar();
  await control.antesDeSolicitar();

  assert.deepEqual(esperas, [250, 250]);
  assert.equal(control.estado().max_por_minuto_efectivo, 240);
});

test('respeta Retry-After y aplica backoff acotado', async () => {
  let ahora = 10_000;
  let espera;
  const control = crearControlTraficoApi({
    env: { API_FOOTBALL_MAX_RETRIES: '2' },
    reloj: () => ahora,
    dormir: async ms => { espera = ms; ahora += ms; },
    aleatorio: () => 0
  });

  const resultado = await control.esperarReintento({}, { headers: { 'retry-after': '3' } });
  assert.equal(resultado.intento, 1);
  assert.equal(espera, 3000);
  assert.equal(esperaIndicadaMs({ headers: { 'retry-after': '2' } }, ahora), 2000);
});

test('abre el circuito después de fallos transitorios consecutivos', async () => {
  let ahora = 20_000;
  const control = crearControlTraficoApi({
    env: {
      API_FOOTBALL_CIRCUIT_FAILURES: '2',
      API_FOOTBALL_CIRCUIT_COOLDOWN_MS: '5000'
    },
    reloj: () => ahora,
    dormir: async ms => { ahora += ms; }
  });

  control.registrarFallo(new Error('uno'));
  control.registrarFallo(new Error('dos'));
  await assert.rejects(control.antesDeSolicitar(), ApiFootballCircuitOpenError);
  ahora += 5000;
  await control.antesDeSolicitar();
  assert.equal(control.estado().circuito, 'cerrado');
});

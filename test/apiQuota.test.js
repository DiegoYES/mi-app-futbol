const test = require('node:test');
const assert = require('node:assert/strict');

const UsoApiDiario = require('../models/UsoApiDiario');
const {
  ApiFootballProviderError,
  ApiFootballRateLimitError,
  CuotaApiAgotadaError,
  crearControlCuota,
  extraerCuotaDiaria,
  extraerCuotaMinuto,
  esLimiteTemporal,
  instalarControlCuotaAxios,
  obtenerConfiguracion,
  obtenerDiaCuota,
  resumirUso
} = require('../services/apiQuota');

test('el interceptor reserva cuota solo para API-Football', async () => {
  let interceptor;
  let reservas = 0;
  const axiosFalso = {
    interceptors: { request: { use(fn) { interceptor = fn; return 1; } } }
  };
  instalarControlCuotaAxios(axiosFalso, {
    control: { async reservar() { reservas++; } }
  });

  await interceptor({ url: 'https://v3.football.api-sports.io/fixtures' });
  await interceptor({ url: 'https://example.com/data' });
  assert.equal(reservas, 1);
});

test('consultar status no consume la reserva local', async () => {
  let interceptor;
  let reservas = 0;
  const axiosFalso = {
    interceptors: { request: { use(fn) { interceptor = fn; return 1; } } }
  };
  instalarControlCuotaAxios(axiosFalso, {
    env: { API_FOOTBALL_KEY: 'secreto-de-prueba' },
    control: { async reservar() { reservas++; } }
  });

  const config = await interceptor({
    baseURL: 'https://v3.football.api-sports.io',
    url: '/status'
  });
  assert.equal(reservas, 0);
  assert.equal(config.headers['x-apisports-key'], 'secreto-de-prueba');
});

test('extrae el límite diario dinámico sin confundir encabezados por minuto', () => {
  const cuota = extraerCuotaDiaria({ headers: {
    'x-ratelimit-requests-limit': '117',
    'x-ratelimit-requests-remaining': '116',
    'X-RateLimit-Limit': '10',
    'X-RateLimit-Remaining': '0'
  } });

  assert.deepEqual(cuota, { limite: 117, restantes: 116, origen: 'headers' });
});

test('extrae por separado el límite por minuto', () => {
  const cuota = extraerCuotaMinuto({ headers: {
    'x-ratelimit-requests-limit': '7500',
    'x-ratelimit-requests-remaining': '7400',
    'X-RateLimit-Limit': '300',
    'X-RateLimit-Remaining': '299'
  } });

  assert.deepEqual(cuota, { limite: 300, restantes: 299, origen: 'headers' });
});

test('un error requests sin referencia al día se trata como límite temporal', () => {
  assert.equal(esLimiteTemporal({
    status: 200,
    data: { errors: { requests: 'Request limit reached, slow down.' } }
  }), true);
});

test('sincroniza un límite dinámico reportado por el proveedor', async () => {
  let cambiosAplicados;
  const modelo = {
    async findOneAndUpdate(filtro, cambios) {
      cambiosAplicados = cambios;
      return {
        limite: cambios.$set.limite,
        limite_origen: cambios.$set.limite_origen,
        margen_seguridad: cambios.$set.margen_seguridad,
        usadas: cambios.$max.usadas,
        restantes_proveedor: cambios.$set.restantes_proveedor
      };
    }
  };
  const control = crearControlCuota({ modelo, env: { API_FOOTBALL_QUOTA_MARGIN: '0' } });
  const estado = await control.sincronizarProveedor({
    limite: 117,
    restantes: 116,
    ahora: new Date('2026-07-25T12:00:00.000Z')
  });

  assert.equal(cambiosAplicados.$max.usadas, 1);
  assert.equal(estado.limite, 117);
  assert.equal(estado.restantes, 116);
  assert.equal(estado.limite_origen, 'proveedor');
});

test('un 429 por minuto no agota el día ni rota de key', async () => {
  let interceptorError;
  let agotadas = 0;
  let reintentos = 0;
  const axiosFalso = {
    request: async () => { reintentos++; },
    interceptors: {
      request: { use() { return 1; } },
      response: { use(_, fnError) { interceptorError = fnError; return 2; } }
    }
  };
  instalarControlCuotaAxios(axiosFalso, {
    env: {
      API_FOOTBALL_KEY: 'principal',
      API_FOOTBALL_KEY_2: 'respaldo',
      API_FOOTBALL_ALLOW_KEY_FAILOVER: 'true',
      API_FOOTBALL_MAX_RETRIES: '0'
    },
    control: {
      async reservar() {},
      async marcarAgotada() { agotadas++; }
    }
  });
  const error = {
    config: { url: '/fixtures', __apiKeyIndex: 0 },
    response: {
      status: 429,
      headers: {
        'x-ratelimit-requests-limit': '117',
        'x-ratelimit-requests-remaining': '80',
        'x-ratelimit-remaining': '0'
      }
    }
  };

  await assert.rejects(interceptorError(error), recibido => {
    assert.ok(recibido instanceof ApiFootballRateLimitError);
    assert.equal(recibido.code, 'API_FOOTBALL_RATE_LIMITED');
    return true;
  });
  assert.equal(agotadas, 0);
  assert.equal(reintentos, 0);
});

test('reintenta errors.rateLimit sin marcar agotada la cuota diaria', async () => {
  let interceptorRespuesta;
  let configReintentada;
  let agotadas = 0;
  const axiosFalso = {
    async request(config) {
      configReintentada = config;
      return { data: { response: [] } };
    },
    interceptors: {
      request: { use() { return 1; } },
      response: { use(fn) { interceptorRespuesta = fn; return 2; } }
    }
  };
  const trafico = {
    async antesDeSolicitar() {},
    registrarExito() {},
    registrarFallo() {},
    puedeReintentar: () => true,
    async esperarReintento() { return { intento: 1, espera: 0 }; },
    estado: () => ({ reintentar_en_ms: 0 })
  };
  instalarControlCuotaAxios(axiosFalso, {
    env: { API_FOOTBALL_KEY: 'prueba' },
    trafico,
    control: {
      async reservar() {},
      async marcarAgotada() { agotadas++; }
    }
  });

  const resultado = await interceptorRespuesta({
    status: 200,
    data: { errors: { rateLimit: 'Too many requests per minute.' } },
    config: { url: '/fixtures', __apiQuotaReservada: true }
  });

  assert.deepEqual(resultado, { data: { response: [] } });
  assert.equal(configReintentada.__apiRetryCount, 1);
  assert.equal(configReintentada.__apiQuotaReservada, false);
  assert.equal(agotadas, 0);
});

test('el interceptor detecta el límite aunque API-Football responda HTTP 200', async () => {
  let interceptorRespuesta;
  let endpointMarcado;
  const axiosFalso = {
    interceptors: {
      request: { use() { return 1; } },
      response: { use(fn) { interceptorRespuesta = fn; return 2; } }
    }
  };
  instalarControlCuotaAxios(axiosFalso, {
    control: {
      async reservar() {},
      async marcarAgotada({ endpoint }) {
        endpointMarcado = endpoint;
        return {
          usadas: 95,
          disponibles_para_uso: 95,
          limite: 100,
          margen_seguridad: 5,
          restantes: 0,
          agotada: true
        };
      }
    }
  });

  await assert.rejects(
    interceptorRespuesta({
      data: { errors: { requests: 'You have reached the request limit for the day.' } },
      config: { url: '/fixtures' }
    }),
    error => {
      assert.ok(error instanceof CuotaApiAgotadaError);
      assert.equal(error.code, 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED');
      assert.equal(error.estado.agotada, true);
      return true;
    }
  );
  assert.equal(endpointMarcado, '/fixtures');
});

test('el interceptor no acepta una suspensión escondida en HTTP 200', async () => {
  let interceptorRespuesta;
  const axiosFalso = {
    interceptors: {
      request: { use() { return 1; } },
      response: { use(fn) { interceptorRespuesta = fn; return 2; } }
    }
  };
  instalarControlCuotaAxios(axiosFalso, {
    control: { async reservar() {} }
  });

  await assert.rejects(
    interceptorRespuesta({
      data: { errors: { access: 'Your account is suspended.' } },
      config: { url: '/teams' }
    }),
    error => {
      assert.ok(error instanceof ApiFootballProviderError);
      assert.equal(error.code, 'API_FOOTBALL_PROVIDER_ERROR');
      assert.match(error.message, /suspended/i);
      return true;
    }
  );
});

test('marcar agotada sincroniza el contador local con el límite utilizable', async () => {
  let llamada;
  const modelo = {
    async findOneAndUpdate(filtro, cambios, opciones) {
      llamada = { filtro, cambios, opciones };
      return {
        usadas: cambios.$set.usadas,
        ultima_reserva: cambios.$set.ultima_reserva,
        ultimo_endpoint: cambios.$set.ultimo_endpoint
      };
    }
  };
  const control = crearControlCuota({ modelo, env: {} });
  const ahora = new Date('2026-07-25T12:00:00.000Z');
  const estado = await control.marcarAgotada({ endpoint: '/status', ahora });

  assert.equal(llamada.cambios.$set.usadas, 100);
  assert.equal(llamada.cambios.$set.ultimo_endpoint, '/status');
  assert.equal(llamada.opciones.upsert, true);
  assert.equal(estado.usadas, 100);
  assert.equal(estado.restantes, 0);
  assert.equal(estado.agotada, true);
});

test('la configuración gratuita aprovecha todo el cupo por defecto', () => {
  const config = obtenerConfiguracion({});

  assert.equal(config.limite, 100);
  assert.equal(config.margenSeguridad, 0);
  assert.equal(config.zonaHoraria, 'UTC');
});

test('la configuración inválida cae a valores seguros y limita el margen', () => {
  const config = obtenerConfiguracion({
    API_FOOTBALL_DAILY_LIMIT: '10',
    API_FOOTBALL_QUOTA_MARGIN: '99',
    API_FOOTBALL_QUOTA_TIMEZONE: 'Zona/Inventada'
  });

  assert.equal(config.limite, 10);
  assert.equal(config.margenSeguridad, 9);
  assert.equal(config.zonaHoraria, 'UTC');
});

test('el día de cuota respeta la zona horaria configurada', () => {
  const instante = new Date('2026-07-26T04:30:00.000Z');

  assert.equal(obtenerDiaCuota(instante, 'UTC'), '2026-07-26');
  assert.equal(obtenerDiaCuota(instante, 'America/Mexico_City'), '2026-07-25');
});

test('el resumen nunca ofrece el margen de seguridad', () => {
  const config = obtenerConfiguracion({
    API_FOOTBALL_DAILY_LIMIT: '100',
    API_FOOTBALL_QUOTA_MARGIN: '5'
  });
  const estado = resumirUso({ usadas: 93 }, config, '2026-07-25');

  assert.equal(estado.disponibles_para_uso, 95);
  assert.equal(estado.restantes, 2);
  assert.equal(estado.agotada, false);
});

test('el modelo impide dos contadores para el mismo proveedor y día', () => {
  const indice = UsoApiDiario.schema.indexes().find(([, opciones]) => (
    opciones.name === 'proveedor_dia_unico'
  ));

  assert.ok(indice);
  assert.deepEqual(indice[0], { proveedor: 1, dia: 1 });
  assert.equal(indice[1].unique, true);
});

test('reservar construye un incremento atómico y devuelve el cupo restante', async () => {
  let llamada;
  const modelo = {
    async findOneAndUpdate(filtro, cambios, opciones) {
      llamada = { filtro, cambios, opciones };
      return { usadas: 3, ultima_reserva: cambios.$set.ultima_reserva };
    }
  };
  const control = crearControlCuota({
    modelo,
    env: {
      API_FOOTBALL_DAILY_LIMIT: '100',
      API_FOOTBALL_QUOTA_MARGIN: '5',
      API_FOOTBALL_QUOTA_TIMEZONE: 'UTC'
    }
  });
  const ahora = new Date('2026-07-25T12:00:00.000Z');
  const estado = await control.reservar({ cantidad: 3, endpoint: '/fixtures', ahora });

  assert.deepEqual(llamada.filtro.usadas, { $lte: 92 });
  assert.equal(llamada.cambios.$inc.usadas, 3);
  assert.equal(llamada.cambios.$inc.reservas, 1);
  assert.equal(llamada.cambios.$set.ultimo_endpoint, '/fixtures');
  assert.equal(llamada.opciones.upsert, true);
  assert.equal(estado.usadas, 3);
  assert.equal(estado.restantes, 92);
});

test('una fila existente sin cupo produce un error reconocible', async () => {
  let actualizaciones = 0;
  const modelo = {
    async findOneAndUpdate() {
      actualizaciones++;
      if (actualizaciones === 1) {
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }
      return null;
    },
    findOne() {
      return { lean: async () => ({ usadas: 100 }) };
    }
  };
  const control = crearControlCuota({ modelo, env: {} });

  await assert.rejects(
    control.reservar({ ahora: new Date('2026-07-25T12:00:00.000Z') }),
    error => {
      assert.ok(error instanceof CuotaApiAgotadaError);
      assert.equal(error.code, 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED');
      assert.equal(error.estado.restantes, 0);
      return true;
    }
  );
});

test('reservar rechaza cantidades no positivas antes de tocar el modelo', async () => {
  const modelo = {
    async findOneAndUpdate() {
      assert.fail('no debía consultar MongoDB');
    }
  };
  const control = crearControlCuota({ modelo, env: {} });

  await assert.rejects(control.reservar({ cantidad: 0 }), TypeError);
});

test('no permite reservar de una vez más que todo el cupo utilizable', async () => {
  const modelo = {
    async findOneAndUpdate() {
      assert.fail('no debía consultar MongoDB');
    }
  };
  const control = crearControlCuota({ modelo, env: {} });

  await assert.rejects(
    control.reservar({ cantidad: 101 }),
    error => error instanceof CuotaApiAgotadaError && error.estado.restantes === 100
  );
});

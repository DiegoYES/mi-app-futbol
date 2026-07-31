const UsoApiDiario = require('../models/UsoApiDiario');
const { controlTraficoApi, crearControlTraficoApi } = require('./apiTrafficControl');

const PROVEEDOR = 'api-football';
const LIMITE_PREDETERMINADO = 100;
const MARGEN_PREDETERMINADO = 0;
const ZONA_PREDETERMINADA = 'UTC';
const ENCABEZADO_API_KEY = 'x-apisports-key';

class CuotaApiAgotadaError extends Error {
  constructor(estado) {
    super(
      `Cuota diaria de API-Football agotada: ${estado.usadas}/${estado.disponibles_para_uso} ` +
      `(límite ${estado.limite}, margen ${estado.margen_seguridad})`
    );
    this.name = 'CuotaApiAgotadaError';
    this.code = 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED';
    this.estado = estado;
  }
}

class ApiFootballProviderError extends Error {
  constructor(errores) {
    const mensajes = Object.entries(errores || {}).map(([tipo, mensaje]) => `${tipo}: ${mensaje}`);
    super(`API-Football rechazó la consulta: ${mensajes.join(' · ') || 'error desconocido'}`);
    this.name = 'ApiFootballProviderError';
    this.code = 'API_FOOTBALL_PROVIDER_ERROR';
    this.errores = errores || {};
  }
}

class ApiFootballRateLimitError extends Error {
  constructor(retryAfterMs = 0) {
    super('API-Football alcanzó su límite temporal. La solicitud podrá reintentarse más tarde.');
    this.name = 'ApiFootballRateLimitError';
    this.code = 'API_FOOTBALL_RATE_LIMITED';
    this.retryAfterMs = retryAfterMs;
  }
}

function enteroPositivo(valor, fallback) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : fallback;
}

function enteroNoNegativo(valor, fallback) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : fallback;
}

function esVerdadero(valor) {
  return ['1', 'true', 'yes', 'si', 'sí'].includes(String(valor || '').trim().toLowerCase());
}

function validarZonaHoraria(zonaHoraria) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zonaHoraria }).format(new Date());
    return zonaHoraria;
  } catch {
    return ZONA_PREDETERMINADA;
  }
}

function obtenerApiKeys(env = process.env) {
  const desdeLista = String(env.API_FOOTBALL_KEYS || '')
    .split(',')
    .map(valor => valor.trim())
    .filter(Boolean);
  const candidatas = [
    ...desdeLista,
    env.API_FOOTBALL_KEY,
    env.API_FOOTBALL_KEY_2
  ].filter(Boolean).map(valor => String(valor).trim()).filter(Boolean);
  return [...new Set(candidatas)];
}

function obtenerConfiguracion(env = process.env, proveedor = PROVEEDOR) {
  const limite = enteroPositivo(env.API_FOOTBALL_DAILY_LIMIT, LIMITE_PREDETERMINADO);
  const margenSolicitado = enteroNoNegativo(
    env.API_FOOTBALL_QUOTA_MARGIN,
    MARGEN_PREDETERMINADO
  );
  return {
    proveedor,
    limite,
    margenSeguridad: Math.min(margenSolicitado, limite - 1),
    zonaHoraria: validarZonaHoraria(env.API_FOOTBALL_QUOTA_TIMEZONE || ZONA_PREDETERMINADA)
  };
}

function obtenerDiaCuota(fecha = new Date(), zonaHoraria = ZONA_PREDETERMINADA) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: validarZonaHoraria(zonaHoraria),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(fecha);
  const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

function configuracionEfectiva(documento, configuracion) {
  const limite = enteroPositivo(documento?.limite, configuracion.limite);
  const margenGuardado = enteroNoNegativo(
    documento?.margen_seguridad,
    configuracion.margenSeguridad
  );
  return {
    ...configuracion,
    limite,
    margenSeguridad: Math.min(margenGuardado, limite - 1)
  };
}

function resumirUso(documento, configuracion, dia) {
  const efectiva = configuracionEfectiva(documento, configuracion);
  const usadas = enteroNoNegativo(documento?.usadas, 0);
  const disponiblesParaUso = efectiva.limite - efectiva.margenSeguridad;
  return {
    proveedor: efectiva.proveedor,
    dia,
    zona_horaria: efectiva.zonaHoraria,
    limite: efectiva.limite,
    limite_origen: documento?.limite_origen || 'configuracion',
    margen_seguridad: efectiva.margenSeguridad,
    disponibles_para_uso: disponiblesParaUso,
    usadas,
    restantes: Math.max(0, disponiblesParaUso - usadas),
    restantes_proveedor: Number.isInteger(documento?.restantes_proveedor)
      ? documento.restantes_proveedor
      : null,
    agotada: usadas >= disponiblesParaUso,
    ultima_reserva: documento?.ultima_reserva || null,
    ultima_sincronizacion: documento?.ultima_sincronizacion || null,
    ultimo_endpoint: documento?.ultimo_endpoint || null
  };
}

function esClaveDuplicada(error) {
  return error?.code === 11000 || error?.code === 11001;
}

async function leerDocumento(modelo, filtro) {
  if (typeof modelo.findOne !== 'function') return null;
  const consulta = modelo.findOne(filtro);
  return typeof consulta?.lean === 'function' ? consulta.lean() : consulta;
}

function crearControlCuota({ modelo = UsoApiDiario, env = process.env, proveedor = PROVEEDOR } = {}) {
  const configuracion = obtenerConfiguracion(env, proveedor);

  async function consultar({ ahora = new Date() } = {}) {
    const dia = obtenerDiaCuota(ahora, configuracion.zonaHoraria);
    const documento = await leerDocumento(modelo, { proveedor: configuracion.proveedor, dia });
    return resumirUso(documento, configuracion, dia);
  }

  async function reservar({ cantidad = 1, endpoint = null, ahora = new Date() } = {}) {
    const unidades = enteroPositivo(cantidad, 0);
    if (!unidades) throw new TypeError('La cantidad a reservar debe ser un entero positivo.');

    const dia = obtenerDiaCuota(ahora, configuracion.zonaHoraria);
    const llave = { proveedor: configuracion.proveedor, dia };
    const existente = await leerDocumento(modelo, llave);
    const efectiva = configuracionEfectiva(existente, configuracion);
    const disponiblesParaUso = efectiva.limite - efectiva.margenSeguridad;
    if (unidades > disponiblesParaUso) {
      throw new CuotaApiAgotadaError(resumirUso(existente, configuracion, dia));
    }
    const filtro = {
      ...llave,
      usadas: { $lte: disponiblesParaUso - unidades }
    };
    const cambios = {
      $setOnInsert: {
        ...llave,
        zona_horaria: efectiva.zonaHoraria,
        limite: efectiva.limite,
        limite_origen: 'configuracion',
        margen_seguridad: efectiva.margenSeguridad
      },
      $set: { ultima_reserva: ahora },
      $inc: { usadas: unidades, reservas: 1 }
    };
    if (endpoint) cambios.$set.ultimo_endpoint = String(endpoint).slice(0, 200);

    let documento;
    try {
      documento = await modelo.findOneAndUpdate(filtro, cambios, {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true,
        lean: true
      });
    } catch (error) {
      if (!esClaveDuplicada(error)) throw error;
      documento = await modelo.findOneAndUpdate(filtro, cambios, {
        upsert: false,
        returnDocument: 'after',
        lean: true
      });
    }
    if (!documento) {
      const actual = await leerDocumento(modelo, llave);
      throw new CuotaApiAgotadaError(resumirUso(actual, configuracion, dia));
    }
    return resumirUso(documento, configuracion, dia);
  }

  async function sincronizarProveedor({ limite, restantes, endpoint = null, ahora = new Date() } = {}) {
    const limiteReal = enteroPositivo(limite, 0);
    const restantesReales = enteroNoNegativo(restantes, -1);
    if (!limiteReal || restantesReales < 0 || restantesReales > limiteReal) return consultar({ ahora });

    const dia = obtenerDiaCuota(ahora, configuracion.zonaHoraria);
    const margen = Math.min(configuracion.margenSeguridad, limiteReal - 1);
    const usadasProveedor = limiteReal - restantesReales;
    const cambios = {
      $setOnInsert: {
        proveedor: configuracion.proveedor,
        dia,
        zona_horaria: configuracion.zonaHoraria,
        reservas: 0
      },
      $set: {
        limite: limiteReal,
        limite_origen: 'proveedor',
        margen_seguridad: margen,
        restantes_proveedor: restantesReales,
        ultima_sincronizacion: ahora,
        ...(endpoint ? { ultimo_endpoint: String(endpoint).slice(0, 200) } : {})
      },
      // Conserva reservas locales concurrentes si van delante del encabezado recibido.
      $max: { usadas: usadasProveedor }
    };
    const documento = await modelo.findOneAndUpdate(
      { proveedor: configuracion.proveedor, dia },
      cambios,
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: false, lean: true }
    );
    return resumirUso(documento, configuracion, dia);
  }

  async function marcarAgotada({ endpoint = null, ahora = new Date() } = {}) {
    const dia = obtenerDiaCuota(ahora, configuracion.zonaHoraria);
    const llave = { proveedor: configuracion.proveedor, dia };
    const existente = await leerDocumento(modelo, llave);
    const efectiva = configuracionEfectiva(existente, configuracion);
    const disponiblesParaUso = efectiva.limite - efectiva.margenSeguridad;
    const cambios = {
      $setOnInsert: {
        ...llave,
        zona_horaria: efectiva.zonaHoraria,
        limite: efectiva.limite,
        limite_origen: existente?.limite_origen || 'configuracion',
        margen_seguridad: efectiva.margenSeguridad
      },
      $set: {
        usadas: disponiblesParaUso,
        restantes_proveedor: 0,
        ultima_reserva: ahora,
        ...(endpoint ? { ultimo_endpoint: String(endpoint).slice(0, 200) } : {})
      }
    };
    const documento = await modelo.findOneAndUpdate(llave, cambios, {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      lean: true
    });
    return resumirUso(documento, configuracion, dia);
  }

  return { consultar, reservar, sincronizarProveedor, marcarAgotada, configuracion };
}

function leerHeader(headers, nombre) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(nombre);
  const encontrada = Object.keys(headers).find(clave => clave.toLowerCase() === nombre.toLowerCase());
  return encontrada ? headers[encontrada] : undefined;
}

function extraerCuotaDiaria(respuesta) {
  const limiteHeader = enteroPositivo(leerHeader(respuesta?.headers, 'x-ratelimit-requests-limit'), 0);
  const restantesHeader = enteroNoNegativo(
    leerHeader(respuesta?.headers, 'x-ratelimit-requests-remaining'),
    -1
  );
  if (limiteHeader && restantesHeader >= 0 && restantesHeader <= limiteHeader) {
    return { limite: limiteHeader, restantes: restantesHeader, origen: 'headers' };
  }

  const solicitudes = respuesta?.data?.response?.requests || respuesta?.data?.requests;
  const limiteEstado = enteroPositivo(solicitudes?.limit_day, 0);
  const usadasEstado = enteroNoNegativo(solicitudes?.current, -1);
  if (limiteEstado && usadasEstado >= 0 && usadasEstado <= limiteEstado) {
    return { limite: limiteEstado, restantes: limiteEstado - usadasEstado, origen: 'status' };
  }
  return null;
}

function extraerCuotaMinuto(respuesta) {
  const limite = enteroPositivo(leerHeader(respuesta?.headers, 'X-RateLimit-Limit'), 0);
  const restantes = enteroNoNegativo(
    leerHeader(respuesta?.headers, 'X-RateLimit-Remaining'),
    -1
  );
  return limite && restantes >= 0 && restantes <= limite
    ? { limite, restantes, origen: 'headers' }
    : null;
}

function textoErrorLimite(respuesta) {
  const errores = respuesta?.data?.errors || {};
  return [errores.rateLimit, errores.requests].filter(Boolean).join(' ');
}

function esAgotamientoDiario(respuesta, cuota = extraerCuotaDiaria(respuesta)) {
  const texto = textoErrorLimite(respuesta);
  return cuota?.restantes === 0 || /(?:daily|day)[^.]*request|request[^.]*limit[^.]*day/i.test(texto);
}

function esLimiteTemporal(respuesta) {
  if (esAgotamientoDiario(respuesta)) return false;
  const cuotaMinuto = extraerCuotaMinuto(respuesta);
  return respuesta?.status === 429 ||
    cuotaMinuto?.restantes === 0 ||
    Boolean(respuesta?.data?.errors?.rateLimit) ||
    /request limit/i.test(textoErrorLimite(respuesta));
}

function esErrorTransitorio(error) {
  const status = error?.response?.status;
  return !error?.response || status === 429 || status === 408 || status >= 500;
}

function instalarControlCuotaAxios(
  instanciaAxios,
  { control: controlExplicito, trafico: traficoExplicito, env = process.env } = {}
) {
  const trafico = traficoExplicito || (env === process.env
    ? controlTraficoApi
    : crearControlTraficoApi({ env }));
  const clavesConfiguradas = obtenerApiKeys(env);
  const permitirFailover = esVerdadero(env.API_FOOTBALL_ALLOW_KEY_FAILOVER);
  const claves = permitirFailover ? clavesConfiguradas : clavesConfiguradas.slice(0, 1);

  // Con failover activo, múltiples claves y sin control mock inyectado,
  // cada key tiene su propio contador en MongoDB.
  // Si se inyecta un control explícito (tests), usarlo para todas las keys.
  const controlesporClave = (!controlExplicito && permitirFailover && claves.length > 1)
    ? claves.map((_, i) => crearControlCuota({ env, proveedor: `${PROVEEDOR}:key${i + 1}` }))
    : null;
  const control = controlExplicito || crearControlCuota();

  function controlParaIndice(indice) {
    if (controlesporClave) return controlesporClave[indice] || controlesporClave[0];
    return control;
  }

  async function sincronizar(respuesta, indice = 0) {
    const cuota = extraerCuotaDiaria(respuesta);
    const ctrl = controlParaIndice(indice);
    if (!cuota || typeof ctrl.sincronizarProveedor !== 'function') return null;
    return ctrl.sincronizarProveedor({
      limite: cuota.limite,
      restantes: cuota.restantes,
      endpoint: respuesta?.config?.url || null
    });
  }

  async function reintentar(config, respuesta) {
    if (typeof instanciaAxios.request !== 'function' || !trafico.puedeReintentar(config)) return null;
    const { intento } = await trafico.esperarReintento(config, respuesta);
    return instanciaAxios.request({
      ...config,
      __apiRetryCount: intento,
      __apiQuotaReservada: false
    });
  }

  const request = instanciaAxios.interceptors.request.use(async config => {
    let url;
    try {
      url = new URL(config.url, config.baseURL);
    } catch {
      return config;
    }
    if (!url.hostname.endsWith('api-sports.io')) return config;

    await trafico.antesDeSolicitar();

    const esStatus = url.pathname.replace(/\/$/, '').endsWith('/status');
    if (!esStatus && !config.__apiQuotaReservada) {
      if (controlesporClave && claves.length > 1) {
        // Con failover por cuota: intentar reservar en la key activa; si está agotada,
        // intentar con la siguiente key automáticamente.
        let indiceElegido = Number.isInteger(config.__apiKeyIndex) ? config.__apiKeyIndex : 0;
        for (let i = indiceElegido; i < claves.length; i++) {
          try {
            await controlesporClave[i].reservar({ endpoint: url.pathname });
            config.__apiKeyIndex = i;
            break;
          } catch (err) {
            if (err.code !== 'API_FOOTBALL_DAILY_QUOTA_EXHAUSTED' || i === claves.length - 1) throw err;
            // Esta key está agotada, intentar la siguiente
          }
        }
      } else {
        await control.reservar({ endpoint: url.pathname });
      }
      config.__apiQuotaReservada = true;
    }
    if (claves.length) {
      const indice = Number.isInteger(config.__apiKeyIndex) ? config.__apiKeyIndex : 0;
      config.__apiKeyIndex = indice;
      config.headers = { ...(config.headers || {}), [ENCABEZADO_API_KEY]: claves[indice] };
    }
    return config;
  });

  const response = instanciaAxios.interceptors.response?.use(async respuesta => {
    const indice = Number.isInteger(respuesta?.config?.__apiKeyIndex)
      ? respuesta.config.__apiKeyIndex : 0;
    await sincronizar(respuesta, indice);
    if (esAgotamientoDiario(respuesta)) {
      const ctrl = controlParaIndice(indice);
      const estado = await ctrl.marcarAgotada({ endpoint: respuesta?.config?.url || null });
      // Con failover: si hay más keys disponibles, no lanzar error aún — el próximo request usará otra key
      if (permitirFailover && indice < claves.length - 1) {
        // Marcar pero no tirar; el siguiente request intentará key siguiente
        console.warn(`   ⚠️ Key ${indice + 1} agotada (API). Failover a key ${indice + 2} en próxima petición.`);
        return respuesta;
      }
      throw new CuotaApiAgotadaError(estado);
    }
    if (esLimiteTemporal(respuesta)) {
      const error = new ApiFootballRateLimitError();
      trafico.registrarFallo(error, { limitado: true });
      const nuevoIntento = await reintentar(respuesta?.config || {}, respuesta);
      if (nuevoIntento) return nuevoIntento;
      throw error;
    }
    const erroresProveedor = respuesta?.data?.errors;
    if (erroresProveedor && Object.keys(erroresProveedor).length > 0) {
      throw new ApiFootballProviderError(erroresProveedor);
    }
    trafico.registrarExito();
    return respuesta;
  }, async error => {
    const respuesta = error?.response;
    const configError = error?.config;
    if (!configError) throw error;

    const indiceActual = Number.isInteger(configError.__apiKeyIndex)
      ? configError.__apiKeyIndex : 0;

    const cuota = extraerCuotaDiaria(respuesta);
    await sincronizar(respuesta, indiceActual);
    const agotamientoDiario = esAgotamientoDiario(respuesta, cuota);
    if (agotamientoDiario) {
      const ctrl = controlParaIndice(indiceActual);
      const estado = await ctrl.marcarAgotada({ endpoint: configError.url || null });

      // Con failover: si hay otra key disponible, reintentar con ella
      const puedeFailoverCuota = permitirFailover &&
        indiceActual < claves.length - 1 &&
        typeof instanciaAxios.request === 'function';
      if (puedeFailoverCuota) {
        console.warn(`   ⚠️ Key ${indiceActual + 1} agotada. Failover a key ${indiceActual + 2}...`);
        return instanciaAxios.request({
          ...configError,
          __apiKeyIndex: indiceActual + 1,
          __apiQuotaReservada: false  // Forzar nueva reserva con la siguiente key
        });
      }
      throw new CuotaApiAgotadaError(estado);
    }

    const status = respuesta?.status;
    const puedeReintentarAutenticacion = permitirFailover &&
      [401, 403].includes(status) &&
      indiceActual < claves.length - 1 &&
      typeof instanciaAxios.request === 'function';
    if (puedeReintentarAutenticacion) {
      return instanciaAxios.request({
        ...configError,
        __apiKeyIndex: indiceActual + 1,
        __apiQuotaReservada: true
      });
    }

    if (esErrorTransitorio(error)) {
      const limitado = esLimiteTemporal(respuesta);
      trafico.registrarFallo(error, { limitado });
      const nuevoIntento = await reintentar(configError, respuesta);
      if (nuevoIntento) return nuevoIntento;
      if (limitado) {
        throw new ApiFootballRateLimitError(trafico.estado().reintentar_en_ms);
      }
    }
    throw error;
  });
  return { request, response };
}

module.exports = {
  ApiFootballProviderError,
  ApiFootballRateLimitError,
  CuotaApiAgotadaError,
  crearControlCuota,
  extraerCuotaDiaria,
  extraerCuotaMinuto,
  esAgotamientoDiario,
  esLimiteTemporal,
  instalarControlCuotaAxios,
  obtenerApiKeys,
  obtenerConfiguracion,
  obtenerDiaCuota,
  resumirUso
};

const LIMITE_RPS_PREDETERMINADO = 4;
const REINTENTOS_PREDETERMINADOS = 2;
const FALLOS_CIRCUITO_PREDETERMINADOS = 5;
const ENFRIAMIENTO_PREDETERMINADO_MS = 30_000;

class ApiFootballCircuitOpenError extends Error {
  constructor(reintentarEnMs) {
    super(`API-Football está temporalmente pausada; reintenta en ${Math.ceil(reintentarEnMs / 1000)} s.`);
    this.name = 'ApiFootballCircuitOpenError';
    this.code = 'API_FOOTBALL_CIRCUIT_OPEN';
    this.retryAfterMs = reintentarEnMs;
  }
}

function numeroEnRango(valor, fallback, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return fallback;
  return Math.min(Math.max(numero, minimo), maximo);
}

function enteroEnRango(valor, fallback, minimo, maximo) {
  return Math.trunc(numeroEnRango(valor, fallback, minimo, maximo));
}

function leerHeader(headers, nombre) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(nombre);
  const clave = Object.keys(headers).find(item => item.toLowerCase() === nombre.toLowerCase());
  return clave ? headers[clave] : undefined;
}

function esperaIndicadaMs(respuesta, ahora = Date.now()) {
  const valor = leerHeader(respuesta?.headers, 'retry-after');
  if (valor === undefined || valor === null || valor === '') return null;
  const segundos = Number(valor);
  if (Number.isFinite(segundos) && segundos >= 0) return Math.ceil(segundos * 1000);
  const fecha = Date.parse(String(valor));
  return Number.isFinite(fecha) ? Math.max(0, fecha - ahora) : null;
}

function crearControlTraficoApi({
  env = process.env,
  reloj = () => Date.now(),
  dormir = ms => new Promise(resolve => setTimeout(resolve, ms)),
  aleatorio = Math.random
} = {}) {
  // API-Football Pro permite 5/s y 300/min. El valor por defecto de 4/s deja
  // margen y, al serializar salidas, también limita a 240/min por proceso.
  const maxRps = numeroEnRango(env.API_FOOTBALL_MAX_RPS, LIMITE_RPS_PREDETERMINADO, 0.2, 5);
  const maxReintentos = enteroEnRango(
    env.API_FOOTBALL_MAX_RETRIES,
    REINTENTOS_PREDETERMINADOS,
    0,
    5
  );
  const fallosParaAbrir = enteroEnRango(
    env.API_FOOTBALL_CIRCUIT_FAILURES,
    FALLOS_CIRCUITO_PREDETERMINADOS,
    2,
    50
  );
  const enfriamientoMs = enteroEnRango(
    env.API_FOOTBALL_CIRCUIT_COOLDOWN_MS,
    ENFRIAMIENTO_PREDETERMINADO_MS,
    5_000,
    300_000
  );
  const intervaloMs = Math.ceil(1000 / maxRps);

  let cola = Promise.resolve();
  let proximaSalida = 0;
  let fallosConsecutivos = 0;
  let circuitoAbiertoHasta = 0;
  const metricas = {
    solicitudes: 0,
    reintentos: 0,
    limitadas: 0,
    fallos_transitorios: 0,
    circuitos_abiertos: 0,
    ultima_solicitud: null,
    ultimo_error: null
  };

  async function antesDeSolicitar() {
    const ahora = reloj();
    if (circuitoAbiertoHasta > ahora) {
      throw new ApiFootballCircuitOpenError(circuitoAbiertoHasta - ahora);
    }
    if (circuitoAbiertoHasta) {
      circuitoAbiertoHasta = 0;
      fallosConsecutivos = 0;
    }

    const turno = cola.then(async () => {
      const espera = Math.max(0, proximaSalida - reloj());
      if (espera) await dormir(espera);
      const salida = reloj();
      proximaSalida = salida + intervaloMs;
      metricas.solicitudes += 1;
      metricas.ultima_solicitud = new Date(salida).toISOString();
    });
    cola = turno.catch(() => {});
    return turno;
  }

  function registrarExito() {
    fallosConsecutivos = 0;
  }

  function registrarFallo(error, { limitado = false } = {}) {
    fallosConsecutivos += 1;
    metricas.fallos_transitorios += 1;
    if (limitado) metricas.limitadas += 1;
    metricas.ultimo_error = {
      codigo: error?.code || error?.response?.status || 'ERROR',
      fecha: new Date(reloj()).toISOString()
    };
    if (fallosConsecutivos >= fallosParaAbrir) {
      circuitoAbiertoHasta = reloj() + enfriamientoMs;
      metricas.circuitos_abiertos += 1;
    }
  }

  function puedeReintentar(config = {}) {
    return enteroEnRango(config.__apiRetryCount, 0, 0, 100) < maxReintentos;
  }

  async function esperarReintento(config = {}, respuesta) {
    const intento = enteroEnRango(config.__apiRetryCount, 0, 0, 100) + 1;
    const indicada = esperaIndicadaMs(respuesta, reloj());
    const exponencial = Math.min(30_000, 1000 * (2 ** (intento - 1)));
    const jitter = Math.floor(exponencial * 0.25 * aleatorio());
    const espera = Math.min(60_000, Math.max(indicada || 0, exponencial + jitter));
    metricas.reintentos += 1;
    await dormir(espera);
    return { intento, espera };
  }

  function estado() {
    const ahora = reloj();
    return {
      max_rps: maxRps,
      max_por_minuto_efectivo: Math.floor(maxRps * 60),
      intervalo_ms: intervaloMs,
      max_reintentos: maxReintentos,
      circuito: circuitoAbiertoHasta > ahora ? 'abierto' : 'cerrado',
      reintentar_en_ms: Math.max(0, circuitoAbiertoHasta - ahora),
      fallos_consecutivos: fallosConsecutivos,
      ...metricas
    };
  }

  return {
    antesDeSolicitar,
    registrarExito,
    registrarFallo,
    puedeReintentar,
    esperarReintento,
    estado
  };
}

const controlTraficoApi = crearControlTraficoApi();

module.exports = {
  ApiFootballCircuitOpenError,
  controlTraficoApi,
  crearControlTraficoApi,
  esperaIndicadaMs
};

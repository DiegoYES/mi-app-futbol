const { normalizarSeleccion } = require('./marketNormalizer');

const SENSIBLES = /token|authorization|cookie|password|secret|session|jwt/i;
const URL_RELEVANTE = /sport|event|fixture|match|market|selection|odds|price|bet/i;

function sanitizar(valor, profundidad = 0) {
  if (profundidad > 12) return '[TRUNCATED]';
  if (Array.isArray(valor)) return valor.slice(0, 2000).map(item => sanitizar(item, profundidad + 1));
  if (!valor || typeof valor !== 'object') return valor;
  return Object.fromEntries(Object.entries(valor).filter(([key]) => !SENSIBLES.test(key)).map(([key, item]) => [key, sanitizar(item, profundidad + 1)]));
}

function valor(objeto, nombres) {
  if (!objeto || typeof objeto !== 'object') return undefined;
  const mapa = new Map(Object.keys(objeto).map(key => [key.toLowerCase(), key]));
  for (const nombre of nombres) {
    const key = mapa.get(nombre.toLowerCase());
    if (key !== undefined && typeof objeto[key] !== 'object') return objeto[key];
    if (key !== undefined && objeto[key] && typeof objeto[key] === 'object') return objeto[key].name || objeto[key].label || objeto[key].title || objeto[key].id;
  }
  return undefined;
}

function extraerSelecciones(payload, metadata = {}) {
  const resultados = [];
  const vistos = new Set();
  function caminar(nodo, contexto = {}, profundidad = 0) {
    if (!nodo || profundidad > 18) return;
    if (Array.isArray(nodo)) return nodo.forEach(item => caminar(item, contexto, profundidad + 1));
    if (typeof nodo !== 'object') return;
    const actual = {
      ...contexto,
      eventId: valor(nodo, ['eventId', 'event_id', 'fixtureId', 'matchId']) ?? contexto.eventId,
      eventName: valor(nodo, ['eventName', 'fixtureName', 'matchName']) ?? contexto.eventName,
      homeTeam: valor(nodo, ['homeTeam', 'home', 'participantHome']) ?? contexto.homeTeam,
      awayTeam: valor(nodo, ['awayTeam', 'away', 'participantAway']) ?? contexto.awayTeam,
      startTime: valor(nodo, ['startTime', 'startDate', 'eventDate', 'kickoff']) ?? contexto.startTime,
      league: valor(nodo, ['leagueName', 'competitionName', 'tournamentName']) ?? contexto.league,
      sport: valor(nodo, ['sportName', 'sport']) ?? contexto.sport,
      marketId: valor(nodo, ['marketId', 'market_id']) ?? contexto.marketId,
      marketName: valor(nodo, ['marketName', 'market_name']) ?? contexto.marketName,
      player: valor(nodo, ['playerName', 'player']) ?? contexto.player,
      team: valor(nodo, ['teamName', 'team']) ?? contexto.team
    };
    const odds = valor(nodo, ['decimalOdds', 'odds', 'price']);
    const selectionName = valor(nodo, ['selectionName', 'outcomeName', 'runnerName', 'label', 'name']);
    if (odds !== undefined && selectionName && actual.marketName && (actual.eventName || (actual.homeTeam && actual.awayTeam))) {
      const raw = {
        ...actual, selectionName, odds,
        selectionId: valor(nodo, ['selectionId', 'outcomeId', 'runnerId', 'id']),
        line: valor(nodo, ['line', 'handicap', 'total']), status: valor(nodo, ['status', 'state']),
        suspended: nodo.suspended, active: nodo.active
      };
      const normalizada = normalizarSeleccion(raw);
      const clave = [normalizada.evento_externo_id, normalizada.mercado_externo_id, normalizada.seleccion_externa_id, normalizada.texto_origen].join('|');
      if (!vistos.has(clave)) { vistos.add(clave); resultados.push(normalizada); }
    }
    for (const item of Object.values(nodo)) if (item && typeof item === 'object') caminar(item, actual, profundidad + 1);
  }
  caminar(sanitizar(payload), metadata);
  return resultados;
}

function esRespuestaCandidata(url, contentType = '') {
  try {
    const parsed = new URL(url);
    return /json/i.test(contentType) && URL_RELEVANTE.test(`${parsed.pathname}${parsed.search}`);
  } catch { return false; }
}

module.exports = { esRespuestaCandidata, extraerSelecciones, sanitizar };

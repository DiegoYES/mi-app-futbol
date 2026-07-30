const { aplicarAlias, normalizarTexto } = require('./strings');
const { cuotaDecimal } = require('./odds');

function categoriaMercado(mercado, seleccion) {
  const texto = normalizarTexto(`${aplicarAlias('mercados', mercado)} ${seleccion}`);
  const jugador = /jugador|player/.test(texto);
  if (/tiros? (a puerta|al arco)|shots? on target|\bsot\b/.test(texto)) return jugador ? 'player_shots_on_target' : 'shots_on_target';
  if (/tiros?|disparos?|shots?/.test(texto)) return jugador ? 'player_shots' : 'shots';
  if (/tarjetas?|amonestaciones?|cards?|bookings?/.test(texto)) return jugador ? 'player_cards' : 'cards';
  if (/faltas?|fouls?/.test(texto)) return jugador ? 'player_fouls' : 'fouls';
  if (/corners?|tiros? de esquina/.test(texto)) return 'corners';
  if (/goles?|goals?/.test(texto)) return 'goals';
  if (/ambos.*anotan|both teams.*score/.test(texto)) return 'both_teams_score';
  return 'unknown';
}

function ladoSeleccion(texto) {
  const valor = normalizarTexto(texto);
  if (/\b(mas|over)\b/.test(valor)) return 'OVER';
  if (/\b(menos|under)\b/.test(valor)) return 'UNDER';
  if (/\b(si|yes)\b/.test(valor)) return 'YES';
  if (/\b(no)\b/.test(valor)) return 'NO';
  if (/\b(empate|draw)\b/.test(valor)) return 'DRAW';
  return 'OTHER';
}

function obtenerLinea(raw, texto) {
  const directa = Number(raw.line ?? raw.handicap ?? raw.total);
  if (Number.isFinite(directa)) return directa;
  const match = String(texto).match(/(?:más|mas|over|menos|under)\s*(?:de\s*)?([0-9]+(?:[.,][0-9]+)?)/i);
  return match ? Number(match[1].replace(',', '.')) : null;
}

function estadoSeleccion(raw, cuota) {
  const texto = normalizarTexto(raw.status || raw.state || '');
  if (raw.suspended === true || /suspend/.test(texto)) return 'SUSPENDED';
  if (/open|active|abierto/.test(texto) || raw.active === true) return 'OPEN';
  if (/closed|cerrado/.test(texto) || raw.active === false) return 'CLOSED';
  // Una selección publicada con precio decimal válido se considera operable si
  // el proveedor no envía un campo de estado. No se hace esta inferencia sin cuota.
  if (cuota) return 'OPEN';
  return 'UNKNOWN';
}

function obtenerJugador(raw, mercado, seleccion, categoria) {
  if (raw.player) return String(raw.player).trim() || null;
  if (!categoria.startsWith('player_')) return null;
  const limpiar = valor => String(valor || '')
    .replace(/\b(m[aá]s(?:\s+de)?|over|menos(?:\s+de)?|under)\s*[0-9]+(?:[.,][0-9]+)?\b.*$/i, '')
    .replace(/\b(tarjetas?|amonestaciones?|cards?|bookings?|tiros? a puerta|tiros? al arco|shots? on target|sot|tiros?|disparos?|shots?|faltas?|fouls?|jugador|player)\b/gi, ' ')
    .replace(/^[\s|:\-–—]+|[\s|:\-–—]+$/g, '').replace(/\s+/g, ' ').trim();
  const desdeSeleccion = limpiar(seleccion);
  if (desdeSeleccion && normalizarTexto(desdeSeleccion) !== normalizarTexto(seleccion)) return desdeSeleccion;
  const partes = String(mercado || '').split(/\s[-–—|:]\s/).map(limpiar).filter(Boolean);
  return partes.find(item => item.split(/\s+/).length >= 2) || null;
}

function normalizarSeleccion(raw, proveedor = 'playdoit') {
  const mercado = raw.marketName || raw.market || '';
  const seleccion = raw.selectionName || raw.selection || raw.name || '';
  const sourceText = [raw.eventName, mercado, seleccion].filter(Boolean).join(' | ').slice(0, 1000);
  const categoria = categoriaMercado(mercado, seleccion);
  const lado = ladoSeleccion(seleccion);
  const linea = obtenerLinea(raw, `${mercado} ${seleccion}`);
  const cuota = cuotaDecimal(raw.odds ?? raw.price ?? raw.decimalOdds);
  const jugador = obtenerJugador(raw, mercado, seleccion, categoria);
  const problemas = [];
  if (categoria === 'unknown') problemas.push('MARKET_NOT_NORMALIZED');
  if (!cuota) problemas.push('ODDS_NOT_AVAILABLE');
  if (['OVER', 'UNDER'].includes(lado) && !Number.isFinite(linea)) problemas.push('LINE_NOT_AVAILABLE');
  return {
    proveedor, evento_externo_id: String(raw.eventId || raw.fixtureId || ''),
    mercado_externo_id: String(raw.marketId || ''), seleccion_externa_id: String(raw.selectionId || raw.id || ''),
    evento_nombre: raw.eventName || `${raw.homeTeam || ''} vs ${raw.awayTeam || ''}`.trim(),
    local: raw.homeTeam || null, visitante: raw.awayTeam || null, inicio: raw.startTime || null,
    deporte: raw.sport || 'football', liga: raw.league || null, jugador, equipo: raw.team || null,
    mercado: mercado || seleccion, categoria, lado, linea, cuota, estado: estadoSeleccion(raw, cuota),
    texto_origen: sourceText || JSON.stringify(raw).slice(0, 1000), ambiguo: false, problemas
  };
}

module.exports = { categoriaMercado, ladoSeleccion, normalizarSeleccion, obtenerJugador, obtenerLinea };

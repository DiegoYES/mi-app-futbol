function aplicarAnchos(raiz = document) { raiz.querySelectorAll("[data-width]").forEach(el => { el.style.width = Math.max(0, Math.min(100, Number(el.dataset.width) || 0)) + "%"; }); }

const params = new URLSearchParams(location.search);
const ID_LOCAL = parseInt(params.get('local'));
const ID_VISITANTE = parseInt(params.get('visitante'));
const ID_LIGA = parseInt(params.get('liga'));
const ID_PARTIDO = params.get('partido');

let datosLocal = null;
let datosVisitante = null;
let datosPicksPartido = null;
const filtrosMercado = { categoria: 'todas', familia: 'todas', alcance: '', tipo: '', linea: '', periodo: 0 };
let temporadaPartido = null;
const INTERVALO_ACTUALIZACION_PARTIDO_MS = 120000;
let ultimaCargaPartido = 0;
let estadoPartidoActual = null;
let refrescandoPartido = false;
const CLAVE_FORMATO_FRECUENCIA = 'football-stats-display-mode';
let formatoFrecuencia = localStorage.getItem(CLAVE_FORMATO_FRECUENCIA) === 'count' ? 'count' : 'percent';

const NOMBRES_CATEGORIAS = {
  goles: 'Goles', resultado: 'Resultado', corners: 'Córners', tarjetas: 'Tarjetas',
  tiros: 'Tiros', tiros_puerta: 'Tiros a puerta', faltas: 'Faltas', offsides: 'Fueras de juego'
};

function pct(v) { return v == null ? '0.0' : v; }

function esc(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function abrirPestana(nombre) {
  document.querySelectorAll('[data-match-tab]').forEach(boton => boton.classList.toggle('active', boton.dataset.matchTab === nombre));
  document.querySelectorAll('[data-match-panel]').forEach(panel => { panel.hidden = panel.dataset.matchPanel !== nombre; });
  history.replaceState(null, '', `#${nombre}`);
}

function valorPartido(valor, sufijo = '') {
  return valor === null || valor === undefined || valor === '' ? '—' : `${valor}${sufijo}`;
}

function iconoEvento(tipo) {
  return ({ Gol: '⚽', Tarjeta: '🟨', 'Sustitución': '🔁', VAR: '▣' })[tipo] || '•';
}

function datoJugador(valor, sufijo = '') {
  return valor === null || valor === undefined || valor === '' ? '—' : `${valor}${sufijo}`;
}

function fotoJugador(jugador) {
  return jugador.foto
    ? `<img src="${esc(jugador.foto)}" alt="Foto de ${esc(jugador.nombre)}" loading="lazy">`
    : '<span class="match-player-photo-fallback" aria-hidden="true">10</span>';
}

function tarjetaJugadorPartido(jugador) {
  const estadisticas = [
    ['Minutos', jugador.minutos],
    ['Goles', jugador.goles],
    ['Asistencias', jugador.asistencias],
    ['Tiros / puerta', `${datoJugador(jugador.tiros)} / ${datoJugador(jugador.tiros_puerta)}`],
    ['Pases', jugador.pases],
    ['Precisión', datoJugador(jugador.precision_pases, '%')],
    ['Pases clave', jugador.pases_clave],
    ['Duelos ganados', `${datoJugador(jugador.duelos_ganados)} / ${datoJugador(jugador.duelos)}`],
    ['Regates exitosos', `${datoJugador(jugador.regates_exitosos)} / ${datoJugador(jugador.regates)}`],
    ['Entradas', jugador.entradas],
    ['Intercepciones', jugador.intercepciones],
    ['Faltas recibidas', jugador.faltas_recibidas],
    ['Faltas cometidas', jugador.faltas_cometidas],
    ['Tarjetas', `${datoJugador(jugador.amarillas)} amar. · ${datoJugador(jugador.rojas)} rojas`],
    ['Atajadas', jugador.atajadas],
    ['Offsides', jugador.offsides]
  ];
  const rol = [jugador.numero ? `#${jugador.numero}` : '', jugador.posicion, jugador.titular ? 'Titular' : 'Suplente', jugador.capitan ? 'Capitán' : ''].filter(Boolean).join(' · ');
  return `<details class="match-player">
    <summary><span class="match-player-summary">${fotoJugador(jugador)}</span><span class="match-player-summary"><strong>${esc(jugador.nombre)}</strong><small>${esc(rol)}</small></span><span class="match-player-score"><b>${datoJugador(jugador.calificacion)}</b><small>${jugador.goles || jugador.asistencias ? `${jugador.goles || 0} G · ${jugador.asistencias || 0} A` : 'Ver detalle +'}</small></span></summary>
    <div class="match-player-stats">${estadisticas.map(([nombre, valor]) => `<span>${esc(nombre)}<b>${esc(datoJugador(valor))}</b></span>`).join('')}</div>
  </details>`;
}

function pintarJugadoresPartido(partido) {
  const jugadores = partido.jugadores || [];
  if (!jugadores.length) return '<div class="warning">Este partido no tiene estadísticas individuales entregadas por el proveedor.</div>';
  const destacado = partido.jugador_destacado;
  const mvp = destacado ? `<a class="match-mvp" href="/jugador.html?id=${destacado.id}&league=${partido.liga_id}${partido.temporada ? `&season=${partido.temporada}` : ''}">
    ${fotoJugador(destacado)}<span class="match-mvp-copy"><span>Jugador destacado</span><strong>${esc(destacado.nombre)}</strong><small>${esc(destacado.equipo?.nombre || '')} · ${esc(destacado.criterio)}</small></span><span class="match-mvp-rating"><b>${datoJugador(destacado.calificacion)}</b><span>${destacado.calificacion ? 'Calificación' : `${destacado.goles || 0} G · ${destacado.asistencias || 0} A`}</span></span>
  </a>` : '';
  const equipos = [partido.equipo_local, partido.equipo_visitante];
  return `${mvp}<div class="match-player-teams">${equipos.map(equipo => {
    const plantel = jugadores.filter(jugador => jugador.equipo?.id === equipo.id);
    return `<section class="match-player-team"><h5>${esc(equipo.nombre)} · ${plantel.length} jugadores</h5><div class="match-player-list">${plantel.map(tarjetaJugadorPartido).join('')}</div></section>`;
  }).join('')}</div>`;
}

function pintarEstadisticasPartido(partido, finalizado) {
  const cont = document.getElementById('estadisticasPartido');
  const local = partido.equipo_local;
  const visitante = partido.equipo_visitante;
  if (!finalizado) {
    cont.innerHTML = `<div class="aviso"><strong>Las estadísticas estarán disponibles cuando finalice el partido.</strong><br>Mientras tanto puedes consultar la forma, los picks y los enfrentamientos previos.</div>`;
    return;
  }
  const metricas = [
    ['Goles', local.goles, visitante.goles, ''],
    ['Posesión', local.posesion, visitante.posesion, '%'],
    ['Tiros totales', local.tiros_total, visitante.tiros_total, ''],
    ['Tiros a puerta', local.tiros_puerta, visitante.tiros_puerta, ''],
    ['Córners', local.corners, visitante.corners, ''],
    ['Faltas', local.faltas, visitante.faltas, ''],
    ['Tarjetas amarillas', local.tarjetas_amarillas, visitante.tarjetas_amarillas, ''],
    ['Tarjetas rojas', local.tarjetas_rojas, visitante.tarjetas_rojas, ''],
    ['Fueras de juego', local.offsides, visitante.offsides, '']
  ].filter(([, a, b]) => a !== null && a !== undefined || b !== null && b !== undefined);

  const filas = metricas.map(([nombre, a, b, sufijo]) => {
    const na = Number(a) || 0;
    const nb = Number(b) || 0;
    const total = na + nb;
    const anchoLocal = total ? (na / total) * 100 : 50;
    return `<div class="actual-stat-row">
      <b>${valorPartido(a, sufijo)}</b>
      <div class="actual-stat-label"><span>${esc(nombre)}</span><div class="actual-stat-bar"><i class="home" data-width="${anchoLocal}"></i><i class="away" data-width="${100 - anchoLocal}"></i></div></div>
      <b>${valorPartido(b, sufijo)}</b>
    </div>`;
  }).join('');

  const hechos = [
    ['Jornada', partido.jornada],
    ['Árbitro', partido.arbitro],
    ['Formaciones', local.formacion || visitante.formacion ? `${local.formacion || '—'} · ${visitante.formacion || '—'}` : null]
  ].filter(([, valor]) => valor);
  const eventos = (partido.eventos || []).map(evento => {
    const protagonistas = [evento.jugador, evento.asistencia ? `Asist. ${evento.asistencia}` : ''].filter(Boolean).join(' · ');
    return `<div class="match-event"><time>${Number(evento.minuto) || 0}'</time><span class="event-icon">${iconoEvento(evento.tipo_evento)}</span><div><strong>${esc(evento.equipo)} · ${esc(evento.tipo_evento)}</strong>${protagonistas || evento.detalle ? `<small>${esc(protagonistas || evento.detalle)}</small>` : ''}</div></div>`;
  }).join('');

  cont.innerHTML = `
    <div class="actual-score-head"><strong>${esc(local.nombre)}</strong><span>Métrica</span><strong>${esc(visitante.nombre)}</strong></div>
    <section class="player-match-block"><h4>Rendimiento de los jugadores</h4><p>Abre un jugador para consultar todas sus estadísticas en este partido.</p>${pintarJugadoresPartido(partido)}</section>
    <div class="actual-stat-list">${filas}</div>
    ${partido.cobertura?.estadisticas ? '' : '<p class="method-note">El proveedor sólo entregó el marcador para este encuentro; las estadísticas avanzadas no están disponibles.</p>'}
    ${hechos.length ? `<div class="match-facts">${hechos.map(([nombre, valor]) => `<div><span>${esc(nombre)}</span><strong>${esc(valor)}</strong></div>`).join('')}</div>` : ''}
    ${eventos ? `<div class="event-timeline"><h4>Momentos del partido</h4>${eventos}</div>` : ''}`;
  aplicarAnchos(cont);
}

async function pedir(url) {
  const r = await fetch(url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}

async function cargarCabecera() {
  const cont = document.getElementById('cabecera');

  let partido = null;
  if (ID_PARTIDO) partido = await pedir(`/api/partidos/${ID_PARTIDO}/estadisticas`);
  temporadaPartido = Number.isInteger(Number(partido?.temporada)) ? Number(partido.temporada) : null;
  estadoPartidoActual = partido?.estado || null;
  ultimaCargaPartido = Date.now();

  const nombreL = partido?.equipo_local?.nombre || datosLocal?.info?.equipo || 'Local';
  const nombreV = partido?.equipo_visitante?.nombre || datosVisitante?.info?.equipo || 'Visitante';
  document.getElementById('labelAlcanceLocal').textContent = `Condición de ${nombreL}`;
  document.getElementById('labelAlcanceVisitante').textContent = `Condición de ${nombreV}`;

  const tieneMarcador = partido?.equipo_local?.goles != null && partido?.equipo_visitante?.goles != null;
  const jugado = Boolean(partido && (FutbolMarcador.esFinalizado(partido.estado) || tieneMarcador));
  // El marcador grande nunca incluye la tanda: los penales deciden quién
  // avanza, no el resultado con el que se liquidan los mercados.
  const tanda = FutbolMarcador.penalesDe(partido);
  const prorroga = FutbolMarcador.prorrogaDe(partido);
  const detalleFinal = partido?.estado === 'PEN'
    ? 'Definido en penales'
    : partido?.estado === 'AET' ? 'Finalizado en tiempo extra' : 'Finalizado';
  const centro = jugado
    ? `<div class="res">${partido.equipo_local.goles} - ${partido.equipo_visitante.goles}</div>
       ${tanda ? `<div class="res-penales">${tanda.local} - ${tanda.visitante} en penales</div>` : ''}
       ${prorroga && !tanda ? `<div class="res-penales">${prorroga.local} - ${prorroga.visitante} en la prórroga</div>` : ''}
       <div class="meta">${detalleFinal}</div>`
    : `<div class="vs">VS</div><div class="meta">${FutbolMarcador.esEstadoAtrasado(partido) ? 'Estado sin confirmar' : 'Por jugarse'}</div>`;

  document.title = `${nombreL} vs ${nombreV} · Match Center`;
  cont.innerHTML = `
    <a class="lado" href="/equipo.html?id=${ID_LOCAL}&league=${ID_LIGA}${temporadaPartido ? `&season=${temporadaPartido}` : ''}">
      <img src="/api/equipos/${ID_LOCAL}/escudo" alt="Escudo de ${esc(nombreL)}">
      <h2>${esc(nombreL)}</h2><span class="rol">Local</span>
    </a>
    <div class="centro">
      ${centro}
      <div class="meta">${esc(partido?.liga || datosLocal?.info?.liga || '')}</div>
      ${partido?.fecha ? `<div class="meta">${new Date(partido.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</div>` : ''}
    </div>
    <a class="lado" href="/equipo.html?id=${ID_VISITANTE}&league=${ID_LIGA}${temporadaPartido ? `&season=${temporadaPartido}` : ''}">
      <img src="/api/equipos/${ID_VISITANTE}/escudo" alt="Escudo de ${esc(nombreV)}">
      <h2>${esc(nombreV)}</h2><span class="rol">Visitante</span>
    </a>`;

  if (partido) pintarEstadisticasPartido(partido, jugado);
}

function filaComparativa(etiqueta, a, b, sufijo = '', mayorEsMejor = true, textoA = null, textoB = null) {
  const tieneA = a !== null && a !== undefined && a !== '' && Number.isFinite(Number(a));
  const tieneB = b !== null && b !== undefined && b !== '' && Number.isFinite(Number(b));
  const na = tieneA ? Number(a) : 0;
  const nb = tieneB ? Number(b) : 0;
  const total = na + nb;
  const anchoA = tieneA && tieneB && total ? (na / total) * 100 : 50;
  const mejorA = tieneA && tieneB && (mayorEsMejor ? na > nb : na < nb);
  const mejorB = tieneA && tieneB && (mayorEsMejor ? nb > na : nb < na);
  const mostrarA = tieneA ? (textoA ?? `${a}${sufijo}`) : '—';
  const mostrarB = tieneB ? (textoB ?? `${b}${sufijo}`) : '—';

  return `<tr>
    <td class="val ${mejorA ? 'mejor' : ''}">${mostrarA}</td>
    <td class="metrica">${etiqueta}
      <div class="barra-comp"><i class="a" data-width="${anchoA}"></i><i class="b" data-width="${100 - anchoA}"></i></div>
    </td>
    <td class="val ${mejorB ? 'mejor' : ''}">${mostrarB}</td>
  </tr>`;
}

function filaFrecuencia(etiqueta, valorA, valorB, muestraA, muestraB, mayorEsMejor = true) {
  const textoA = formatoFrecuencia === 'count' ? `${valorA?.total ?? 0} de ${muestraA}` : null;
  const textoB = formatoFrecuencia === 'count' ? `${valorB?.total ?? 0} de ${muestraB}` : null;
  return filaComparativa(
    etiqueta,
    valorA?.porcentaje ?? null,
    valorB?.porcentaje ?? null,
    formatoFrecuencia === 'percent' ? '%' : '',
    mayorEsMejor,
    textoA,
    textoB
  );
}

function cambiarFormatoFrecuencia(valor) {
  formatoFrecuencia = valor === 'count' ? 'count' : 'percent';
  localStorage.setItem(CLAVE_FORMATO_FRECUENCIA, formatoFrecuencia);
  pintarComparacion();
}

function seccionComparativa(titulo, detalle = '') {
  return `<tr class="comp-section"><td colspan="3">${esc(titulo)}${detalle ? `<small>${esc(detalle)}</small>` : ''}</td></tr>`;
}

function numeroComparativo(valor) {
  return valor == null ? null : Number(valor).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pintarComparacion() {
  const cont = document.getElementById('tablaComparacion');
  if (!datosLocal || !datosVisitante) {
    cont.innerHTML = '<div class="aviso">No hay datos suficientes para comparar</div>';
    return;
  }

  const a = datosLocal.stats;
  const b = datosVisitante.stats;

  if (!a.jugados && !b.jugados) {
    cont.innerHTML = '<div class="aviso">Ninguno de los dos equipos tiene partidos registrados con estos filtros</div>';
    return;
  }

  const formaA = (datosLocal.partidos || []).slice(0, 5).map(p => `<span class="${p.resultado}">${p.resultado}</span>`).join('');
  const formaB = (datosVisitante.partidos || []).slice(0, 5).map(p => `<span class="${p.resultado}">${p.resultado}</span>`).join('');

  const promGolesA = a.jugados ? (a.golesFavor / a.jugados).toFixed(2) : '0.00';
  const promGolesB = b.jugados ? (b.golesFavor / b.jugados).toFixed(2) : '0.00';
  const promContraA = a.jugados ? (a.golesContra / a.jugados).toFixed(2) : '0.00';
  const promContraB = b.jugados ? (b.golesContra / b.jugados).toFixed(2) : '0.00';
  const avanzadaA = a.avanzadas || { muestra: 0, promedios: {}, cornersOver95: null };
  const avanzadaB = b.avanzadas || { muestra: 0, promedios: {}, cornersOver95: null };
  const aa = avanzadaA.promedios || {};
  const ab = avanzadaB.promedios || {};

  cont.innerHTML = `
    <table class="comp">
      <thead><tr>
        <th>${esc(datosLocal.info.equipo)}</th><th>Métrica</th><th>${esc(datosVisitante.info.equipo)}</th>
      </tr></thead>
      <tbody>
        ${seccionComparativa('Forma y resultados', `${a.jugados} vs ${b.jugados} partidos`)}
        <tr>
          <td class="val"><div class="forma">${formaA || '—'}</div></td>
          <td class="metrica">Últimos 5</td>
          <td class="val"><div class="forma">${formaB || '—'}</div></td>
        </tr>
        ${filaComparativa('Partidos jugados', a.jugados, b.jugados)}
        ${filaComparativa('Ganados', a.ganados, b.ganados)}
        ${filaComparativa('Empatados', a.empatados, b.empatados)}
        ${filaComparativa('Perdidos', a.perdidos, b.perdidos, '', false)}
        ${filaComparativa('Goles a favor', a.golesFavor, b.golesFavor)}
        ${filaComparativa('Goles en contra', a.golesContra, b.golesContra, '', false)}
        ${filaComparativa('Promedio goles a favor', promGolesA, promGolesB)}
        ${filaComparativa('Promedio goles en contra', promContraA, promContraB, '', false)}
        ${seccionComparativa('Mercados de goles', 'frecuencia en la muestra seleccionada')}
        ${filaFrecuencia('Over 0.5', a.over05, b.over05, a.jugados, b.jugados)}
        ${filaFrecuencia('Over 1.5', a.over15, b.over15, a.jugados, b.jugados)}
        ${filaFrecuencia('Over 2.5', a.over25, b.over25, a.jugados, b.jugados)}
        ${filaFrecuencia('Over 3.5', a.over35, b.over35, a.jugados, b.jugados)}
        ${filaFrecuencia('Under 0.5', a.under05, b.under05, a.jugados, b.jugados)}
        ${filaFrecuencia('Under 1.5', a.under15, b.under15, a.jugados, b.jugados)}
        ${filaFrecuencia('Under 2.5', a.under25, b.under25, a.jugados, b.jugados)}
        ${filaFrecuencia('Under 3.5', a.under35, b.under35, a.jugados, b.jugados)}
        ${filaFrecuencia('TT +1.5 a favor', a.equipoOver15, b.equipoOver15, a.jugados, b.jugados)}
        ${filaFrecuencia('TT +1.5 en contra', a.rivalOver15, b.rivalOver15, a.jugados, b.jugados, false)}
        ${filaFrecuencia('Ambos anotan', a.btts, b.btts, a.jugados, b.jugados)}
        ${seccionComparativa('Producción avanzada', `cobertura ${avanzadaA.muestra}/${a.jugados} vs ${avanzadaB.muestra}/${b.jugados}`)}
        ${filaComparativa('Tarjetas registradas (prom.)', numeroComparativo(aa.tarjetasFavor), numeroComparativo(ab.tarjetasFavor), '', false)}
        ${filaComparativa('Córners a favor (prom.)', numeroComparativo(aa.cornersFavor), numeroComparativo(ab.cornersFavor))}
        ${filaComparativa('Córners en contra (prom.)', numeroComparativo(aa.cornersContra), numeroComparativo(ab.cornersContra), '', false)}
        ${filaComparativa('Córners totales (prom.)', numeroComparativo(aa.cornersTotales), numeroComparativo(ab.cornersTotales))}
        ${filaFrecuencia(
          'Córners over 9.5',
          avanzadaA.cornersOver95,
          avanzadaB.cornersOver95,
          avanzadaA.muestras?.cornersTotales ?? avanzadaA.muestra,
          avanzadaB.muestras?.cornersTotales ?? avanzadaB.muestra
        )}
        ${filaComparativa('Tiros a favor (prom.)', numeroComparativo(aa.tirosFavor), numeroComparativo(ab.tirosFavor))}
        ${filaComparativa('Tiros concedidos (prom.)', numeroComparativo(aa.tirosContra), numeroComparativo(ab.tirosContra), '', false)}
        ${filaComparativa('Tiros a puerta (prom.)', numeroComparativo(aa.tirosPuertaFavor), numeroComparativo(ab.tirosPuertaFavor))}
        ${filaComparativa('Tiros a puerta concedidos (prom.)', numeroComparativo(aa.tirosPuertaContra), numeroComparativo(ab.tirosPuertaContra), '', false)}
        ${filaComparativa('Faltas (prom.)', numeroComparativo(aa.faltasFavor), numeroComparativo(ab.faltasFavor), '', false)}
        ${filaComparativa('Fueras de juego (prom.)', numeroComparativo(aa.offsidesFavor), numeroComparativo(ab.offsidesFavor), '', false)}
      </tbody>
    </table>
    <p class="comparison-note">Los promedios avanzados solo usan partidos con cobertura confirmada. “Tarjetas registradas” suma amarillas y rojas simples; una casa de apuestas puede aplicar reglas de puntuación distintas.</p>`;
  aplicarAnchos(cont);
}

async function cargarH2H() {
  const cont = document.getElementById('bloqueH2H');
  const datos = await pedir(`/api/equipos/h2h?team1=${ID_LOCAL}&team2=${ID_VISITANTE}`);

  if (!datos || !datos.total) {
    cont.innerHTML = '<div class="aviso">No hay enfrentamientos previos registrados entre estos equipos</div>';
    return;
  }

  const nombreL = datosLocal?.info?.equipo || 'Local';
  const nombreV = datosVisitante?.info?.equipo || 'Visitante';

  cont.innerHTML = `
    <div class="h2h-resumen">
      <div><div class="n">${datos.victoriasTeam1}</div><div class="l">Gana ${esc(nombreL)}</div></div>
      <div><div class="n">${datos.empates}</div><div class="l">Empates</div></div>
      <div><div class="n">${datos.victoriasTeam2}</div><div class="l">Gana ${esc(nombreV)}</div></div>
    </div>
    <p style="color:var(--muted);font-size:.84rem;margin:0 0 12px">
      ${datos.total} enfrentamiento(s) · Goles ${esc(nombreL)} ${datos.golesTeam1} — ${datos.golesTeam2} ${esc(nombreV)}
    </p>
    <ul class="lista-h2h">
      ${datos.ultimos.map(u => `<li class="h2h-game">
        <button type="button" class="h2h-game-summary" data-h2h-details="${Number(u.api_id)}" aria-expanded="false" aria-controls="h2h-details-${Number(u.api_id)}">
          <span class="fecha">${new Date(u.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          <span class="h2h-score">${esc(u.local)} <strong>${esc(u.marcador)}</strong> ${esc(u.visitante)}</span>
          <span class="fecha h2h-league">${esc(u.liga)}</span>
          <span class="h2h-action">Ver estadísticas +</span>
        </button>
        <div class="h2h-game-details" id="h2h-details-${Number(u.api_id)}" hidden></div>
      </li>`).join('')}
    </ul>`;
}

function valorH2H(valor, sufijo = '') {
  return valor === null || valor === undefined || valor === '' ? '—' : `${valor}${sufijo}`;
}

async function alternarDetalleH2H(boton) {
  const partidoId = Number(boton.dataset.h2hDetails);
  const panel = document.getElementById(`h2h-details-${partidoId}`);
  if (!panel) return;
  const abrir = panel.hidden;
  panel.hidden = !abrir;
  boton.setAttribute('aria-expanded', String(abrir));
  boton.querySelector('.h2h-action').textContent = abrir ? 'Ocultar −' : 'Ver estadísticas +';
  if (!abrir || panel.dataset.loaded === 'true') return;

  panel.innerHTML = '<div class="loader">Cargando estadísticas del partido…</div>';
  const datos = await pedir(`/api/partidos/${partidoId}/estadisticas`);
  if (!datos) {
    panel.innerHTML = '<div class="aviso">No se pudieron cargar las estadísticas.</div>';
    return;
  }
  const local = datos.equipo_local;
  const visitante = datos.equipo_visitante;
  const metricas = [
    ['Goles', local.goles, visitante.goles, ''],
    ['Tiros', local.tiros_total, visitante.tiros_total, ''],
    ['Tiros a puerta', local.tiros_puerta, visitante.tiros_puerta, ''],
    ['Córners', local.corners, visitante.corners, ''],
    ['Faltas', local.faltas, visitante.faltas, ''],
    ['Amarillas', local.tarjetas_amarillas, visitante.tarjetas_amarillas, ''],
    ['Rojas', local.tarjetas_rojas, visitante.tarjetas_rojas, ''],
    ['Fueras de juego', local.offsides, visitante.offsides, ''],
    ['Posesión', local.posesion, visitante.posesion, '%']
  ];
  panel.innerHTML = `
    <div class="h2h-stats-grid">
      ${metricas.map(([nombre, a, b, sufijo]) => `<div class="h2h-stat"><b>${valorH2H(a, sufijo)}</b><span>${nombre}</span><b>${valorH2H(b, sufijo)}</b></div>`).join('')}
    </div>
    ${datos.cobertura?.estadisticas ? '' : '<p class="method-note">Este partido sólo tiene marcador confirmado; las estadísticas avanzadas no fueron entregadas por el proveedor.</p>'}
    <div class="h2h-detail-actions"><a href="/partido.html?local=${local.id}&visitante=${visitante.id}&liga=${datos.liga_id}&partido=${partidoId}#comparacion">Abrir partido completo →</a></div>`;
  panel.dataset.loaded = 'true';
}

function filtrarMercados(datos) {
  const linea = filtrosMercado.linea === '' || filtrosMercado.linea === null ? null : Number(filtrosMercado.linea);
  return datos.mercados.filter(item => (
    (filtrosMercado.categoria === 'todas' || item.categoria === filtrosMercado.categoria)
    && (!filtrosMercado.alcance || item.alcance === filtrosMercado.alcance)
    && (!filtrosMercado.tipo || item.tipo === filtrosMercado.tipo)
    && Number.isFinite(item.linea)
    && (linea === null || item.linea === linea)
  ));
}

function prepararFiltrosMercado(datos) {
  const obtenerLineas = () => [...new Set(datos.mercados.filter(item => (
    (filtrosMercado.categoria === 'todas' || item.categoria === filtrosMercado.categoria)
    && (!filtrosMercado.alcance || item.alcance === filtrosMercado.alcance)
    && (!filtrosMercado.tipo || item.tipo === filtrosMercado.tipo)
    && Number.isFinite(item.linea)
  )).map(item => item.linea))].sort((a, b) => a - b);
  let lineas = obtenerLineas();
  if (!lineas.length && filtrosMercado.alcance && filtrosMercado.alcance !== 'total') {
    filtrosMercado.alcance = 'total';
    lineas = obtenerLineas();
  }
  if (filtrosMercado.linea !== '' && !lineas.includes(Number(filtrosMercado.linea))) {
    filtrosMercado.linea = lineas.includes(1.5) ? 1.5 : lineas[0];
  }
  return { lineas };
}

function pintarPicksPartido() {
  const cont = document.getElementById('bloquePicks');
  const datos = datosPicksPartido;
  const categoriasExplorables = datos.categorias.filter(categoria => datos.mercados.some(item => item.categoria === categoria && Number.isFinite(item.linea) && item.tipo));
  const recomendados = new Set(datos.recomendados || []);
  const opciones = prepararFiltrosMercado(datos);
  const mercados = filtrarMercados(datos);
  cont.innerHTML = `
    ${datos.motivo_no_guardable ? `<div class="warning">${esc(datos.motivo_no_guardable)}</div>` : ''}
    <section class="market-explorer">
      <h4>Explora los picks de este partido</h4>
      <p>Elige la categoría, dirección y línea exacta que viste en tu casa para comparar la estimación del modelo.</p>
      <div class="market-explorer-controls">
        <label>Categoría<select id="categoriaPicksPartido" aria-label="Categoría de mercado">
          <option value="todas" ${filtrosMercado.categoria === 'todas' ? 'selected' : ''}>Todas</option>
          ${categoriasExplorables.map(item => `<option value="${esc(item)}" ${item === filtrosMercado.categoria ? 'selected' : ''}>${esc(NOMBRES_CATEGORIAS[item] || item)}</option>`).join('')}
        </select></label>
        <label>Periodo<select id="periodoMercadoPartido">
          <option value="0" ${filtrosMercado.periodo === 0 ? 'selected' : ''}>Partido completo</option>
          <option value="1" ${filtrosMercado.periodo === 1 ? 'selected' : ''}>Primer tiempo</option>
          <option value="2" ${filtrosMercado.periodo === 2 ? 'selected' : ''}>Segundo tiempo</option>
        </select></label>
        <label>Alcance<select id="alcanceMercadoPartido">
          <option value="" ${filtrosMercado.alcance === '' ? 'selected' : ''}>Todos los alcances</option>
          <option value="total" ${filtrosMercado.alcance === 'total' ? 'selected' : ''}>Ambos equipos</option>
          <option value="local" ${filtrosMercado.alcance === 'local' ? 'selected' : ''}>Equipo local</option>
          <option value="visitante" ${filtrosMercado.alcance === 'visitante' ? 'selected' : ''}>Equipo visitante</option>
        </select></label>
        <label>Dirección<select id="tipoMercadoPartido">
          <option value="" ${filtrosMercado.tipo === '' ? 'selected' : ''}>Over y Under</option>
          <option value="over" ${filtrosMercado.tipo === 'over' ? 'selected' : ''}>Over · Más de</option>
          <option value="under" ${filtrosMercado.tipo === 'under' ? 'selected' : ''}>Under · Menos de</option>
        </select></label>
        <label>Línea<select id="lineaMercadoPartido">
          <option value="" ${filtrosMercado.linea === '' || filtrosMercado.linea === null ? 'selected' : ''}>Todas las líneas</option>
          ${opciones.lineas.map(item => `<option value="${item}" ${item === Number(filtrosMercado.linea) ? 'selected' : ''}>${item}</option>`).join('')}
        </select></label>
      </div>
      <div class="market-explorer-summary"><span>${mercados.length} pick${mercados.length === 1 ? '' : 's'} ${filtrosMercado.linea === '' || filtrosMercado.linea === null ? 'disponibles' : `para ${filtrosMercado.tipo === 'over' ? 'Over' : 'Under'} ${filtrosMercado.linea}`}</span>${filtrosMercado.categoria === 'tarjetas' ? '<span>“Registradas” suma amarillas + rojas simples; confirma las reglas de tu casino.</span>' : ''}</div>
    </section>
    <div class="pick-grid" style="margin-top:12px">
      ${mercados.length ? mercados.map(item => {
        const nombreLocal = datos.partido?.local?.nombre || 'Equipo local';
        const nombreVisitante = datos.partido?.visitante?.nombre || 'Equipo visitante';
        const detalle = (item.detalle_fuentes || []).map(fuente => {
          const nombre = fuente.rol === 'local' ? nombreLocal : nombreVisitante;
          const rol = fuente.rol === 'local' ? 'local' : 'visitante';
          const lectura = fuente.lectura === 'concesion_del_rival'
            ? `lo que sus rivales consiguieron contra ${nombre}`
            : fuente.lectura === 'produccion_propia'
              ? `lo que produjo ${nombre}`
              : `los partidos recientes de ${nombre}`;
          return `<li><strong>Fuente ${rol}</strong>: ${esc(lectura)} cumplió el mercado ${fuente.aciertos}/${fuente.total} veces (${fuente.frecuencia_observada}%); con suavizado: <b>${fuente.tasa_suavizada}%</b>.</li>`;
        }).join('');
        const notaParcial = item.evidencia_parcial
          ? '<li class="evidencia-parcial"><strong>Evidencia parcial</strong>: el rival no aportó muestras suficientes; la estimación se apoya en un solo lado.</li>'
          : '';
        let accion = '';
        if (datos.guardable) {
          accion = item.guardado
            ? '<span class="pick-result hit">Guardado</span>'
            : `<button type="button" data-guardar-pick="${esc(item.id)}">Guardar pick</button>`;
        } else if (item.resultado_historico === true) {
          accion = '<span class="pick-result hit">Habría acertado</span>';
        } else if (item.resultado_historico === false) {
          accion = '<span class="pick-result miss">Habría fallado</span>';
        } else if (item.requiere_avanzadas) {
          accion = '<span class="pick-result">Sin dato final</span>';
        }
        return `<article class="pick-card ${recomendados.has(item.id) ? 'recomendado' : ''} ${item.guardado ? 'guardado' : ''}">
          <div class="pick-market">${esc(item.mercado)}</div>
          <div class="pick-estimate">${item.estimacion}%</div>
          <div class="pick-meta"><span class="confidence-${esc(item.confianza)}">${esc(item.confianza)}</span><span>muestra ${item.muestra} · ${item.fuentes}/2 fuentes</span></div>
          <button type="button" class="pick-why" data-explicar-pick="${esc(item.id)}" aria-haspopup="dialog">¿Por qué ${item.estimacion}%?</button>
          <div class="pick-reason" data-razon-pick="${esc(item.id)}" hidden>
            <strong>De dónde sale</strong>
            <ul>${notaParcial}${detalle}</ul>
            <div class="pick-cases" data-casos-pick="${esc(item.id)}"><span class="pick-cases-hint">Ábrelo para ver los últimos 3 partidos de cada fuente.</span></div>
            <p>Promediamos ${item.fuentes === 2 ? 'ambas tasas suavizadas' : 'la fuente disponible'}. Fórmula: <code>(aciertos + 2) / (partidos + 4)</code>.</p>
          </div>
          <div class="pick-actions">${recomendados.has(item.id) ? '<span class="model-badge">Candidato</span>' : '<span></span>'}${accion}</div>
        </article>`;
      }).join('') : '<div class="aviso">No encontramos esa línea en esta categoría. Prueba otra línea o elimina parte de la búsqueda.</div>'}
    </div>
    <p class="method-note">${esc(datos.metodologia)} La muestra utiliza únicamente partidos anteriores a este encuentro.</p>`;
}

function pintarCasosPickPartido(explicacion) {
  return (explicacion.detalle_fuentes || []).map(fuente => {
    const titulo = fuente.rol === 'local' ? 'Fuente del local proyectado' : 'Fuente del visitante proyectado';
    const casos = (fuente.partidos || []).map(caso => {
      const fecha = new Date(caso.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
      const valor = caso.unidad === 'marcador'
        ? `Marcador usado por el modelo: ${esc(caso.valor)}`
        : fuente.lectura === 'partidos_del_equipo'
          ? `Total observado: <b>${caso.valor} ${esc(caso.unidad)}</b>`
          : `<b>${esc(caso.sujeto)}</b> registró ${caso.valor} ${esc(caso.unidad)}`;
      return `<li class="pick-case ${caso.cumplio ? 'hit' : 'miss'}">
        <div><span>${fecha}</span><strong>${esc(caso.local)} ${esc(caso.marcador)} ${esc(caso.visitante)}</strong></div>
        <p>${valor}</p><em>${caso.cumplio ? '✓ Cumplió' : '× No cumplió'}</em>
      </li>`;
    }).join('');
    return `<section><h5>${titulo} · últimos ${fuente.partidos?.length || 0}</h5><ol>${casos}</ol></section>`;
  }).join('');
}

async function cargarCasosPickPartido(mercadoId, contenedor) {
  if (contenedor.dataset.loaded === 'true') return;
  contenedor.innerHTML = '<span class="pick-cases-hint">Cargando partidos concretos...</span>';
  try {
    const respuesta = await fetch(`/api/picks/partido/${ID_PARTIDO}/explicacion/${encodeURIComponent(mercadoId)}?periodo=${filtrosMercado.periodo}`);
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || `HTTP ${respuesta.status}`);
    contenedor.innerHTML = pintarCasosPickPartido(datos.explicacion);
    contenedor.dataset.loaded = 'true';
  } catch (error) {
    contenedor.innerHTML = `<span class="pick-cases-hint error">No se pudieron cargar los partidos: ${esc(error.message)}</span>`;
    console.error(error);
  }
}

async function cargarPicks() {
  const cont = document.getElementById('bloquePicks');
  if (!ID_PARTIDO) {
    cont.innerHTML = '<div class="aviso">Abre un partido desde el calendario para generar picks auditables.</div>';
    return;
  }
  const datos = await pedir(`/api/picks/partido/${ID_PARTIDO}?periodo=${filtrosMercado.periodo}`);
  if (!datos || !datos.mercados?.length) {
    cont.innerHTML = '<div class="aviso">No hay muestra histórica anterior suficiente para este partido.</div>';
    return;
  }
  datosPicksPartido = datos;
  filtrosMercado.categoria = 'todas';
  filtrosMercado.familia = 'todas';
  filtrosMercado.alcance = '';
  filtrosMercado.tipo = '';
  filtrosMercado.linea = '';
  pintarPicksPartido();
}

async function guardarPick(mercadoId) {
  const respuesta = await fetch('/api/picks/seguimiento', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partido_id: Number(ID_PARTIDO), mercado_id: mercadoId, periodo: filtrosMercado.periodo })
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    alert(datos.error || 'No se pudo guardar el pick.');
    return;
  }
  if (window.FutbolPicks?.notificarCambio) window.FutbolPicks.notificarCambio();
  else await cargarPicks();
}

async function cargarTodo() {
  const scopeLocal = document.getElementById('fAlcanceLocal').value;
  const scopeVisitante = document.getElementById('fAlcanceVisitante').value;
  const limit = document.getElementById('fLimite').value;
  const half = document.getElementById('fPeriodo').value;

  await cargarCabecera();
  const base = `league=${ID_LIGA}&limit=${limit}&half=${half}${temporadaPartido ? `&season=${temporadaPartido}` : ''}`;
  [datosLocal, datosVisitante] = await Promise.all([
    pedir(`/api/equipos/${ID_LOCAL}/estadisticas-detalladas?${base}&scope=${scopeLocal}`),
    pedir(`/api/equipos/${ID_VISITANTE}/estadisticas-detalladas?${base}&scope=${scopeVisitante}`)
  ]);

  const coberturaLocal = datosLocal?.info?.cobertura;
  const coberturaVisitante = datosVisitante?.info?.cobertura;
  const etiquetaAlcance = { general: 'en total', local: 'de local', visitante: 'de visitante' };
  document.getElementById('context-sample').textContent = `${datosLocal?.stats?.jugados || 0} ${etiquetaAlcance[scopeLocal]} · ${datosVisitante?.stats?.jugados || 0} ${etiquetaAlcance[scopeVisitante]}`;
  document.getElementById('context-coverage').textContent = `${coberturaLocal?.estadisticas || 0}/${coberturaLocal?.partidos || 0} · ${coberturaVisitante?.estadisticas || 0}/${coberturaVisitante?.partidos || 0}`;

  pintarComparacion();
  await cargarH2H();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('fFormato').value = formatoFrecuencia;
  ['fAlcanceLocal', 'fAlcanceVisitante', 'fLimite', 'fPeriodo'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => cargarTodo());
  });
  document.getElementById('fFormato').addEventListener('change', event => cambiarFormatoFrecuencia(event.target.value));
  document.getElementById('share-match').addEventListener('click',async event=>{try{await navigator.clipboard.writeText(location.href);event.currentTarget.textContent='Enlace copiado ✓'}catch{window.prompt('Copia este enlace de análisis:',location.href)}});
  if (!ID_LOCAL || !ID_VISITANTE) {
    document.getElementById('cabecera').innerHTML =
      '<div class="aviso" style="grid-column:1/-1">Faltan parámetros del partido. Vuelve al calendario.</div>';
    return;
  }
  const fechaOrigen = params.get('fecha');
  if (fechaOrigen) document.getElementById('linkVolver').href = '/calendario.html?fecha=' + fechaOrigen;
  document.querySelector('.match-tabs').addEventListener('click', event => {
    const boton = event.target.closest('[data-match-tab]');
    if (boton) abrirPestana(boton.dataset.matchTab);
  });
  const inicial = location.hash.slice(1);
  if (['estadisticas', 'comparacion', 'picks', 'h2h'].includes(inicial)) abrirPestana(inicial);
  document.getElementById('bloquePicks').addEventListener('click', async event => {
    const explicacion = event.target.closest('[data-explicar-pick]');
    if (explicacion) {
      const detalle = document.querySelector(`[data-razon-pick="${CSS.escape(explicacion.dataset.explicarPick)}"]`);
      const casos = detalle?.querySelector('[data-casos-pick]');
      if (casos) await cargarCasosPickPartido(explicacion.dataset.explicarPick, casos);
      const mercado = datosPicksPartido.mercados.find(item => item.id === explicacion.dataset.explicarPick);
      document.getElementById('match-explanation-title').textContent = mercado?.mercado || 'Explicación del mercado';
      const cuerpoDialogo = document.getElementById('match-explanation-body');
      if (detalle) { const copia=detalle.cloneNode(true);copia.hidden=false;cuerpoDialogo.replaceChildren(copia); }
      else cuerpoDialogo.innerHTML = '<div class="warning">No hay explicación disponible.</div>';
      document.getElementById('match-explanation-dialog').showModal();
      return;
    }
    const boton = event.target.closest('[data-guardar-pick]');
    if (boton) guardarPick(boton.dataset.guardarPick);
  });
  document.getElementById('bloquePicks').addEventListener('change', event => {
    if (event.target.id === 'categoriaPicksPartido') {
      filtrosMercado.categoria = event.target.value;
      filtrosMercado.familia = 'todas';
      filtrosMercado.linea = '';
    } else if (event.target.id === 'periodoMercadoPartido') {
      filtrosMercado.periodo = Number(event.target.value);
      filtrosMercado.linea = '';
      cargarPicks();
      return;
    } else if (event.target.id === 'alcanceMercadoPartido') {
      filtrosMercado.alcance = event.target.value;
      filtrosMercado.linea = '';
    } else if (event.target.id === 'tipoMercadoPartido') {
      filtrosMercado.tipo = event.target.value;
      filtrosMercado.linea = '';
    } else if (event.target.id === 'lineaMercadoPartido') filtrosMercado.linea = event.target.value === '' ? '' : Number(event.target.value);
    else return;
    pintarPicksPartido();
  });
  document.getElementById('bloqueH2H').addEventListener('click', event => {
    const boton = event.target.closest('[data-h2h-details]');
    if (boton) alternarDetalleH2H(boton);
  });
  const dialogoExplicacion = document.getElementById('match-explanation-dialog');
  document.getElementById('match-explanation-close').addEventListener('click', () => dialogoExplicacion.close());
  dialogoExplicacion.addEventListener('click', event => { if (event.target === dialogoExplicacion) dialogoExplicacion.close(); });
  cargarTodo();
  cargarPicks();
  const refrescarPartido = async () => {
    if (document.hidden || refrescandoPartido || FutbolMarcador.esFinalizado(estadoPartidoActual)) return;
    refrescandoPartido = true;
    try { await cargarCabecera(); } finally { refrescandoPartido = false; }
  };
  setInterval(refrescarPartido, INTERVALO_ACTUALIZACION_PARTIDO_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - ultimaCargaPartido >= INTERVALO_ACTUALIZACION_PARTIDO_MS) refrescarPartido();
  });
});
window.addEventListener('pageshow', event => {
  if (event.persisted && ID_PARTIDO) cargarPicks();
});
window.addEventListener('futbol:picks-actualizados', () => {
  if (ID_PARTIDO) cargarPicks();
});

let fechaActual = hoyISO();
let cargaPicksId = 0;
let cargaCalendarioId = 0;
const INTERVALO_ACTUALIZACION_MS = 120000;
let ultimaCargaCalendario = 0;
let calendario = null;
let filtroActivo = null;
let filtroEstado = 'todos';
let horaDesde = '';
let horaHasta = '';
let controladorCalendario = null;
const zonaHorariaVisitante = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Mexico_City';

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function esc(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function aDate(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d);
}

function aISO(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

function irA(iso) {
  if (!iso) return;
  fechaActual = iso;
  document.getElementById('selectorFecha').value = iso;
  history.replaceState(null, '', '?fecha=' + iso);
  // Los siete días ya están en memoria: cambiar entre sus chips debe sentirse
  // inmediato y no volver a consultar exactamente los mismos partidos.
  if (calendario?.jornadas.some(dia => dia.fecha === iso)) {
    pintarCalendario();
    pintarResultadosBusqueda();
    return;
  }
  cargarCalendario();
}

function pintarChips() {
  const cont = document.getElementById('chips');
  const jornadas = calendario?.jornadas || [];
  cont.innerHTML = jornadas.map(dia => {
    const f = aDate(dia.fecha);
    return `<button type="button" class="chip ${dia.fecha === fechaActual ? 'active' : ''}" data-calendar-date="${dia.fecha}" aria-pressed="${dia.fecha === fechaActual}">
      <span class="dow">${f.toLocaleDateString('es-MX', { weekday: 'short' })}</span>
      <span class="dnum">${f.getDate()}</span>
      <span class="badge-n">${dia.total ? `${dia.total} partido${dia.total === 1 ? '' : 's'}` : 'Sin partidos'}</span>
    </button>`;
  }).join('');
}

function normalizar(valor) {
  return window.FutbolSearch?.normalizar(valor) || String(valor || '').toLocaleLowerCase('es');
}

function coincide(valor, consulta) {
  return window.FutbolSearch?.coincide(valor, consulta) ?? normalizar(valor).includes(normalizar(consulta));
}

function esSeleccionDe(nombreEquipo, nombrePais) {
  const alias = {
    'alemania':'germany','arabia saudita':'saudi arabia','belgica':'belgium','brasil':'brazil',
    'canada':'canada','catar':'qatar','chipre':'cyprus','corea del sur':'south korea',
    'croacia':'croatia','dinamarca':'denmark','egipto':'egypt','emiratos arabes unidos':'united arab emirates',
    'escocia':'scotland','espana':'spain','estados unidos':'usa','finlandia':'finland',
    'francia':'france','grecia':'greece','hungria':'hungary','inglaterra':'england',
    'irlanda':'ireland','islandia':'iceland','italia':'italy','japon':'japan',
    'noruega':'norway','paises bajos':'netherlands','polonia':'poland','republica checa':'czech republic',
    'rumania':'romania','rusia':'russia','sudafrica':'south africa','suecia':'sweden',
    'suiza':'switzerland','turquia':'turkey','ucrania':'ukraine'
  };
  const equipo = normalizar(nombreEquipo);
  const pais = normalizar(nombrePais);
  return equipo === pais || equipo === alias[pais] || (pais === 'estados unidos' && equipo === 'united states');
}

function catalogoCalendario() {
  const ligas = new Map();
  const equipos = new Map();
  const paises = new Map();
  for (const liga of calendario?.catalogo || []) {
    ligas.set(liga.id, { ...liga, fechas: new Set() });
    if (!liga.pais) continue;
    if (!paises.has(liga.pais)) paises.set(liga.pais, { nombre: liga.pais, ligas: new Map(), selecciones: new Map(), fechas: new Set() });
    paises.get(liga.pais).ligas.set(liga.id, ligas.get(liga.id));
  }
  for (const jornada of calendario?.jornadas || []) {
    for (const liga of jornada.competiciones) {
      if (!ligas.has(liga.liga_id)) ligas.set(liga.liga_id, { id: liga.liga_id, nombre: liga.liga, pais: liga.pais, fechas: new Set() });
      ligas.get(liga.liga_id).fechas.add(jornada.fecha);
      if (liga.pais) {
        if (!paises.has(liga.pais)) paises.set(liga.pais, { nombre: liga.pais, ligas: new Map(), selecciones: new Map(), fechas: new Set() });
        paises.get(liga.pais).ligas.set(liga.liga_id, ligas.get(liga.liga_id));
        paises.get(liga.pais).fechas.add(jornada.fecha);
      }
      for (const partido of liga.partidos) {
        for (const equipo of [partido.local, partido.visitante]) {
          if (!equipos.has(equipo.id)) equipos.set(equipo.id, { id: equipo.id, nombre: equipo.nombre, ligas: new Set(), fechas: new Set() });
          equipos.get(equipo.id).ligas.add(liga.liga_id);
          equipos.get(equipo.id).fechas.add(jornada.fecha);
        }
      }
    }
  }
  for (const equipo of equipos.values()) {
    for (const pais of paises.values()) {
      if (!esSeleccionDe(equipo.nombre, pais.nombre)) continue;
      pais.selecciones.set(equipo.id, equipo);
      equipo.fechas.forEach(fecha => pais.fechas.add(fecha));
    }
  }
  return { ligas: [...ligas.values()], equipos: [...equipos.values()], paises: [...paises.values()] };
}

function opcionBusqueda(icono, nombre, detalle, tipo, id = '') {
  return `<button type="button" class="search-option" role="option" data-filter-type="${tipo}" data-filter-id="${esc(id)}"><b aria-hidden="true">${icono}</b><span>${esc(nombre)}</span><small>${esc(detalle)}</small></button>`;
}

function pintarResultadosBusqueda() {
  const input = document.getElementById('busquedaCalendario');
  const panel = document.getElementById('resultadosBusqueda');
  const consulta = input.value.trim();
  document.getElementById('limpiarBusqueda').classList.toggle('visible', Boolean(consulta || filtroActivo));
  if (!consulta || !calendario) {
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    return;
  }
  const catalogo = catalogoCalendario();
  const paises = catalogo.paises.filter(p => coincide(p.nombre, consulta)).slice(0, 5);
  const ligas = catalogo.ligas.filter(l => coincide(l.nombre, consulta) || (!paises.length && coincide(l.pais, consulta))).slice(0, 7);
  const equipos = catalogo.equipos.filter(e => coincide(e.nombre, consulta) && !paises.some(p => p.selecciones.has(e.id))).slice(0, 7);
  let html = '';
  if (paises.length) html += `<div class="search-heading">Países</div>${paises.map(p => {
    const total = p.ligas.size;
    const principal = opcionBusqueda('🌎', p.nombre, `${total} liga${total === 1 ? '' : 's'}`, 'pais', p.nombre);
    const selecciones = [...p.selecciones.values()].map(e => opcionBusqueda('🏳️', `Selección de ${p.nombre}`, 'Selección nacional', 'equipo', e.id)).join('');
    return principal + selecciones;
  }).join('')}`;
  if (ligas.length) html += `<div class="search-heading">Ligas</div>${ligas.map(l => opcionBusqueda('🏆', l.nombre, l.pais || 'Competición', 'liga', l.id)).join('')}`;
  if (equipos.length) html += `<div class="search-heading">Equipos y selecciones</div>${equipos.map(e => opcionBusqueda('⚽', e.nombre, 'Equipo', 'equipo', e.id)).join('')}`;
  panel.innerHTML = html || '<div class="search-empty">No hay coincidencias en estos siete días.</div>';
  panel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function seleccionarFiltro(tipo, id, etiqueta) {
  filtroActivo = { tipo, id: tipo === 'liga' || tipo === 'equipo' ? Number(id) : id, etiqueta };
  const catalogo = catalogoCalendario();
  const coleccion = tipo === 'liga' ? catalogo.ligas : tipo === 'equipo' ? catalogo.equipos : catalogo.paises;
  const encontrado = coleccion.find(item => tipo === 'pais' ? item.nombre === id : item.id === Number(id));
  const primeraFecha = encontrado?.fechas ? [...encontrado.fechas][0] : null;
  if (primeraFecha && !partidosFiltrados(calendario.jornadas.find(d => d.fecha === fechaActual)).length) fechaActual = primeraFecha;
  document.getElementById('selectorFecha').value = fechaActual;
  history.replaceState(null, '', '?fecha=' + fechaActual);
  document.getElementById('busquedaCalendario').value = '';
  document.getElementById('resultadosBusqueda').hidden = true;
  document.getElementById('busquedaCalendario').setAttribute('aria-expanded', 'false');
  pintarCalendario();
}

function limpiarFiltro() {
  filtroActivo = null;
  document.getElementById('busquedaCalendario').value = '';
  document.getElementById('resultadosBusqueda').hidden = true;
  document.getElementById('busquedaCalendario').setAttribute('aria-expanded', 'false');
  pintarCalendario();
}

const ESTADOS_EN_JUEGO = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT']);

function categoriaEstado(partido) {
  if (partido.finalizado) return 'terminado';
  if (ESTADOS_EN_JUEGO.has(String(partido.estado || '').toUpperCase())) return 'en_juego';
  if (FutbolMarcador.esEstadoAtrasado(partido)) return 'sin_confirmar';
  return 'no_iniciado';
}

function minutosHoraLocal(fecha) {
  const fechaLocal = new Date(fecha);
  return fechaLocal.getHours() * 60 + fechaLocal.getMinutes();
}

function minutosFiltro(valor) {
  if (!/^\d{2}:\d{2}$/.test(valor)) return null;
  const [horas, minutos] = valor.split(':').map(Number);
  return horas * 60 + minutos;
}

function coincideEstadoYHora(partido) {
  if (filtroEstado === 'favoritos' && !FutbolLibrary.esPartidoFavorito(partido.api_id)) return false;
  if (!['todos', 'favoritos'].includes(filtroEstado) && categoriaEstado(partido) !== filtroEstado) return false;
  const desde = minutosFiltro(horaDesde);
  const hasta = minutosFiltro(horaHasta);
  if (desde === null && hasta === null) return true;
  const hora = minutosHoraLocal(partido.fecha);
  if (desde !== null && hasta !== null && desde > hasta) return hora >= desde || hora <= hasta;
  if (desde !== null && hora < desde) return false;
  if (hasta !== null && hora > hasta) return false;
  return true;
}

function actualizarControlesFiltros() {
  document.querySelectorAll('[data-status-filter]').forEach(boton => {
    const activo = boton.dataset.statusFilter === filtroEstado;
    boton.classList.toggle('active', activo);
    boton.setAttribute('aria-pressed', String(activo));
  });
  document.getElementById('limpiarFiltrosVisuales').hidden = filtroEstado === 'todos' && !horaDesde && !horaHasta;
}

function partidosFiltrados(jornada) {
  if (!jornada) return [];
  return jornada.competiciones.map(liga => ({
    ...liga,
    partidos: liga.partidos.filter(partido => {
      if (!coincideEstadoYHora(partido)) return false;
      if (!filtroActivo) return true;
      if (filtroActivo.tipo === 'liga') return liga.liga_id === filtroActivo.id;
      if (filtroActivo.tipo === 'pais') return liga.pais === filtroActivo.id;
      return partido.local.id === filtroActivo.id || partido.visitante.id === filtroActivo.id;
    })
  })).filter(liga => liga.partidos.length);
}

function pintarCompeticiones(competiciones, fechaRef) {
    const abrirTodas = Boolean(filtroActivo) || filtroEstado !== 'todos' || horaDesde || horaHasta || competiciones.length <= 4;
  const grupos = competiciones.map((c, indice) => `
    <details class="liga-group" data-league-group="${c.liga_id}" ${abrirTodas || indice < 3 ? 'open' : ''}>
      <summary class="liga-head">
        <span class="liga-title"><span class="liga-name">${esc(c.liga)}</span></span>
        <span class="liga-meta"><span class="pais">${esc(c.pais)}</span><span class="liga-count" aria-label="${c.partidos.length} partido${c.partidos.length === 1 ? '' : 's'}">${c.partidos.length}</span></span>
      </summary>
      ${c.partidos.map(p => {
        const horaLocal = new Date(p.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        // 'Penales' y 'Final (pró.)' distinguen un 1-1 resuelto en la tanda de
        // un empate liso. Antes ambos se mostraban como 'Final'.
        const estadoVisible = FutbolMarcador.etiquetaEstado(p, horaLocal || p.hora);
        const enJuego = categoriaEstado(p) === 'en_juego';
        const textoPenales = FutbolMarcador.textoPenales(p);
        const marcador = p.finalizado || enJuego
          ? `<div class="marcador ${enJuego ? 'live' : ''}" aria-label="${esc(FutbolMarcador.descripcionMarcador(p))}">${p.local.goles ?? 0} - ${p.visitante.goles ?? 0}${textoPenales ? `<small class="penales">${esc(textoPenales)}</small>` : ''}</div>`
          : `<div class="marcador vs">vs</div>`;
        const url=`/partido.html?local=${p.local.id}&visitante=${p.visitante.id}&liga=${c.liga_id}&partido=${p.api_id}&fecha=${fechaRef}`;
        const favorito = FutbolLibrary.esPartidoFavorito(p.api_id);
        return `<div class="match-shell"><div class="match" role="link" tabindex="0" data-match-open="${esc(url)}">
          <div class="hora">${esc(estadoVisible)}</div>
          <div class="equipo">
            <img src="/api/equipos/${p.local.id}/escudo" alt="" loading="lazy" decoding="async">
            <span>${esc(p.local.nombre)}</span>
          </div>
          ${marcador}
          <div class="equipo der">
            <img src="/api/equipos/${p.visitante.id}/escudo" alt="" loading="lazy" decoding="async">
            <span>${esc(p.visitante.nombre)}</span>
          </div>
          <button type="button" class="favorite-match ${favorito ? 'active' : ''}" data-favorite-match="${p.api_id}" data-league="${c.liga_id}" data-date="${esc(p.fecha)}" data-local-id="${p.local.id}" data-local-name="${esc(p.local.nombre)}" data-away-id="${p.visitante.id}" data-away-name="${esc(p.visitante.nombre)}" aria-label="${favorito ? 'Quitar partido de favoritos' : 'Marcar partido como favorito'}" aria-pressed="${favorito}">${favorito ? '★' : '☆'}</button>
        </div>${p.finalizado?'':`<div class="match-picks" data-pick-match="${p.api_id}" data-match-url="${url}"><span class="pick-loading">Calculando candidatos…</span></div>`}</div>`;
      }).join('')}
    </details>`).join('');
  return `<div class="league-list-tools"><span>${competiciones.length} ${competiciones.length === 1 ? 'competición' : 'competiciones'} en esta vista</span><div class="league-list-actions"><button type="button" data-leagues-action="expandir">Expandir todo</button><button type="button" data-leagues-action="contraer">Contraer todo</button></div></div>${grupos}`;
}

function pintarPick(pick,indice,partidoId){return `<div class="pick-row"><span class="pick-rank">${indice+1}</span><div class="pick-copy"><strong>${esc(pick.mercado)}</strong><small>${esc(pick.confianza)} · muestra ${pick.muestra} · ${esc((pick.evidencia||[]).join(' + '))}</small></div><b class="pick-percent">${pick.estimacion}%</b><button class="save-calendar-pick" type="button" data-save-pick="${partidoId}" data-market="${esc(pick.id)}">Guardar</button></div>`}

function pintarPicksCalendario(datos,periodo){document.querySelectorAll('[data-pick-match]').forEach(slot=>{const id=slot.dataset.pickMatch;const picks=datos.por_partido?.[id]||[];if(!picks.length){slot.innerHTML='<span class="pick-loading">Sin candidatos con evidencia suficiente.</span>';return}slot.innerHTML=`<details class="calendar-picks"><summary><span class="pick-best">${esc(picks[0].mercado)}</span><strong class="pick-score">${picks[0].estimacion}%</strong><span class="pick-toggle"></span></summary><div class="pick-list">${picks.map((pick,i)=>pintarPick(pick,i,id)).join('')}<a href="${esc(slot.dataset.matchUrl)}" class="save-calendar-pick">Abrir análisis completo →</a></div></details>`});const top=document.getElementById('daily-picks');if(!datos.mejores?.length){top.classList.remove('visible');top.innerHTML='';return}top.innerHTML=`<div class="daily-picks-head"><div><h2>⭐ Mejores picks ${periodo}</h2><p>Un candidato por partido, ordenado por confianza estadística.</p></div><small>${datos.mejores.length} candidatos</small></div><div class="daily-grid">${datos.mejores.map(item=>`<a class="daily-card" href="/partido.html?local=${item.local.id}&visitante=${item.visitante.id}&liga=${item.liga.id}&partido=${item.partido_id}"><span>${esc(item.local.nombre)} vs ${esc(item.visitante.nombre)}</span><strong>${esc(item.pick.mercado)}</strong><small>${item.pick.estimacion}% · muestra ${item.pick.muestra}</small></a>`).join('')}</div>`;top.classList.add('visible')}

async function cargarPicksCalendario(query,periodo){const carga=++cargaPicksId;try{const r=await fetch('/api/calendario/picks?'+query);if(!r.ok)throw new Error();const datos=await r.json();if(carga!==cargaPicksId)return;pintarPicksCalendario(datos,periodo)}catch{if(carga!==cargaPicksId)return;document.querySelectorAll('[data-pick-match]').forEach(slot=>slot.innerHTML='<span class="pick-loading">Picks no disponibles.</span>')}}

function pintarCalendario() {
  const cont = document.getElementById('contenido');
  cargaPicksId++;
  document.getElementById('daily-picks').classList.remove('visible');
  pintarChips();
  const jornada = calendario?.jornadas.find(d => d.fecha === fechaActual);
  const competiciones = partidosFiltrados(jornada);
  const total = competiciones.reduce((suma, liga) => suma + liga.partidos.length, 0);
  const fecha = aDate(fechaActual).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('subtitulo').textContent = total
    ? `${total} partido${total === 1 ? '' : 's'} en ${competiciones.length} ${competiciones.length === 1 ? 'competición' : 'competiciones'} · ${fecha}`
    : `Sin partidos programados · ${fecha}`;
  const filtro = document.getElementById('filtroActivo');
  filtro.classList.toggle('visible', Boolean(filtroActivo));
  filtro.innerHTML = filtroActivo ? `Mostrando <strong>${esc(filtroActivo.etiqueta)}</strong><button type="button" data-clear-calendar-filter>Quitar filtro</button>` : '';
  document.getElementById('limpiarBusqueda').classList.toggle('visible', Boolean(filtroActivo));
  actualizarControlesFiltros();
  if (!total) {
    const hayFiltro = Boolean(filtroActivo) || filtroEstado !== 'todos' || Boolean(horaDesde) || Boolean(horaHasta);
    cont.innerHTML = `<div class="vacio"><strong>${hayFiltro ? 'No hay coincidencias en este día' : 'No hay partidos en esta fecha'}</strong>${hayFiltro ? 'Cambia el estado, la hora o el filtro de búsqueda.' : 'Elige otro día del calendario.'}</div>`;
    return;
  }
  cont.innerHTML = pintarCompeticiones(competiciones, fechaActual);
  cargarPicksCalendario('fecha='+encodeURIComponent(fechaActual)+'&tz='+encodeURIComponent(zonaHorariaVisitante),'del día');
}

async function cargarCalendario() {
  const carga = ++cargaCalendarioId;
  controladorCalendario?.abort();
  controladorCalendario = new AbortController();
  const cont = document.getElementById('contenido');
  cargaPicksId++;
  document.getElementById('daily-picks').classList.remove('visible');
  cont.innerHTML = '<div class="vacio">Cargando calendario...</div>';
  const inicio = aDate(fechaActual);
  inicio.setDate(inicio.getDate() - 3);
  try {
    const resp = await fetch(`/api/calendario/proximos?desde=${aISO(inicio)}&dias=7&tz=${encodeURIComponent(zonaHorariaVisitante)}`, { signal: controladorCalendario.signal });
    if (!resp.ok) throw new Error('respuesta no válida');
    const datos = await resp.json();
    if (carga !== cargaCalendarioId) return;
    calendario = datos;
    ultimaCargaCalendario = Date.now();
    pintarCalendario();
    pintarResultadosBusqueda();
  } catch (err) {
    if (carga !== cargaCalendarioId) return;
    if (err.name === 'AbortError') return;
    cont.innerHTML = '<div class="vacio">No se pudieron cargar los partidos</div>';
  }
}

function abrirPartido(local, visitante, liga, apiId, fechaRef) {
  window.location.href = `/partido.html?local=${local}&visitante=${visitante}&liga=${liga}&partido=${apiId}&fecha=${fechaRef || fechaActual}`;
}

document.addEventListener('click', event => {
  const favorito = event.target.closest('[data-favorite-match]');
  if (favorito) {
    event.preventDefault(); event.stopPropagation();
    FutbolLibrary.alternarPartidoFavorito({api_id:Number(favorito.dataset.favoriteMatch),liga_id:Number(favorito.dataset.league),fecha:favorito.dataset.date,local:{id:Number(favorito.dataset.localId),nombre:favorito.dataset.localName},visitante:{id:Number(favorito.dataset.awayId),nombre:favorito.dataset.awayName}});
    pintarCalendario();
    return;
  }
  const accionLigas = event.target.closest('[data-leagues-action]');
  if (accionLigas) {
    const abrir = accionLigas.dataset.leaguesAction === 'expandir';
    document.querySelectorAll('[data-league-group]').forEach(grupo => { grupo.open = abrir; });
    return;
  }
  const tarjeta = event.target.closest('[data-match-open]');
  if (tarjeta) window.location.href = tarjeta.dataset.matchOpen;
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const tarjeta = event.target.closest('[data-match-open]');
  if (!tarjeta) return;
  event.preventDefault();
  window.location.href = tarjeta.dataset.matchOpen;
});

document.addEventListener('click',async event=>{const boton=event.target.closest('[data-save-pick]');if(!boton)return;event.preventDefault();event.stopPropagation();boton.disabled=true;try{const r=await fetch('/api/picks/seguimiento',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({partido_id:Number(boton.dataset.savePick),mercado_id:boton.dataset.market})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudo guardar');boton.textContent='✓ Guardado';boton.classList.add('saved')}catch(error){boton.textContent=error.message;setTimeout(()=>{boton.textContent='Guardar';boton.disabled=false},2200)}});

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  fechaActual = params.get('fecha') || hoyISO();
  document.getElementById('selectorFecha').value = fechaActual;
  document.getElementById('selectorFecha').addEventListener('change', event => irA(event.target.value));
  document.getElementById('chips').addEventListener('click', event => {
    const dia = event.target.closest('[data-calendar-date]');
    if (dia) irA(dia.dataset.calendarDate);
  });
  document.getElementById('filtroActivo').addEventListener('click', event => {
    if (event.target.closest('[data-clear-calendar-filter]')) limpiarFiltro();
  });
  const input = document.getElementById('busquedaCalendario');
  input.addEventListener('input', pintarResultadosBusqueda);
  input.addEventListener('focus', pintarResultadosBusqueda);
  document.getElementById('limpiarBusqueda').addEventListener('click', limpiarFiltro);
  document.querySelectorAll('[data-status-filter]').forEach(boton => {
    boton.addEventListener('click', () => {
      filtroEstado = boton.dataset.statusFilter;
      pintarCalendario();
    });
  });
  document.getElementById('horaDesde').addEventListener('change', event => { horaDesde = event.target.value; pintarCalendario(); });
  document.getElementById('horaHasta').addEventListener('change', event => { horaHasta = event.target.value; pintarCalendario(); });
  document.getElementById('limpiarFiltrosVisuales').addEventListener('click', () => {
    filtroEstado = 'todos'; horaDesde = ''; horaHasta = '';
    document.getElementById('horaDesde').value = '';
    document.getElementById('horaHasta').value = '';
    pintarCalendario();
  });
  document.getElementById('resultadosBusqueda').addEventListener('click', event => {
    const opcion = event.target.closest('[data-filter-type]');
    if (!opcion) return;
    const etiqueta = opcion.querySelector('span')?.textContent || '';
    seleccionarFiltro(opcion.dataset.filterType, opcion.dataset.filterId, etiqueta);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.calendar-search')) {
      document.getElementById('resultadosBusqueda').hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }
  });
  cargarCalendario();
  setInterval(() => { if (!document.hidden) cargarCalendario(); }, INTERVALO_ACTUALIZACION_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - ultimaCargaCalendario >= INTERVALO_ACTUALIZACION_MS) cargarCalendario();
  });
});

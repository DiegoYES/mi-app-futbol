let ligasDisponibles = {};
let picksActuales = null;
let soloRecomendadosPicks = false;
let restaurandoEstadoUrl = true;
const parametrosEstadoInicial = new URLSearchParams(window.location.search);
const seleccionesBoleta = new Map();
const CLAVE_FORMATO_FRECUENCIA = 'football-stats-display-mode';
let formatoFrecuencia = localStorage.getItem(CLAVE_FORMATO_FRECUENCIA) === 'count' ? 'count' : 'percent';
const datosComparacion = { a: null, b: null };

const NOMBRES_CATEGORIAS = {
    goles: 'Goles', resultado: 'Resultado', corners: 'Córners', tarjetas: 'Tarjetas',
    tiros: 'Tiros', tiros_puerta: 'Tiros a puerta', faltas: 'Faltas', offsides: 'Fueras de juego'
};

function escaparHtml(valor) {
    return String(valor ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function agregarOpcion(select, valor, texto, deshabilitada = false) {
    const opcion = new Option(texto, valor);
    opcion.disabled = deshabilitada;
    select.add(opcion);
}

function normalizarBusqueda(valor) {
    return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function coincideBusqueda(texto, consulta) {
    const palabras = normalizarBusqueda(consulta).split(/\s+/).filter(Boolean);
    const contenido = normalizarBusqueda(texto);
    return palabras.every(palabra => contenido.includes(palabra));
}

function cerrarOtrosSelectores(listaActual) {
    document.querySelectorAll('.league-picker-list,.team-picker-list').forEach(lista => {
        if (lista === listaActual) return;
        lista.hidden = true;
        lista.parentElement?.classList.remove('open');
        lista.parentElement?.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', 'false');
    });
}

function prepararSelectorLiga(select) {
    if (select.dataset.visualReady) return;
    select.dataset.visualReady = 'true';
    select.disabled = true;
    select.classList.add('league-select-native');
    const contenedor = document.createElement('div');
    contenedor.className = 'league-picker';
    select.parentNode.insertBefore(contenedor, select);
    contenedor.appendChild(select);
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'league-picker-button';
    boton.setAttribute('aria-haspopup', 'listbox');
    boton.setAttribute('aria-expanded', 'false');
    const lista = document.createElement('div');
    lista.className = 'league-picker-list';
    lista.setAttribute('role', 'listbox');
    lista.hidden = true;
    const buscador = document.createElement('input');
    buscador.type = 'search';
    buscador.className = 'picker-search';
    buscador.placeholder = 'Buscar liga o país…';
    buscador.setAttribute('aria-label', 'Buscar competición por nombre o país');
    const resultados = document.createElement('div');
    resultados.className = 'league-picker-results';
    const basico = document.createElement('button');
    basico.type = 'button';
    basico.className = 'league-picker-basic';
    basico.dataset.basicLeagueSelector = '';
    basico.textContent = 'Usar selector básico';
    lista.append(buscador, resultados, basico);
    contenedor.append(boton, lista);

    const cerrar = () => {
        lista.hidden = true;
        contenedor.classList.remove('open');
        boton.setAttribute('aria-expanded', 'false');
    };
    const pintarOpciones = () => {
        const opciones = [...select.options].filter(opcion => opcion.value).map(opcion => ligasDisponibles[opcion.value]).filter(Boolean);
        const filtradas = opciones.filter(liga => coincideBusqueda(`${liga.nombre} ${liga.pais}`, buscador.value));
        const porPais = new Map();
        filtradas.forEach(liga => {
            const pais = liga.pais || 'Otras competiciones';
            if (!porPais.has(pais)) porPais.set(pais, []);
            porPais.get(pais).push(liga);
        });
        resultados.innerHTML = [...porPais.entries()].map(([pais, ligas]) => `<section class="league-picker-group">
            <h4>${escaparHtml(pais)} <span>${ligas.length}</span></h4>
            ${ligas.map(datos => `<button type="button" role="option" data-league-value="${datos.id}" aria-selected="${select.value === String(datos.id)}"><img src="/api/ligas/${datos.id}/logo" alt=""><span><strong>${escaparHtml(datos.nombre)}</strong><small>${escaparHtml(datos.pais)} · ${datos.temporada_analisis ? `análisis ${escaparHtml(datos.temporadas_analisis?.find(t => t.temporada === datos.temporada_analisis)?.etiqueta || datos.temporada_analisis)}` : 'archivo histórico'}</small></span></button>`).join('')}
        </section>`).join('') || '<p class="league-picker-empty">No encontramos ligas con esa búsqueda.</p>';
    };
    const render = () => {
        const seleccionada = select.selectedOptions[0];
        const liga = ligasDisponibles[select.value];
        const total = [...select.options].filter(opcion => opcion.value).length;
        boton.innerHTML = liga
            ? `<img src="/api/ligas/${liga.id}/logo" alt=""><span>${escaparHtml(liga.nombre)}</span><small>${escaparHtml(liga.pais)}</small><b>⌄</b>`
            : `<i class="league-picker-placeholder" aria-hidden="true">⚽</i><span>${escaparHtml(seleccionada?.text || 'Selecciona competición')}</span><small>${total} ligas disponibles</small><b>⌄</b>`;
        boton.disabled = select.disabled;
        pintarOpciones();
    };
    boton.addEventListener('click', event => {
        event.stopPropagation();
        cerrarOtrosSelectores(lista);
        lista.hidden = !lista.hidden;
        contenedor.classList.toggle('open', !lista.hidden);
        boton.setAttribute('aria-expanded', String(!lista.hidden));
        if (!lista.hidden) {
            buscador.value = '';
            pintarOpciones();
            requestAnimationFrame(() => buscador.focus());
        }
    });
    lista.addEventListener('click', event => {
        event.stopPropagation();
        if (event.target.closest('[data-basic-league-selector]')) {
            select.mostrarFallbackNativo();
            return;
        }
        const opcion = event.target.closest('[data-league-value]');
        if (!opcion) return;
        select.value = opcion.dataset.leagueValue;
        cerrar();
        render();
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    buscador.addEventListener('input', pintarOpciones);
    buscador.addEventListener('keydown', event => { if (event.key === 'Escape') cerrar(); });
    document.addEventListener('click', cerrar);
    select.actualizarSelectorVisual = render;
    select.mostrarFallbackNativo = () => {
        select.disabled = false;
        select.classList.remove('league-select-native');
        boton.hidden = true;
        lista.hidden = true;
        contenedor.classList.add('fallback');
    };
    render();
}

function prepararSelectorEquipo(select) {
    if (select.dataset.visualReady) return;
    select.dataset.visualReady = 'true';
    select.classList.add('team-select-native');
    const contenedor = document.createElement('div');
    contenedor.className = 'team-picker';
    select.parentNode.insertBefore(contenedor, select);
    contenedor.appendChild(select);
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'team-picker-button';
    boton.setAttribute('aria-haspopup', 'listbox');
    boton.setAttribute('aria-expanded', 'false');
    const lista = document.createElement('div');
    lista.className = 'team-picker-list';
    lista.hidden = true;
    const buscador = document.createElement('input');
    buscador.type = 'search';
    buscador.className = 'picker-search';
    buscador.placeholder = 'Buscar equipo…';
    buscador.setAttribute('aria-label', 'Buscar equipo por nombre');
    const resultados = document.createElement('div');
    resultados.className = 'team-picker-results';
    lista.append(buscador, resultados);
    contenedor.append(boton, lista);

    const cerrar = () => {
        lista.hidden = true;
        contenedor.classList.remove('open');
        boton.setAttribute('aria-expanded', 'false');
    };
    const pintarOpciones = () => {
        const equipos = (select.equiposDisponibles || []).filter(equipo => coincideBusqueda(equipo.nombre, buscador.value));
        resultados.innerHTML = equipos.map(equipo => `<button type="button" role="option" data-team-value="${equipo.id}" aria-selected="${select.value === String(equipo.id)}"><img src="/api/equipos/${equipo.id}/escudo" alt=""><span><strong>${escaparHtml(equipo.nombre)}</strong><small>${equipo.id === Number(select.value) ? 'Seleccionado' : 'Elegir equipo'}</small></span></button>`).join('') || '<p class="league-picker-empty">No encontramos equipos con esa búsqueda.</p>';
    };
    const render = () => {
        const equipo = (select.equiposDisponibles || []).find(item => String(item.id) === select.value);
        const total = select.equiposDisponibles?.length || 0;
        boton.innerHTML = equipo
            ? `<img src="/api/equipos/${equipo.id}/escudo" alt=""><span>${escaparHtml(equipo.nombre)}</span><small>Equipo seleccionado</small><b>⌄</b>`
            : `<i class="league-picker-placeholder" aria-hidden="true">⌕</i><span>${escaparHtml(select.selectedOptions[0]?.text || 'Selecciona equipo')}</span><small>${total ? `${total} equipos` : 'Elige liga y temporada'}</small><b>⌄</b>`;
        boton.disabled = select.disabled;
        pintarOpciones();
    };
    boton.addEventListener('click', event => {
        event.stopPropagation();
        cerrarOtrosSelectores(lista);
        lista.hidden = !lista.hidden;
        contenedor.classList.toggle('open', !lista.hidden);
        boton.setAttribute('aria-expanded', String(!lista.hidden));
        if (!lista.hidden) {
            buscador.value = '';
            pintarOpciones();
            requestAnimationFrame(() => buscador.focus());
        }
    });
    lista.addEventListener('click', event => {
        event.stopPropagation();
        const opcion = event.target.closest('[data-team-value]');
        if (!opcion) return;
        select.value = opcion.dataset.teamValue;
        cerrar();
        render();
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    buscador.addEventListener('input', pintarOpciones);
    buscador.addEventListener('keydown', event => { if (event.key === 'Escape') cerrar(); });
    document.addEventListener('click', cerrar);
    select.actualizarSelectorVisual = render;
    render();
}

function actualizarAccionesComparacion() {
    const teamA = document.getElementById('team-a').value;
    const teamB = document.getElementById('team-b').value;
    const leagueA = document.getElementById('league-a').value;
    const leagueB = document.getElementById('league-b').value;
    const seasonA = document.getElementById('season-a').value;
    const seasonB = document.getElementById('season-b').value;
    const listoH2H = Boolean(teamA && teamB);
    const listoPicks = Boolean(teamA && teamB && leagueA && leagueB && seasonA && seasonB);
    document.getElementById('btn-h2h').disabled = !listoH2H;
    document.getElementById('btn-picks').disabled = !listoPicks;
    document.getElementById('save-comparison').disabled = !listoPicks;
    document.getElementById('share-comparison').disabled = !listoPicks;
    document.querySelector('.compare-action')?.classList.toggle('is-ready', listoPicks);
    if (!restaurandoEstadoUrl) actualizarUrlComparador();

    const acceso = document.getElementById('pick-shortcut');
    const pareja = listoPicks ? `${teamA}:${teamB}:${leagueA}:${leagueB}:${seasonA}:${seasonB}` : '';
    if (!listoPicks) {
        acceso.hidden = true;
        acceso.dataset.pareja = '';
        return;
    }
    if (acceso.dataset.pareja !== pareja) {
        acceso.dataset.pareja = pareja;
        acceso.hidden = true;
    }
    const nombreA = document.getElementById('team-a').selectedOptions[0]?.text || 'Equipo A';
    const nombreB = document.getElementById('team-b').selectedOptions[0]?.text || 'Equipo B';
    document.getElementById('pick-shortcut-label').textContent = `Ver picks: ${nombreA} (L) vs ${nombreB} (V)`;
}

// Carga inicial de ligas (ahora recibe un array ordenado)
async function cargarLigas() {
    try {
        let ligasArray = null;
        try {
            const cache = sessionStorage.getItem('datafut_ligas');
            if (cache) {
                const parseado = JSON.parse(cache);
                if (Array.isArray(parseado) && parseado.length) ligasArray = parseado;
            }
        } catch {}

        if (!ligasArray) {
            const res = await fetch('/api/ligas');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            ligasArray = await res.json();
            try { sessionStorage.setItem('datafut_ligas', JSON.stringify(ligasArray)); } catch {}
        }
        ligasDisponibles = {};
        ligasArray.forEach(l => { ligasDisponibles[l.id] = l; });

        const recientes = liga => liga.temporadas_analisis?.length || Number(liga.temporada_analisis || liga.temporada) >= 2025;
        const filtradas = ligasArray.filter(recientes);
        const ligasAnalisis = filtradas.length ? filtradas : ligasArray.filter(liga => liga.disponible);
        ['league-a', 'league-b'].forEach(id => {
            const sel = document.getElementById(id);
            sel.innerHTML = '<option value="">-- Competición --</option>';
            ligasAnalisis.forEach(l => {
                const temporada = l.temporadas_analisis?.find(item => item.temporada === l.temporada_analisis);
                const detalle = l.temporada_analisis ? `análisis ${temporada?.etiqueta || l.temporada_analisis}` : 'archivo histórico';
                agregarOpcion(sel, l.id, `${l.nombre} (${l.pais}) · ${detalle}`);
            });
            sel.disabled = false;
            sel.actualizarSelectorVisual?.();
        });
        const refereeSelect = document.getElementById('referee-league');
        refereeSelect.innerHTML = '<option value="">Selecciona una liga</option>';
        ligasAnalisis.forEach(liga => {
            const temporada = liga.temporadas_analisis?.find(item => item.temporada === liga.temporada_analisis);
            agregarOpcion(refereeSelect, liga.id, `${liga.nombre} · ${temporada?.etiqueta || liga.temporada_analisis}`);
        });
    } catch (err) {
        console.error('Error cargando ligas:', err);
        ['league-a', 'league-b'].forEach(id => document.getElementById(id).mostrarFallbackNativo?.());
    }
}

function cargarTemporadas(lado, preferida = null) {
    const leagueId = document.getElementById(`league-${lado}`).value;
    const select = document.getElementById(`season-${lado}`);
    select.innerHTML = '<option value="">-- Temporada --</option>';
    select.disabled = true;
    const liga = ligasDisponibles[leagueId];
    if (!liga) return;
    const temporadas = liga.temporadas_analisis?.length
        ? liga.temporadas_analisis
        : [{ temporada: liga.temporada, partidos: liga.partidos, finalizados: liga.finalizados || 0 }];
    temporadas.forEach(item => agregarOpcion(select, item.temporada, `${item.etiqueta || item.temporada} · ${item.finalizados} finalizados`));
    const objetivo = String(preferida || liga.temporada_analisis || liga.temporada || '');
    if ([...select.options].some(option => option.value === objetivo)) select.value = objetivo;
    select.disabled = false;
}

async function cargarEquipos(lado) {
    const leagueId = document.getElementById(`league-${lado}`).value;
    const season = document.getElementById(`season-${lado}`).value;
    const teamSel = document.getElementById(`team-${lado}`);
    teamSel.innerHTML = '<option value="">-- Equipo --</option>';
    teamSel.equiposDisponibles = [];
    teamSel.disabled = true;
    teamSel.actualizarSelectorVisual?.();
    document.getElementById(`name-${lado}`).textContent = lado === 'a' ? 'Selecciona el local' : 'Selecciona el visitante';
    document.getElementById(`logo-${lado}`).style.display = 'none';
    document.getElementById(`stats-${lado}`).textContent = 'Selecciona competición y equipo';
    document.getElementById(`trends-${lado}`).textContent = 'Selecciona competición y equipo';
    document.getElementById(`matches-${lado}`).innerHTML = '';
    actualizarAccionesComparacion();
    if (!leagueId || !season) return;

    try {
        const res = await fetch(`/api/ligas/${leagueId}/equipos?season=${season}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const equiposArray = await res.json();
        equiposArray.forEach(eq => agregarOpcion(teamSel, eq.id, eq.nombre));
        teamSel.equiposDisponibles = equiposArray;
        teamSel.disabled = false;
        teamSel.actualizarSelectorVisual?.();
    } catch (err) {
        console.error(`Error cargando equipos para lado ${lado}:`, err);
    }
}

async function preseleccionarDesdeUrl() {
    const params = parametrosEstadoInicial;
    const configuraciones = [
        { lado: 'a', equipo: 'local', liga: 'leagueLocal', season: 'seasonLocal', scope: 'scopeLocal', limit: 'limitLocal', half: 'halfLocal' },
        { lado: 'b', equipo: 'visitante', liga: 'leagueVisitante', season: 'seasonVisitante', scope: 'scopeVisitante', limit: 'limitVisitante', half: 'halfVisitante' }
    ];

    for (const config of configuraciones) {
        const leagueId = params.get(config.liga);
        const teamId = params.get(config.equipo);
        if (!leagueId) continue;

        const leagueSelect = document.getElementById(`league-${config.lado}`);
        if (![...leagueSelect.options].some(option => option.value === leagueId)) continue;
        leagueSelect.value = leagueId;
        leagueSelect.actualizarSelectorVisual?.();
        cargarTemporadas(config.lado, params.get(config.season));
        await cargarEquipos(config.lado);

        if (!teamId) continue;

        const teamSelect = document.getElementById(`team-${config.lado}`);
        if (![...teamSelect.options].some(option => option.value === teamId)) continue;
        teamSelect.value = teamId;
        teamSelect.actualizarSelectorVisual?.();
        for (const filtro of ['scope', 'limit', 'half']) {
            const valor = params.get(config[filtro]);
            const select = document.getElementById(`${filtro}-${config.lado}`);
            if (valor && [...select.options].some(option => option.value === valor)) select.value = valor;
        }
        await actualizarEstadisticas(config.lado);
    }
}

function urlComparador() {
    const params = new URLSearchParams();
    for (const [lado, rol] of [['a', 'Local'], ['b', 'Visitante']]) {
        const equipo = document.getElementById(`team-${lado}`).value;
        const liga = document.getElementById(`league-${lado}`).value;
        if (equipo) params.set(lado === 'a' ? 'local' : 'visitante', equipo);
        if (liga) params.set(`league${rol}`, liga);
        const season = document.getElementById(`season-${lado}`).value;
        if (season) params.set(`season${rol}`, season);
        params.set(`scope${rol}`, document.getElementById(`scope-${lado}`).value);
        params.set(`limit${rol}`, document.getElementById(`limit-${lado}`).value);
        params.set(`half${rol}`, document.getElementById(`half-${lado}`).value);
    }
    return `${location.origin}/comparador.html?${params}`;
}

function actualizarUrlComparador() {
    const url = new URL(urlComparador());
    history.replaceState(null, '', `${url.pathname}${url.search}`);
}

function datosComparacionActual() {
    const local = document.getElementById('team-a');
    const visitante = document.getElementById('team-b');
    const ligaLocal = document.getElementById('league-a');
    const ligaVisitante = document.getElementById('league-b');
    const seasonLocal = document.getElementById('season-a');
    const seasonVisitante = document.getElementById('season-b');
    return {
        id: `${local.value}:${ligaLocal.value}:${seasonLocal.value}:${visitante.value}:${ligaVisitante.value}:${seasonVisitante.value}`,
        titulo: `${local.selectedOptions[0].text} vs ${visitante.selectedOptions[0].text}`,
        local: { id: Number(local.value), nombre: local.selectedOptions[0].text, league: Number(ligaLocal.value) },
        visitante: { id: Number(visitante.value), nombre: visitante.selectedOptions[0].text, league: Number(ligaVisitante.value) },
        competiciones: `${ligaLocal.selectedOptions[0].text} ${seasonLocal.value} · ${ligaVisitante.selectedOptions[0].text} ${seasonVisitante.value}`,
        url: urlComparador()
    };
}

function guardarComparacionActual() {
    if (!window.FutbolLibrary) return;
    window.FutbolLibrary.guardarComparacion(datosComparacionActual());
    const estado = document.getElementById('comparison-action-status');
    estado.textContent = 'Comparación guardada en Tu espacio.';
    document.getElementById('save-comparison').textContent = '✓ Comparación guardada';
}

async function compartirComparacion() {
    const url = urlComparador();
    try {
        await navigator.clipboard.writeText(url);
        document.getElementById('comparison-action-status').textContent = 'Enlace copiado; conserva equipos, competiciones y filtros.';
    } catch {
        window.prompt('Copia este enlace de análisis:', url);
    }
}

// Construye una tabla para una estadística concreta (ej: goles)
function crearTablaEstadistica(titulo, partidos, claveEquipo, claveRival = claveEquipo) {
    const totalPartidos = partidos.length;
    const acumulados = {
        favor: { suma: 0, disponibles: 0 },
        contra: { suma: 0, disponibles: 0 },
        total: { suma: 0, disponibles: 0 }
    };
    const presentar = valor => Number.isFinite(valor) ? valor : '—';
    const acumular = (grupo, valor) => {
        if (!Number.isFinite(valor)) return;
        acumulados[grupo].suma += valor;
        acumulados[grupo].disponibles++;
    };
    let html = `<div class="stat-group">
        <h4>${titulo}</h4>
        <table class="mini-table advanced-detail-table">
            <thead><tr><th>Fecha</th><th>Rival</th><th>A favor</th><th>En contra</th><th>Total partido</th><th>Resultado</th></tr></thead>
            <tbody>`;
    partidos.forEach(p => {
        const favor = p[claveEquipo];
        const contra = p.rival_estadisticas?.[claveRival];
        const total = Number.isFinite(favor) && Number.isFinite(contra) ? favor + contra : null;
        acumular('favor', favor);
        acumular('contra', contra);
        acumular('total', total);
        const claseRes = p.resultado === 'V' ? 'V' : (p.resultado === 'E' ? 'E' : 'D');
        html += `<tr>
            <td>${new Date(p.fecha).toLocaleDateString('es-MX', {day:'2-digit',month:'2-digit'})}</td>
            <td>${escaparHtml(p.rival)}</td>
            <td>${presentar(favor)}</td>
            <td>${presentar(contra)}</td>
            <td><strong>${presentar(total)}</strong></td>
            <td class="resultado ${claseRes}">${p.marcador} (${p.resultado})</td>
        </tr>`;
    });
    const resumen = (etiqueta, grupo) => {
        const datos = acumulados[grupo];
        const promedio = datos.disponibles ? (datos.suma / datos.disponibles).toFixed(2) : '—';
        return `<span>${etiqueta}: <strong>${promedio}</strong> <small>(${datos.disponibles}/${totalPartidos})</small></span>`;
    };
    return html + `</tbody></table><div class="summary">
        ${resumen('Prom. a favor', 'favor')}
        ${resumen('Prom. en contra', 'contra')}
        ${resumen('Prom. total', 'total')}
    </div></div>`;
}

// Genera las tablas para todas las estadísticas a partir de los partidos detallados
function generarVistaPorEstadisticas(partidos, limit) {
    if (partidos.length === 0) return '<p>No hay partidos para mostrar.</p>';
    let html = '';
    html += crearTablaEstadistica('Goles', partidos, 'goles', 'goles');
    html += crearTablaEstadistica('Tiros', partidos, 'tiros', 'tiros');
    html += crearTablaEstadistica('Tiros a puerta', partidos, 'tiros_puerta', 'tiros_puerta');
    html += crearTablaEstadistica('Córners', partidos, 'corners', 'corners');
    html += crearTablaEstadistica('Faltas', partidos, 'faltas', 'faltas');
    html += crearTablaEstadistica('Tarjetas amarillas', partidos, 'amarillas', 'amarillas');
    html += crearTablaEstadistica('Tarjetas rojas', partidos, 'rojas', 'rojas');
    html += crearTablaEstadistica('Puntos de tarjetas (roja ×2)', partidos, 'puntos_tarjetas', 'puntos_tarjetas');
    html += crearTablaEstadistica('Fueras de juego', partidos, 'offsides', 'offsides');
    return html;
}

function activarPestanaEquipo(lado, nombre, enfocar = false) {
    const botones = [...document.querySelectorAll(`[data-team-tab][data-side="${lado}"]`)];
    const activo = botones.find(boton => boton.dataset.teamTab === nombre) || botones[0];
    botones.forEach(boton => {
        const seleccionado = boton === activo;
        boton.setAttribute('aria-selected', String(seleccionado));
        boton.tabIndex = seleccionado ? 0 : -1;
        document.getElementById(boton.getAttribute('aria-controls')).hidden = !seleccionado;
    });
    if (enfocar) activo.focus();
}

function renderRachaReciente(partidos) {
    if (!partidos || !partidos.length) return '';
    const ultimos = partidos.slice(0, 5);
    const badges = ultimos.map(p => {
        const tipo = p.resultado === 'V' ? 'win' : (p.resultado === 'E' ? 'draw' : 'loss');
        const etiqueta = p.resultado || '—';
        const titulo = p.resultado === 'V' ? 'Victoria' : (p.resultado === 'E' ? 'Empate' : 'Derrota');
        return `<span class="streak-badge ${tipo}" title="${titulo}: ${p.marcador || ''} vs ${p.rival || ''}">${etiqueta}</span>`;
    }).join('');
    return `<div class="team-streak-container"><span class="streak-label">Racha reciente:</span><div class="team-streak">${badges}</div></div>`;
}

function renderDistribucionMinutos(distribucion) {
    if (!distribucion || !distribucion.length) return '';
    const totalGf = distribucion.reduce((sum, t) => sum + (t.goles_favor || 0), 0);
    const totalGc = distribucion.reduce((sum, t) => sum + (t.goles_contra || 0), 0);
    if (totalGf === 0 && totalGc === 0) return '';

    const columnas = distribucion.map(t => `
        <div class="minute-card">
            <span class="minute-tag">${t.etiqueta}</span>
            <div class="minute-stat-row goals-for" title="Goles a favor"><span>GF</span><b>${t.goles_favor}</b></div>
            <div class="minute-stat-row goals-against" title="Goles en contra"><span>GC</span><b>${t.goles_contra}</b></div>
            <div class="minute-stat-row cards" title="Tarjetas amarillas"><span>TA</span><b>${t.amarillas}</b></div>
        </div>
    `).join('');

    return `<div class="minute-dist-section">
        <div class="minute-dist-head">
            <strong>Distribución por tramos de 15'</strong>
            <span>GF: Favor · GC: Contra · TA: Tarjetas</span>
        </div>
        <div class="minute-grid">${columnas}</div>
    </div>`;
}

async function actualizarEstadisticas(lado) {
    const teamId = document.getElementById(`team-${lado}`).value;
    const leagueId = document.getElementById(`league-${lado}`).value;
    const season = document.getElementById(`season-${lado}`).value;
    const scope = document.getElementById(`scope-${lado}`).value;
    const limit = document.getElementById(`limit-${lado}`).value;
    const half = document.getElementById(`half-${lado}`).value;
    
    actualizarAccionesComparacion();
    if (!teamId || !leagueId || !season) return;

    const nameEl = document.getElementById(`name-${lado}`);
    const logoEl = document.getElementById(`logo-${lado}`);
    const statsDiv = document.getElementById(`stats-${lado}`);
    const trendsDiv = document.getElementById(`trends-${lado}`);
    const matchesDiv = document.getElementById(`matches-${lado}`);

    nameEl.innerText = 'Cargando...';
    logoEl.style.display = 'none';
    statsDiv.innerHTML = '<div class="loader">Cargando...</div>';
    trendsDiv.innerHTML = '<div class="loader">Cargando...</div>';
    matchesDiv.innerHTML = '';

    try {
        const res = await fetch(`/api/equipos/${teamId}/estadisticas-detalladas?league=${leagueId}&season=${season}&scope=${scope}&limit=${limit}&half=${half}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        nameEl.innerText = data.info.equipo;

        logoEl.src = `/api/equipos/${teamId}/escudo`;
        logoEl.alt = `Escudo de ${data.info.equipo}`;
        logoEl.style.display = 'block';

        if (data.stats.jugados === 0) {
            statsDiv.innerHTML = `<div class="empty-state">No hay partidos con datos de ${data.info.periodo.toLowerCase()} para estos filtros.</div>`;
            trendsDiv.innerHTML = statsDiv.innerHTML;
            matchesDiv.innerHTML = '';
            actualizarAccionesComparacion();
            return;
        }

        const frecuenciaPrincipal = (valor, muestra) => formatoFrecuencia === 'count'
            ? `${valor.total} de ${muestra}`
            : `${valor.porcentaje}%`;
        const frecuenciaSecundaria = (valor, muestra) => formatoFrecuencia === 'count'
            ? `${valor.porcentaje}% de la muestra`
            : `${valor.total} de ${muestra}`;
        const mercado = (label, valor, muestra = data.stats.jugados) => `<div class="market-card">
            <span class="metric-label">${label}</span>
            <span class="market-value"><strong>${frecuenciaPrincipal(valor, muestra)}</strong><small>${frecuenciaSecundaria(valor, muestra)}</small></span>
        </div>`;
        const valorPromedio = valor => valor == null
            ? '—'
            : Number(valor).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const metricaAvanzada = (label, favor, contra, total) => `<div class="advanced-metric-card">
            <span class="metric-label">${label}</span>
            <div class="advanced-values">
                <span><small>A favor</small><strong>${valorPromedio(favor)}</strong></span>
                <span><small>En contra</small><strong>${valorPromedio(contra)}</strong></span>
                <span><small>Total partido</small><strong>${valorPromedio(total)}</strong></span>
            </div>
        </div>`;
        const golesEquipo15 = data.stats.equipoOver15 || data.stats.ttFavor15;
        const golesRival15 = data.stats.rivalOver15 || data.stats.ttContra15;
        const avanzadas = data.stats.avanzadas || { muestra: 0, promedios: {}, cornersOver95: { total: 0, porcentaje: '0.0' } };
        const promedios = avanzadas.promedios || {};

        const encabezadoPeriodo = `<p class="period-label">${data.info.periodo} · ${data.stats.jugados} partidos</p>`;
        const rachaHtml = renderRachaReciente(data.partidos);
        const distribucionHtml = renderDistribucionMinutos(data.stats.distribucion_minutos);
        const resumenHtml = `${encabezadoPeriodo}
            ${rachaHtml}
            <div class="record-grid">
                <div class="metric-card win"><span class="metric-label">Victorias</span><strong>${data.stats.ganados}</strong></div>
                <div class="metric-card draw"><span class="metric-label">Empates</span><strong>${data.stats.empatados}</strong></div>
                <div class="metric-card loss"><span class="metric-label">Derrotas</span><strong>${data.stats.perdidos}</strong></div>
                <div class="metric-card"><span class="metric-label">Goles a favor</span><strong>${data.stats.golesFavor}</strong></div>
                <div class="metric-card"><span class="metric-label">Goles en contra</span><strong>${data.stats.golesContra}</strong></div>
                <div class="metric-card"><span class="metric-label">Diferencia</span><strong>${data.stats.golesFavor - data.stats.golesContra > 0 ? '+' : ''}${data.stats.golesFavor - data.stats.golesContra}</strong></div>
            </div>
            ${distribucionHtml}`;
        const tendenciasHtml = `${encabezadoPeriodo}<div class="trend-heading"><strong>Tendencias del equipo</strong><span>No son picks combinados</span></div>
            <div class="market-grid trend-grid">
                ${mercado('Más de 0.5 goles', data.stats.over05)}
                ${mercado('Más de 1.5 goles', data.stats.over15)}
                ${mercado('Más de 2.5 goles', data.stats.over25)}
                ${mercado('Más de 3.5 goles', data.stats.over35)}
                ${mercado('Menos de 0.5 goles', data.stats.under05)}
                ${mercado('Menos de 1.5 goles', data.stats.under15)}
                ${mercado('Menos de 2.5 goles', data.stats.under25)}
                ${mercado('Menos de 3.5 goles', data.stats.under35)}
                ${mercado('Ambos anotan', data.stats.btts)}
                ${mercado('Equipo +1.5 goles', golesEquipo15)}
                ${mercado('Rival +1.5 goles', golesRival15)}
            </div>
            <details class="advanced-summary" ${avanzadas.muestra ? '' : 'open'}>
                <summary>
                    <span><strong>Estadísticas avanzadas</strong><small>Promedio por partido</small></span>
                    <span class="coverage-chip">Cobertura ${avanzadas.muestra}/${data.stats.jugados}</span>
                </summary>
                ${avanzadas.muestra ? `<div class="advanced-metric-grid">
                    ${metricaAvanzada('Tiros', promedios.tirosFavor, promedios.tirosContra, promedios.tirosTotales)}
                    ${metricaAvanzada('Tiros a puerta', promedios.tirosPuertaFavor, promedios.tirosPuertaContra, promedios.tirosPuertaTotales)}
                    ${metricaAvanzada('Córners', promedios.cornersFavor, promedios.cornersContra, promedios.cornersTotales)}
                    ${metricaAvanzada('Tarjetas registradas (conteo simple)', promedios.tarjetasFavor, promedios.tarjetasContra, promedios.tarjetasTotales)}
                    ${metricaAvanzada('Puntos de tarjetas (roja ×2)', promedios.puntosTarjetasFavor, promedios.puntosTarjetasContra, promedios.puntosTarjetasTotales)}
                    ${metricaAvanzada('Faltas', promedios.faltasFavor, promedios.faltasContra, promedios.faltasTotales)}
                    ${metricaAvanzada('Fueras de juego', promedios.offsidesFavor, promedios.offsidesContra, promedios.offsidesTotales)}
                    <div class="advanced-metric-card advanced-tendency">
                        <span class="metric-label">Más de 9.5 córners totales</span>
                        <strong>${frecuenciaPrincipal(avanzadas.cornersOver95, avanzadas.muestras?.cornersTotales ?? avanzadas.muestra)}</strong>
                        <small>${frecuenciaSecundaria(avanzadas.cornersOver95, avanzadas.muestras?.cornersTotales ?? avanzadas.muestra)} · con cobertura</small>
                    </div>
                </div><p class="advanced-source-note">Tarjetas tomadas de las estadísticas oficiales por equipo del proveedor. En “Puntos de tarjetas”, cada amarilla vale 1 y cada roja vale 2. Las reglas sobre banca, cuerpo técnico y segunda amarilla pueden variar por casa.</p>` : '<div class="advanced-empty">Todavía no hay estadísticas avanzadas cubiertas para esta muestra. Los marcadores y tendencias de goles sí son válidos.</div>'}
            </details>
            ${data.info.cobertura.estadisticas < data.info.cobertura.partidos
                ? `<div class="warning">Estas tendencias usan marcadores confirmados. El detalle avanzado tiene cobertura de ${data.info.cobertura.estadisticas}/${data.info.cobertura.partidos}; los faltantes se muestran como “—”. Los picks combinados están en su bloque independiente.</div>`
                : ''}`;
        statsDiv.innerHTML = resumenHtml;
        trendsDiv.innerHTML = tendenciasHtml;

        if (data.partidos && data.partidos.length > 0) {
            matchesDiv.innerHTML = `<div class="history-tab-heading"><strong>${limit === 'all' ? 'Todos los partidos' : `Últimos ${limit}`}</strong><span>${data.partidos.length} en la muestra</span></div>${generarVistaPorEstadisticas(data.partidos, limit)}`;
        } else {
            matchesDiv.innerHTML = '<p>No hay partidos para este filtro.</p>';
        }

        datosComparacion[lado] = data;
        actualizarConfrontacionDirecta();
        actualizarAccionesComparacion();
    } catch (err) {
        nameEl.innerText = 'Error';
        statsDiv.innerHTML = 'No se pudieron cargar los datos.';
        trendsDiv.innerHTML = 'No se pudieron cargar los datos.';
        datosComparacion[lado] = null;
        actualizarConfrontacionDirecta();
        console.error(err);
    }
}

function actualizarConfrontacionDirecta() {
    const cont = document.getElementById('h2h-visual-section');
    if (!cont) return;
    const da = datosComparacion.a;
    const db = datosComparacion.b;
    if (!da || !db || !da.stats || !db.stats || da.stats.jugados === 0 || db.stats.jugados === 0) {
        cont.style.display = 'none';
        return;
    }

    const sa = da.stats;
    const sb = db.stats;
    const pa = sa.avanzadas?.promedios || {};
    const pb = sb.avanzadas?.promedios || {};

    const gfA = sa.jugados ? (sa.golesFavor / sa.jugados).toFixed(2) : '0';
    const gfB = sb.jugados ? (sb.golesFavor / sb.jugados).toFixed(2) : '0';
    const gcA = sa.jugados ? (sa.golesContra / sa.jugados).toFixed(2) : '0';
    const gcB = sb.jugados ? (sb.golesContra / sb.jugados).toFixed(2) : '0';

    const tpA = pa.tirosPuertaFavor != null ? Number(pa.tirosPuertaFavor).toFixed(2) : null;
    const tpB = pb.tirosPuertaFavor != null ? Number(pb.tirosPuertaFavor).toFixed(2) : null;

    const corA = pa.cornersFavor != null ? Number(pa.cornersFavor).toFixed(2) : null;
    const corB = pb.cornersFavor != null ? Number(pb.cornersFavor).toFixed(2) : null;

    const tarA = pa.tarjetasFavor != null ? Number(pa.tarjetasFavor).toFixed(2) : null;
    const tarB = pb.tarjetasFavor != null ? Number(pb.tarjetasFavor).toFixed(2) : null;

    function filaMetrica(titulo, valA, valB, esPorcentaje = false) {
        const numA = Number(String(valA).replace('%', ''));
        const numB = Number(String(valB).replace('%', ''));
        const validos = Number.isFinite(numA) && Number.isFinite(numB) && (numA > 0 || numB > 0);
        let pctA = 50;
        let pctB = 50;
        if (validos) {
            const total = numA + numB;
            pctA = Math.max(10, Math.min(90, Math.round((numA / total) * 100)));
            pctB = 100 - pctA;
        }

        return `<div class="h2h-metric-row">
            <span class="h2h-val-local">${escaparHtml(String(valA))}</span>
            <div class="h2h-bar-wrapper">
                <span class="h2h-metric-name">${titulo}</span>
                <div class="h2h-dual-track">
                    <div class="h2h-fill-local" style="width:${pctA}%"></div>
                    <div class="h2h-fill-away" style="width:${pctB}%"></div>
                </div>
            </div>
            <span class="h2h-val-away">${escaparHtml(String(valB))}</span>
        </div>`;
    }

    const metricas = [
        filaMetrica('Goles a favor / partido', gfA, gfB),
        filaMetrica('Goles en contra / partido', gcA, gcB),
        ...(tpA !== null && tpB !== null ? [filaMetrica('Tiros a puerta / partido', tpA, tpB)] : []),
        ...(corA !== null && corB !== null ? [filaMetrica('Córners a favor / partido', corA, corB)] : []),
        ...(tarA !== null && tarB !== null ? [filaMetrica('Tarjetas / partido', tarA, tarB)] : []),
        filaMetrica('Frecuencia Ambos Anotan', `${sa.btts?.porcentaje ?? 0}%`, `${sb.btts?.porcentaje ?? 0}%`, true),
        filaMetrica('Más de 1.5 goles totales', `${sa.over15?.porcentaje ?? 0}%`, `${sb.over15?.porcentaje ?? 0}%`, true),
    ];

    cont.innerHTML = `
        <div class="h2h-comparison-head">
            <strong>⚔️ Confrontación Directa de Medias</strong>
            <span><b style="color:var(--green)">${escaparHtml(da.info.equipo)}</b> vs <b style="color:var(--cyan)">${escaparHtml(db.info.equipo)}</b></span>
        </div>
        <div class="h2h-metrics-grid">
            ${metricas.join('')}
        </div>
    `;
    cont.style.display = 'block';
}

async function analizarPanel(lado) {
    const teamId = document.getElementById(`team-${lado}`).value;
    const leagueId = document.getElementById(`league-${lado}`).value;
    const season = document.getElementById(`season-${lado}`).value;
    const scope = document.getElementById(`scope-${lado}`).value;
    const limit = document.getElementById(`limit-${lado}`).value;
    const minInicio = document.getElementById(`${lado}-min-inicio`).value;
    const minFin = document.getElementById(`${lado}-min-fin`).value;
    const resultsDiv = document.getElementById(`${lado}-analysis-results`);

    if (!teamId || !leagueId || !season) {
        resultsDiv.innerHTML = '<p style="color:red;">Selecciona competición y equipo primero.</p>';
        return;
    }

    resultsDiv.innerHTML = '<div class="loader">Calculando...</div>';

    const url = `/api/analisis/rangos?team=${teamId}&league=${leagueId}&season=${season}&scope=${scope}&limit=${limit}&min_inicio=${minInicio}&min_fin=${minFin}`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.total_partidos === 0) {
            resultsDiv.innerHTML = '<p>No hay partidos para analizar.</p>';
            return;
        }
        let html = '';
        for (const [tipo, valor] of Object.entries(data.promedios)) {
            html += `<div class="stat-badge"><div class="label">${tipo}</div><div class="value">${valor}</div></div>`;
        }
        resultsDiv.innerHTML = html;
    } catch (err) {
        resultsDiv.innerHTML = '<p>Error al cargar análisis.</p>';
        console.error(err);
    }
}

// Mostrar/ocultar estadísticas y mercados de un partido en el H2H
async function toggleEstadisticasPartido(elemento, partidoId) {
    const statsDiv = document.getElementById(`match-stats-${partidoId}`);
    if (statsDiv.style.display === 'none' || statsDiv.style.display === '') {
        statsDiv.innerHTML = '<div class="loader">Cargando estadísticas...</div>';
        statsDiv.style.display = 'block';
        try {
            const res = await fetch(`/api/partidos/${partidoId}/estadisticas`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const stat = valor => valor === null || valor === undefined ? '—' : valor;

        let html = `<h4>Estadísticas</h4>
        <table class="mini-table">
            <thead><tr><th>Estadística</th><th>${escaparHtml(data.equipo_local.nombre)}</th><th>${escaparHtml(data.equipo_visitante.nombre)}</th></tr></thead>
                <tbody>
                    <tr><td>Goles</td><td>${data.equipo_local.goles}</td><td>${data.equipo_visitante.goles}</td></tr>
                    <tr><td>Tiros Totales</td><td>${stat(data.equipo_local.tiros_total)}</td><td>${stat(data.equipo_visitante.tiros_total)}</td></tr>
                    <tr><td>Tiros a Puerta</td><td>${stat(data.equipo_local.tiros_puerta)}</td><td>${stat(data.equipo_visitante.tiros_puerta)}</td></tr>
                    <tr><td>Córners</td><td>${stat(data.equipo_local.corners)}</td><td>${stat(data.equipo_visitante.corners)}</td></tr>
                    <tr><td>Faltas</td><td>${stat(data.equipo_local.faltas)}</td><td>${stat(data.equipo_visitante.faltas)}</td></tr>
                    <tr><td>Tarjetas Amarillas</td><td>${stat(data.equipo_local.tarjetas_amarillas)}</td><td>${stat(data.equipo_visitante.tarjetas_amarillas)}</td></tr>
                    <tr><td>Tarjetas Rojas</td><td>${stat(data.equipo_local.tarjetas_rojas)}</td><td>${stat(data.equipo_visitante.tarjetas_rojas)}</td></tr>
                    <tr><td>Fueras de Juego</td><td>${stat(data.equipo_local.offsides)}</td><td>${stat(data.equipo_visitante.offsides)}</td></tr>
                    <tr><td>Posesión (%)</td><td>${stat(data.equipo_local.posesion)}</td><td>${stat(data.equipo_visitante.posesion)}</td></tr>
                </tbody>
            </table>`;

            // Tabla de mercados
            html += `<h4>Mercados cumplidos</h4>
            <table class="mini-table mercados-table">
                <thead><tr><th>Mercado</th><th>Resultado</th></tr></thead>
                <tbody>`;
            const mercados = data.mercados;
            for (const [nombre, cumplido] of Object.entries(mercados)) {
                html += `<tr><td>${nombre.replace(/_/g, ' ')}</td><td class="${cumplido ? 'metric-pass' : 'metric-fail'}">${cumplido ? 'Sí' : 'No'}</td></tr>`;
            }
            html += `</tbody></table>`;

            statsDiv.innerHTML = html;
        } catch (err) {
            statsDiv.innerHTML = '<p style="color:red;">Error al cargar estadísticas.</p>';
        }
    } else {
        statsDiv.style.display = 'none';
    }
}

async function mostrarH2H() {
    const teamA = document.getElementById('team-a').value;
    const teamB = document.getElementById('team-b').value;
    const leagueA = document.getElementById('league-a').value;
    const leagueB = document.getElementById('league-b').value;
    const seasonA = document.getElementById('season-a').value;
    const seasonB = document.getElementById('season-b').value;
    const section = document.getElementById('h2h-section');
    section.style.display = 'block';
    document.getElementById('h2h-content').innerHTML = '<div class="loader">Cargando historial...</div>';

    try {
        let url = `/api/equipos/h2h?team1=${teamA}&team2=${teamB}`;
        if (leagueA === leagueB) {
            url += `&league=${leagueA}`;
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        let html = `<p>Total enfrentamientos: ${data.total}</p>`;
        html += `<p>Victorias ${escaparHtml(document.getElementById('name-a').innerText)}: ${data.victoriasTeam1}</p>`;
        html += `<p>Victorias ${escaparHtml(document.getElementById('name-b').innerText)}: ${data.victoriasTeam2}</p>`;
        html += `<p>Empates: ${data.empates}</p>`;
        html += `<h4>Últimos partidos</h4><ul>`;
        data.ultimos.forEach(p => {
            html += `<li class="h2h-match" data-partido-id="${Number(p.api_id)}">
                ${new Date(p.fecha).toLocaleDateString('es-MX')}: ${escaparHtml(p.local)} ${escaparHtml(p.marcador)} ${escaparHtml(p.visitante)} (${escaparHtml(p.liga || 'amistoso')})
                <div class="match-stats" id="match-stats-${p.api_id}" style="display:none;"></div>
            </li>`;
        });
        html += `</ul>`;
        document.getElementById('h2h-content').innerHTML = html;
    } catch (err) {
        document.getElementById('h2h-content').innerHTML = 'Error al cargar historial.';
        console.error(err);
    }
}

async function mostrarArbitros() {
    const section = document.getElementById('referee-section');
    const select = document.getElementById('referee-league');
    const content = document.getElementById('referee-content');
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!select.value) return;

    content.className = '';
    content.innerHTML = '<div class="loader">Cargando perfiles arbitrales...</div>';
    try {
        const respuesta = await fetch(`/api/arbitros?league=${select.value}`);
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        const data = await respuesta.json();
        if (!data.arbitros.length) {
            content.className = 'empty-state';
            content.textContent = 'Todavía no hay árbitros guardados. El próximo refresco de fixtures los incorporará sin gastar consultas individuales.';
            return;
        }

        content.innerHTML = `<div class="referee-grid">${data.arbitros.map(arbitro => `<article class="referee-card">
            <h4>${escaparHtml(arbitro.nombre)}</h4>
            <div class="referee-stats">
                <span>Partidos<strong>${arbitro.partidos}</strong></span>
                <span>Goles / partido<strong>${arbitro.promedios.goles ?? '—'}</strong></span>
                <span>Amarillas / partido<strong>${arbitro.promedios.amarillas ?? '—'}</strong></span>
                <span>Faltas / partido<strong>${arbitro.promedios.faltas ?? '—'}</strong></span>
            </div>
            <p class="method-note">Cobertura avanzada: ${arbitro.cobertura_avanzada}/${arbitro.partidos}</p>
        </article>`).join('')}</div>`;
    } catch (error) {
        content.className = 'warning';
        content.textContent = 'No fue posible cargar los árbitros.';
        console.error(error);
    }
}

function configurarEventos() {
    document.querySelectorAll('[data-frequency-mode]').forEach(boton => {
        boton.addEventListener('click', () => {
            formatoFrecuencia = boton.dataset.frequencyMode === 'count' ? 'count' : 'percent';
            localStorage.setItem(CLAVE_FORMATO_FRECUENCIA, formatoFrecuencia);
            document.querySelectorAll('[data-frequency-mode]').forEach(item => {
                item.setAttribute('aria-pressed', String(item.dataset.frequencyMode === formatoFrecuencia));
            });
            for (const lado of ['a', 'b']) {
                if (document.getElementById(`team-${lado}`).value) actualizarEstadisticas(lado);
            }
        });
        boton.setAttribute('aria-pressed', String(boton.dataset.frequencyMode === formatoFrecuencia));
    });
    for (const lado of ['a', 'b']) {
        const pestanas = [...document.querySelectorAll(`[data-team-tab][data-side="${lado}"]`)];
        pestanas.forEach((boton, indice) => {
            boton.addEventListener('click', () => activarPestanaEquipo(lado, boton.dataset.teamTab));
            boton.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                let destino = indice;
                if (event.key === 'ArrowLeft') destino = (indice - 1 + pestanas.length) % pestanas.length;
                if (event.key === 'ArrowRight') destino = (indice + 1) % pestanas.length;
                if (event.key === 'Home') destino = 0;
                if (event.key === 'End') destino = pestanas.length - 1;
                activarPestanaEquipo(lado, pestanas[destino].dataset.teamTab, true);
            });
        });
        document.getElementById(`league-${lado}`).addEventListener('change', async () => {
            cargarTemporadas(lado);
            await cargarEquipos(lado);
        });
        document.getElementById(`season-${lado}`).addEventListener('change', () => cargarEquipos(lado));
        document.getElementById(`team-${lado}`).addEventListener('change', () => actualizarEstadisticas(lado));
        for (const filtro of ['scope', 'limit', 'half']) {
            document.getElementById(`${filtro}-${lado}`).addEventListener('change', () => actualizarEstadisticas(lado));
        }
        document.getElementById(`analyze-${lado}`).addEventListener('click', () => analizarPanel(lado));
    }

    document.getElementById('btn-h2h').addEventListener('click', mostrarH2H);
    document.getElementById('btn-picks').addEventListener('click', mostrarPicks);
    document.getElementById('save-comparison').addEventListener('click', guardarComparacionActual);
    document.getElementById('share-comparison').addEventListener('click', compartirComparacion);
    document.getElementById('pick-shortcut').addEventListener('click', mostrarPicks);
    ['pick-category', 'pick-scope', 'pick-direction'].forEach(id => document.getElementById(id).addEventListener('change', () => { actualizarLineasComparador(); pintarPicks(); }));
    document.getElementById('pick-line').addEventListener('change', pintarPicks);
    document.getElementById('pick-recommended-toggle').addEventListener('click', () => {
        soloRecomendadosPicks = !soloRecomendadosPicks;
        pintarPicks();
    });
    document.getElementById('picks-content').addEventListener('click', async event => {
        const explicacion = event.target.closest('[data-explain-market]');
        if (explicacion) {
            const detalle = document.querySelector(`[data-reason-market="${CSS.escape(explicacion.dataset.explainMarket)}"]`);
            const casos = detalle?.querySelector('[data-explanation-cases]');
            if (casos) await cargarExplicacionPick(explicacion.dataset.explainMarket, casos);
            const mercado = picksActuales.mercados.find(item => item.id === explicacion.dataset.explainMarket);
            document.getElementById('pick-explanation-title').textContent = mercado?.mercado || 'Explicación del mercado';
            const cuerpoDialogo = document.getElementById('pick-explanation-body');
            if (detalle) {
                const copia = detalle.cloneNode(true);
                copia.hidden = false;
                cuerpoDialogo.replaceChildren(copia);
            } else {
                cuerpoDialogo.innerHTML = '<div class="warning">No hay explicación disponible.</div>';
            }
            document.getElementById('pick-explanation-dialog').showModal();
            return;
        }
        const boton = event.target.closest('[data-slip-market]');
        if (boton) alternarSeleccionBoleta(boton.dataset.slipMarket);
    });
    document.getElementById('bet-slip-items').addEventListener('click', event => {
        const boton = event.target.closest('[data-remove-slip]');
        if (!boton) return;
        seleccionesBoleta.delete(boton.dataset.removeSlip);
        pintarPicks();
        pintarBoleta();
    });
    document.getElementById('bet-slip-clear').addEventListener('click', () => {
        seleccionesBoleta.clear();
        pintarPicks();
        pintarBoleta();
    });
    document.getElementById('bet-slip-save').addEventListener('click', guardarBoleta);
    const dialogoExplicacion = document.getElementById('pick-explanation-dialog');
    document.getElementById('pick-explanation-close').addEventListener('click', () => dialogoExplicacion.close());
    dialogoExplicacion.addEventListener('click', event => {
        if (event.target === dialogoExplicacion) dialogoExplicacion.close();
    });
    document.getElementById('btn-referees').addEventListener('click', mostrarArbitros);
    document.getElementById('referee-league').addEventListener('change', mostrarArbitros);
    document.getElementById('h2h-content').addEventListener('click', event => {
        const partido = event.target.closest('.h2h-match');
        if (partido) toggleEstadisticasPartido(partido, Number(partido.dataset.partidoId));
    });
    window.addEventListener('scroll', actualizarBarraSticky, { passive: true });
}

function actualizarBarraSticky() {
    const barra = document.getElementById('comparator-sticky-bar');
    if (!barra) return;
    const da = datosComparacion.a;
    const db = datosComparacion.b;
    if (!da || !db) {
        barra.classList.remove('visible');
        return;
    }

    const nameA = document.getElementById('sticky-name-a');
    const nameB = document.getElementById('sticky-name-b');
    const logoA = document.getElementById('sticky-logo-a');
    const logoB = document.getElementById('sticky-logo-b');

    if (nameA) nameA.textContent = da.info?.equipo || 'Local';
    if (nameB) nameB.textContent = db.info?.equipo || 'Visitante';
    if (logoA) {
        const teamIdA = document.getElementById('team-a')?.value;
        if (teamIdA) {
            logoA.src = `/api/equipos/${teamIdA}/escudo`;
            logoA.style.display = 'block';
        }
    }
    if (logoB) {
        const teamIdB = document.getElementById('team-b')?.value;
        if (teamIdB) {
            logoB.src = `/api/equipos/${teamIdB}/escudo`;
            logoB.style.display = 'block';
        }
    }

    if (window.scrollY > 360) {
        barra.classList.add('visible');
    } else {
        barra.classList.remove('visible');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    ['league-a', 'league-b'].forEach(id => prepararSelectorLiga(document.getElementById(id)));
    ['team-a', 'team-b'].forEach(id => prepararSelectorEquipo(document.getElementById(id)));
    configurarEventos();
    await cargarLigas();
    try {
        await preseleccionarDesdeUrl();
    } finally {
        restaurandoEstadoUrl = false;
        actualizarAccionesComparacion();
    }

    const accesoPicks = document.getElementById('pick-shortcut');
    const seccionPicks = document.getElementById('picks-section');
    const observadorPicks = new IntersectionObserver(([entrada]) => {
        if (!accesoPicks.dataset.pareja || seccionPicks.style.display === 'none') return;
        if (seleccionesBoleta.size) {
            accesoPicks.hidden = true;
            return;
        }
        accesoPicks.hidden = entrada.isIntersecting;
    }, { threshold: 0.15 });
    observadorPicks.observe(seccionPicks);
});

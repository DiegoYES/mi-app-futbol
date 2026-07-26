let ligasDisponibles = {};
let picksActuales = null;
let soloRecomendadosPicks = false;
const seleccionesBoleta = new Map();
const CLAVE_FORMATO_FRECUENCIA = 'football-stats-display-mode';
let formatoFrecuencia = localStorage.getItem(CLAVE_FORMATO_FRECUENCIA) === 'count' ? 'count' : 'percent';

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
    contenedor.append(boton, lista);

    const cerrar = () => {
        lista.hidden = true;
        contenedor.classList.remove('open');
        boton.setAttribute('aria-expanded', 'false');
    };
    const render = () => {
        const seleccionada = select.selectedOptions[0];
        const liga = ligasDisponibles[select.value];
        boton.innerHTML = liga
            ? `<img src="/api/ligas/${liga.id}/logo" alt=""><span>${escaparHtml(liga.nombre)}</span><small>${escaparHtml(liga.pais)}</small><b>⌄</b>`
            : `<i class="league-picker-placeholder" aria-hidden="true">⚽</i><span>${escaparHtml(seleccionada?.text || 'Selecciona competición')}</span><small>8 ligas disponibles</small><b>⌄</b>`;
        boton.disabled = select.disabled;
        const opciones = [...select.options].filter(opcion => opcion.value).map(opcion => {
            const datos = ligasDisponibles[opcion.value];
            if (!datos) return '';
            return `<button type="button" role="option" data-league-value="${opcion.value}" aria-selected="${select.value === opcion.value}"><img src="/api/ligas/${datos.id}/logo" alt=""><span><strong>${escaparHtml(datos.nombre)}</strong><small>${escaparHtml(datos.pais)} · ${datos.temporada_analisis ? `análisis ${datos.temporadas_analisis?.find(t => t.temporada === datos.temporada_analisis)?.etiqueta || datos.temporada_analisis}` : 'archivo histórico'}</small></span></button>`;
        }).join('');
        lista.innerHTML = `${opciones || '<p class="league-picker-empty">No hay competiciones disponibles.</p>'}<button type="button" class="league-picker-basic" data-basic-league-selector>Usar selector básico</button>`;
    };
    boton.addEventListener('click', event => {
        event.stopPropagation();
        document.querySelectorAll('.league-picker-list').forEach(otra => { if (otra !== lista) otra.hidden = true; });
        lista.hidden = !lista.hidden;
        contenedor.classList.toggle('open', !lista.hidden);
        boton.setAttribute('aria-expanded', String(!lista.hidden));
    });
    lista.addEventListener('click', event => {
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

function claveBoleta(mercadoId) {
    if (!picksActuales) return '';
    return `${picksActuales.local.id}:${picksActuales.visitante.id}:${picksActuales.liga_ids.local}:${picksActuales.liga_ids.visitante}:${picksActuales.temporadas.local}:${picksActuales.temporadas.visitante}:${mercadoId}`;
}

function pintarBoleta() {
    const panel = document.getElementById('bet-slip');
    const items = [...seleccionesBoleta.values()];
    panel.hidden = items.length === 0;
    document.getElementById('bet-slip-count').textContent = items.length;
    document.getElementById('bet-slip-items').innerHTML = items.map(item => `<article class="bet-slip-item">
        <button type="button" data-remove-slip="${escaparHtml(item.clave)}" aria-label="Quitar selección">×</button>
        <span>${escaparHtml(item.local_nombre)} <b>(L)</b> vs ${escaparHtml(item.visitante_nombre)} <b>(V)</b></span>
        <strong>${escaparHtml(item.mercado_nombre)}</strong>
        <small>${item.estimacion}% · muestra ${item.muestra}</small>
    </article>`).join('');
    pintarAdvertenciasCorrelacion(items);
    if (items.length) document.getElementById('pick-shortcut').hidden = true;
}

function pintarAdvertenciasCorrelacion(items) {
    const panel = document.getElementById('bet-slip-correlation');
    const avisos = [];
    const partidos = new Map();
    items.forEach(item => {
        const clave = `${item.team_local}:${item.team_visitante}:${item.league_local}:${item.league_visitante}`;
        if (!partidos.has(clave)) partidos.set(clave, []);
        partidos.get(clave).push(item);
    });
    for (const selecciones of partidos.values()) {
        if (selecciones.length < 2) continue;
        const categorias = new Set(selecciones.map(item => item.categoria));
        const partido = `${selecciones[0].local_nombre} vs ${selecciones[0].visitante_nombre}`;
        if (categorias.has('goles') && categorias.has('resultado')) avisos.push(`${partido}: goles y resultado dependen del mismo desarrollo.`);
        if (categorias.has('goles') && (categorias.has('tiros') || categorias.has('tiros_puerta'))) avisos.push(`${partido}: goles y volumen de tiros pueden moverse juntos.`);
        if (categorias.has('tiros') && categorias.has('tiros_puerta')) avisos.push(`${partido}: tiros y tiros a puerta no son independientes.`);
        if (categorias.has('tarjetas') && categorias.has('faltas')) avisos.push(`${partido}: faltas y tarjetas comparten contexto disciplinario.`);
        const familias = new Map();
        selecciones.forEach(item => {
            const clave = `${item.categoria}:${item.alcance}:${item.tipo}`;
            familias.set(clave, (familias.get(clave) || 0) + 1);
        });
        if ([...familias.values()].some(total => total > 1)) avisos.push(`${partido}: hay líneas relacionadas; una puede contener a la otra.`);
    }
    panel.hidden = avisos.length === 0;
    panel.innerHTML = avisos.length ? `<strong>Atención a la correlación</strong><ul>${avisos.map(aviso => `<li>${aviso}</li>`).join('')}</ul><p>No multipliques estos porcentajes como si fueran eventos independientes.</p>` : '';
}

function alternarSeleccionBoleta(mercadoId) {
    const mercado = picksActuales?.mercados.find(item => item.id === mercadoId);
    if (!mercado) return;
    const clave = claveBoleta(mercado.id);
    if (seleccionesBoleta.has(clave)) {
        seleccionesBoleta.delete(clave);
    } else {
        if (seleccionesBoleta.size >= 20) {
            alert('Una boleta admite hasta 20 selecciones.');
            return;
        }
        seleccionesBoleta.set(clave, {
            clave,
            team_local: picksActuales.local.id,
            team_visitante: picksActuales.visitante.id,
            league_local: picksActuales.liga_ids.local,
            league_visitante: picksActuales.liga_ids.visitante,
            temporada_local: picksActuales.temporadas.local,
            temporada_visitante: picksActuales.temporadas.visitante,
            mercado_id: mercado.id,
            mercado_nombre: mercado.mercado,
            local_nombre: picksActuales.local.nombre,
            visitante_nombre: picksActuales.visitante.nombre,
            estimacion: mercado.estimacion,
            muestra: mercado.muestra,
            categoria: mercado.categoria,
            tipo: mercado.tipo,
            alcance: mercado.alcance,
            linea: mercado.linea
        });
    }
    pintarPicks();
    pintarBoleta();
}

async function guardarBoleta() {
    const items = [...seleccionesBoleta.values()];
    if (!items.length) return;
    const boton = document.getElementById('bet-slip-save');
    const estado = document.getElementById('bet-slip-status');
    boton.disabled = true;
    estado.textContent = 'Validando y guardando...';
    try {
        const respuesta = await fetch('/api/boletas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nombre: document.getElementById('bet-slip-name').value,
                selecciones: items.map(({ team_local, team_visitante, league_local, league_visitante, temporada_local, temporada_visitante, mercado_id }) => ({
                    team_local, team_visitante, league_local, league_visitante,
                    temporada_local, temporada_visitante, mercado_id
                }))
            })
        });
        const data = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok) throw new Error(data.error || 'No se pudo guardar la boleta.');
        seleccionesBoleta.clear();
        pintarPicks();
        pintarBoleta();
        alert('Boleta guardada. Puedes verla en “Mis boletas”.');
    } catch (error) {
        estado.textContent = error.message;
    } finally {
        boton.disabled = false;
    }
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
    if (listoPicks) actualizarUrlComparador();

    const acceso = document.getElementById('pick-shortcut');
    const pareja = listoPicks ? `${teamA}:${teamB}:${leagueA}:${leagueB}:${seasonA}:${seasonB}` : '';
    if (!listoPicks) {
        acceso.hidden = true;
        acceso.dataset.pareja = '';
        return;
    }
    if (acceso.dataset.pareja !== pareja) {
        acceso.dataset.pareja = pareja;
        acceso.hidden = false;
    }
    const nombreA = document.getElementById('team-a').selectedOptions[0]?.text || 'Equipo A';
    const nombreB = document.getElementById('team-b').selectedOptions[0]?.text || 'Equipo B';
    document.getElementById('pick-shortcut-label').textContent = `Ver picks: ${nombreA} (L) vs ${nombreB} (V)`;
}

// Carga inicial de ligas (ahora recibe un array ordenado)
async function cargarLigas() {
    try {
        const res = await fetch('/api/ligas');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ligasArray = await res.json();
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
    teamSel.disabled = true;
    document.getElementById(`name-${lado}`).textContent = lado === 'a' ? 'Selecciona el local' : 'Selecciona el visitante';
    document.getElementById(`logo-${lado}`).style.display = 'none';
    document.getElementById(`stats-${lado}`).textContent = 'Selecciona competición y equipo';
    document.getElementById(`matches-${lado}`).innerHTML = '';
    actualizarAccionesComparacion();
    if (!leagueId || !season) return;

    try {
        const res = await fetch(`/api/ligas/${leagueId}/equipos?season=${season}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const equiposArray = await res.json();
        equiposArray.forEach(eq => agregarOpcion(teamSel, eq.id, eq.nombre));
        teamSel.disabled = false;
    } catch (err) {
        console.error(`Error cargando equipos para lado ${lado}:`, err);
    }
}

async function preseleccionarDesdeUrl() {
    const params = new URLSearchParams(window.location.search);
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
function crearTablaEstadistica(titulo, partidos, datos) {
    const totalPartidos = partidos.length;
    let html = `<div class="stat-group">
        <h4>${titulo}</h4>
        <table class="mini-table">
            <thead><tr><th>Fecha</th><th>Rival</th><th>${titulo}</th><th>Resultado</th></tr></thead>
            <tbody>`;
    let suma = 0;
    let disponibles = 0;
    partidos.forEach((p, i) => {
        const val = datos[i].valor;
        if (Number.isFinite(val)) {
            suma += val;
            disponibles++;
        }
        const claseRes = p.resultado === 'V' ? 'V' : (p.resultado === 'E' ? 'E' : 'D');
        html += `<tr>
            <td>${new Date(p.fecha).toLocaleDateString('es-MX', {day:'2-digit',month:'2-digit'})}</td>
                <td>${escaparHtml(p.rival)}</td>
            <td>${Number.isFinite(val) ? val : '—'}</td>
            <td class="resultado ${claseRes}">${p.marcador} (${p.resultado})</td>
        </tr>`;
    });
    html += `</tbody></table>`;
    const promedio = disponibles > 0 ? (suma / disponibles).toFixed(2) : '—';
    html += `<div class="summary">
        <span>Promedio: <strong>${promedio}</strong></span>
        <span>Cobertura: <strong>${disponibles}/${totalPartidos}</strong></span>
    </div></div>`;
    return html;
}

// Genera las tablas para todas las estadísticas a partir de los partidos detallados
function generarVistaPorEstadisticas(partidos, limit) {
    if (partidos.length === 0) return '<p>No hay partidos para mostrar.</p>';

    const goles = partidos.map(p => p.goles ?? 0);
    const corners = partidos.map(p => p.corners);
    const tarjetasAmarillas = partidos.map(p => p.amarillas);
    const tarjetasRojas = partidos.map(p => p.rojas);
    const tiros = partidos.map(p => p.tiros);
    const tirosPuerta = partidos.map(p => p.tiros_puerta);
    const faltas = partidos.map(p => p.faltas);
    const offsides = partidos.map(p => p.offsides);

    let html = '';
    html += crearTablaEstadistica('Goles', partidos, goles.map(v => ({ valor: v })));
    html += crearTablaEstadistica('Tiros Totales', partidos, tiros.map(v => ({ valor: v })));
    html += crearTablaEstadistica('Tiros a Puerta', partidos, tirosPuerta.map(v => ({ valor: v })));
    html += crearTablaEstadistica('Córners', partidos, corners.map(v => ({ valor: v })));
    html += crearTablaEstadistica('Faltas', partidos, faltas.map(v => ({ valor: v })));
    html += crearTablaEstadistica('Tarjetas Amarillas', partidos, tarjetasAmarillas.map(v => ({ valor: v })));
    html += crearTablaEstadistica('Tarjetas Rojas', partidos, tarjetasRojas.map(v => ({ valor: v })));
    html += crearTablaEstadistica('Fueras de Juego', partidos, offsides.map(v => ({ valor: v })));

    return html;
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
    const matchesDiv = document.getElementById(`matches-${lado}`);

    nameEl.innerText = 'Cargando...';
    logoEl.style.display = 'none';
    statsDiv.innerHTML = '<div class="loader">Cargando...</div>';
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
        const metricaAvanzada = (label, favor, contra, etiquetaFavor = 'A favor', etiquetaContra = 'En contra') => `<div class="advanced-metric-card">
            <span class="metric-label">${label}</span>
            <div class="advanced-values">
                <span><small>${etiquetaFavor}</small><strong>${valorPromedio(favor)}</strong></span>
                <span><small>${etiquetaContra}</small><strong>${valorPromedio(contra)}</strong></span>
            </div>
        </div>`;
        const golesEquipo15 = data.stats.equipoOver15 || data.stats.ttFavor15;
        const golesRival15 = data.stats.rivalOver15 || data.stats.ttContra15;
        const avanzadas = data.stats.avanzadas || { muestra: 0, promedios: {}, cornersOver95: { total: 0, porcentaje: '0.0' } };
        const promedios = avanzadas.promedios || {};

        let html = `<p class="period-label">${data.info.periodo} · ${data.stats.jugados} partidos</p>
            <div class="record-grid">
                <div class="metric-card win"><span class="metric-label">Victorias</span><strong>${data.stats.ganados}</strong></div>
                <div class="metric-card draw"><span class="metric-label">Empates</span><strong>${data.stats.empatados}</strong></div>
                <div class="metric-card loss"><span class="metric-label">Derrotas</span><strong>${data.stats.perdidos}</strong></div>
                <div class="metric-card"><span class="metric-label">Goles a favor</span><strong>${data.stats.golesFavor}</strong></div>
                <div class="metric-card"><span class="metric-label">Goles en contra</span><strong>${data.stats.golesContra}</strong></div>
                <div class="metric-card"><span class="metric-label">Diferencia</span><strong>${data.stats.golesFavor - data.stats.golesContra > 0 ? '+' : ''}${data.stats.golesFavor - data.stats.golesContra}</strong></div>
            </div>
            <div class="trend-heading"><strong>Tendencias del equipo</strong><span>No son picks combinados</span></div>
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
                    ${metricaAvanzada('Tiros', promedios.tirosFavor, promedios.tirosContra)}
                    ${metricaAvanzada('Tiros a puerta', promedios.tirosPuertaFavor, promedios.tirosPuertaContra)}
                    ${metricaAvanzada('Córners', promedios.cornersFavor, promedios.cornersContra)}
                    ${metricaAvanzada('Tarjetas registradas', promedios.tarjetasFavor, promedios.tarjetasContra)}
                    ${metricaAvanzada('Faltas', promedios.faltasFavor, promedios.faltasContra)}
                    ${metricaAvanzada('Fueras de juego', promedios.offsidesFavor, promedios.offsidesContra)}
                    ${metricaAvanzada('Totales del partido', promedios.cornersTotales, promedios.tarjetasTotales, 'Córners', 'Tarjetas')}
                    <div class="advanced-metric-card advanced-tendency">
                        <span class="metric-label">Más de 9.5 córners totales</span>
                        <strong>${frecuenciaPrincipal(avanzadas.cornersOver95, avanzadas.muestras?.cornersTotales ?? avanzadas.muestra)}</strong>
                        <small>${frecuenciaSecundaria(avanzadas.cornersOver95, avanzadas.muestras?.cornersTotales ?? avanzadas.muestra)} · con cobertura</small>
                    </div>
                </div>` : '<div class="advanced-empty">Todavía no hay estadísticas avanzadas cubiertas para esta muestra. Los marcadores y tendencias de goles sí son válidos.</div>'}
            </details>
            ${data.info.cobertura.estadisticas < data.info.cobertura.partidos
                ? `<div class="warning">Estas tendencias usan marcadores confirmados. El detalle avanzado tiene cobertura de ${data.info.cobertura.estadisticas}/${data.info.cobertura.partidos}; los faltantes se muestran como “—”. Los picks combinados están en su bloque independiente.</div>`
                : ''}`;
        statsDiv.innerHTML = html;

        if (limit === '5' || limit === '3') {
            if (data.partidos && data.partidos.length > 0) {
                matchesDiv.innerHTML = generarVistaPorEstadisticas(data.partidos, limit);
            } else {
                matchesDiv.innerHTML = '<p>No hay partidos para este filtro.</p>';
            }
        } else {
            matchesDiv.innerHTML = `<div class="warning">La vista detallada por estadísticas solo está disponible para los últimos 5 o 3 partidos. Selecciona una de esas opciones para verla.</div>`;
        }

        actualizarAccionesComparacion();
    } catch (err) {
        nameEl.innerText = 'Error';
        statsDiv.innerHTML = 'No se pudieron cargar los datos.';
        console.error(err);
    }
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
                html += `<tr><td>${nombre.replace(/_/g, ' ')}</td><td style="color:${cumplido ? 'green' : 'red'}">${cumplido ? 'Sí' : 'No'}</td></tr>`;
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

function pintarPicks() {
    if (!picksActuales) return;
    const content = document.getElementById('picks-content');
    const categoria = document.getElementById('pick-category').value;
    const recomendados = new Set(picksActuales.recomendados.map(item => item.id));
    const mercadosCategoria = picksActuales.mercados.filter(item => item.categoria === categoria);
    const recomendadosCategoria = mercadosCategoria.filter(item => recomendados.has(item.id));
    if (soloRecomendadosPicks && recomendadosCategoria.length === 0) soloRecomendadosPicks = false;
    const mercados = soloRecomendadosPicks ? recomendadosCategoria : mercadosCategoria;
    const toggle = document.getElementById('pick-recommended-toggle');
    toggle.disabled = recomendadosCategoria.length === 0;
    toggle.setAttribute('aria-pressed', String(soloRecomendadosPicks));
    toggle.textContent = soloRecomendadosPicks ? `Ver todos (${mercadosCategoria.length})` : `Sólo candidatos (${recomendadosCategoria.length})`;
    const nombreLocal = picksActuales.local.nombre;
    const nombreVisitante = picksActuales.visitante.nombre;
    if (!mercados.length) {
        content.innerHTML = '<div class="empty-state">Esta categoría no tiene candidatos destacados. Puedes volver a mostrar todos los mercados.</div>';
        return;
    }
    const tarjetas = mercados.map(item => {
        const seleccionada = seleccionesBoleta.has(claveBoleta(item.id));
        const detalle = (item.detalle_fuentes || []).map(fuente => {
            const nombre = fuente.rol === 'local' ? nombreLocal : nombreVisitante;
            const rol = fuente.rol === 'local' ? 'local' : 'visitante';
            const lectura = fuente.lectura === 'concesion_del_rival'
                ? `lo que sus rivales consiguieron contra ${nombre}`
                : fuente.lectura === 'produccion_propia'
                    ? `lo que produjo ${nombre}`
                    : `los partidos recientes de ${nombre}`;
            return `<li><strong>Fuente ${rol}</strong>: ${escaparHtml(lectura)} cumplió este mercado ${fuente.aciertos} de ${fuente.total} veces (${fuente.frecuencia_observada}%). Al suavizar la muestra: <b>${fuente.tasa_suavizada}%</b>.</li>`;
        }).join('');
        return `<article class="pick-card ${recomendados.has(item.id) ? 'recomendado' : ''} ${seleccionada ? 'seleccionada' : ''}">
            <div class="pick-card-head"><div class="pick-market">${escaparHtml(item.mercado)}</div>${recomendados.has(item.id) ? '<span class="pick-candidate-label">Candidato</span>' : ''}</div>
            <div class="pick-estimate">${item.estimacion}%</div>
            <div class="pick-meta">
                <span class="confidence-${item.confianza}">${escaparHtml(item.confianza)}</span>
                <span>muestra ${item.muestra} · ${item.fuentes}/2 fuentes</span>
            </div>
            <div class="pick-buttons">
                <button type="button" class="pick-why" data-explain-market="${escaparHtml(item.id)}" aria-haspopup="dialog">¿Por qué ${item.estimacion}%?</button>
                <button type="button" class="pick-add" data-slip-market="${escaparHtml(item.id)}">${seleccionada ? '✓ En la boleta' : '+ Agregar a boleta'}</button>
            </div>
            <div class="pick-reason" data-reason-market="${escaparHtml(item.id)}" hidden>
                <strong>De dónde sale</strong>
                <ul>${detalle}</ul>
                <div class="pick-cases" data-explanation-cases="${escaparHtml(item.id)}"><span class="pick-cases-hint">Ábrelo para ver los últimos 3 partidos de cada fuente.</span></div>
                <p>La estimación es el promedio de ${item.fuentes === 2 ? 'ambas tasas suavizadas' : 'la fuente disponible'}. El suavizado <code>(aciertos + 2) / (partidos + 4)</code> evita mostrar 100% por una muestra pequeña.</p>
            </div>
        </article>`;
    }).join('');
    const logoLocal = `<img src="/api/equipos/${picksActuales.local.id}/escudo" alt="Escudo de ${escaparHtml(picksActuales.local.nombre)}">`;
    const logoVisitante = `<img src="/api/equipos/${picksActuales.visitante.id}/escudo" alt="Escudo de ${escaparHtml(picksActuales.visitante.nombre)}">`;
    content.innerHTML = `<div class="pick-matchup">
            <a class="pick-side" href="/equipo.html?id=${picksActuales.local.id}&league=${picksActuales.liga_ids.local}&season=${picksActuales.temporadas.local}">${logoLocal}<span class="pick-side-copy"><span>LOCAL · IZQUIERDA</span><strong>${escaparHtml(picksActuales.local.nombre)}</strong><small>${escaparHtml(picksActuales.ligas.local.nombre)} · ${picksActuales.temporadas.local}</small></span></a>
            <b>VS</b>
            <a class="pick-side away" href="/equipo.html?id=${picksActuales.visitante.id}&league=${picksActuales.liga_ids.visitante}&season=${picksActuales.temporadas.visitante}">${logoVisitante}<span class="pick-side-copy"><span>VISITANTE · DERECHA</span><strong>${escaparHtml(picksActuales.visitante.nombre)}</strong><small>${escaparHtml(picksActuales.ligas.visitante.nombre)} · ${picksActuales.temporadas.visitante}</small></span></a>
        </div>
        <div class="pick-grid">${tarjetas}</div>
        <p class="method-note">${escaparHtml(picksActuales.metodologia)} La izquierda siempre se modela como local usando ${escaparHtml(picksActuales.ligas.local.nombre)} y la derecha como visitante usando ${escaparHtml(picksActuales.ligas.visitante.nombre)}. Comparar competiciones distintas mezcla contextos y se muestra como referencia, no como una predicción calibrada.</p>`;
}

function pintarCasosExplicacion(explicacion) {
    return (explicacion.detalle_fuentes || []).map(fuente => {
        const titulo = fuente.rol === 'local' ? 'Fuente del local proyectado' : 'Fuente del visitante proyectado';
        const casos = (fuente.partidos || []).map(caso => {
            const fecha = new Date(caso.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
            const valor = caso.unidad === 'marcador'
                ? `Marcador usado por el modelo: ${escaparHtml(caso.valor)}`
                : fuente.lectura === 'partidos_del_equipo'
                    ? `Total observado: <b>${caso.valor} ${escaparHtml(caso.unidad)}</b>`
                    : `<b>${escaparHtml(caso.sujeto)}</b> registró ${caso.valor} ${escaparHtml(caso.unidad)}`;
            return `<li class="pick-case ${caso.cumplio ? 'hit' : 'miss'}">
                <div><span>${fecha}</span><strong>${escaparHtml(caso.local)} ${escaparHtml(caso.marcador)} ${escaparHtml(caso.visitante)}</strong></div>
                <p>${valor}</p><em>${caso.cumplio ? '✓ Cumplió' : '× No cumplió'}</em>
            </li>`;
        }).join('');
        return `<section><h5>${titulo} · últimos ${fuente.partidos?.length || 0}</h5><ol>${casos}</ol></section>`;
    }).join('');
}

async function cargarExplicacionPick(mercadoId, contenedor) {
    if (contenedor.dataset.loaded === 'true') return;
    contenedor.innerHTML = '<span class="pick-cases-hint">Cargando partidos concretos...</span>';
    const params = new URLSearchParams({
        team1: picksActuales.local.id,
        team2: picksActuales.visitante.id,
        league1: picksActuales.liga_ids.local,
        league2: picksActuales.liga_ids.visitante,
        season1: picksActuales.temporadas.local,
        season2: picksActuales.temporadas.visitante,
        limit: 10,
        market: mercadoId
    });
    try {
        const respuesta = await fetch(`/api/picks/explicacion?${params}`);
        const datos = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok) throw new Error(datos.error || `HTTP ${respuesta.status}`);
        contenedor.innerHTML = pintarCasosExplicacion(datos.explicacion);
        contenedor.dataset.loaded = 'true';
    } catch (error) {
        contenedor.innerHTML = `<span class="pick-cases-hint error">No se pudieron cargar los partidos: ${escaparHtml(error.message)}</span>`;
        console.error(error);
    }
}

async function mostrarPicks() {
    const teamA = document.getElementById('team-a').value;
    const teamB = document.getElementById('team-b').value;
    const leagueA = document.getElementById('league-a').value;
    const leagueB = document.getElementById('league-b').value;
    const seasonA = document.getElementById('season-a').value;
    const seasonB = document.getElementById('season-b').value;
    if (!teamA || !teamB || !leagueA || !leagueB || !seasonA || !seasonB) return;

    const section = document.getElementById('picks-section');
    const content = document.getElementById('picks-content');
    section.style.display = 'block';
    document.getElementById('pick-shortcut').hidden = true;
    content.innerHTML = '<div class="loader">Calculando frecuencias históricas...</div>';

    try {
        const respuesta = await fetch(`/api/picks?team1=${teamA}&team2=${teamB}&league1=${leagueA}&league2=${leagueB}&season1=${seasonA}&season2=${seasonB}&limit=10`);
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        const data = await respuesta.json();
        if (!data.mercados.length) {
            content.innerHTML = '<div class="empty-state">No hay muestra suficiente para esta comparación.</div>';
            return;
        }

        picksActuales = data;
        soloRecomendadosPicks = false;
        const select = document.getElementById('pick-category');
        select.innerHTML = data.categorias.map(categoria => {
            const total = data.mercados.filter(item => item.categoria === categoria).length;
            return `<option value="${escaparHtml(categoria)}">${escaparHtml(NOMBRES_CATEGORIAS[categoria] || categoria)} (${total})</option>`;
        }).join('');
        select.disabled = false;
        select.value = data.categorias.includes('goles') ? 'goles' : data.categorias[0];
        pintarPicks();
        section.classList.remove('picks-reveal');
        requestAnimationFrame(() => {
            section.classList.add('picks-reveal');
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    } catch (error) {
        content.innerHTML = '<div class="warning">No fue posible calcular los picks.</div>';
        console.error(error);
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
    document.getElementById('pick-category').addEventListener('change', pintarPicks);
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
}

document.addEventListener('DOMContentLoaded', async () => {
    ['league-a', 'league-b'].forEach(id => prepararSelectorLiga(document.getElementById(id)));
    configurarEventos();
    await cargarLigas();
    await preseleccionarDesdeUrl();

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

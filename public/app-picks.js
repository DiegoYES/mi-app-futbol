function claveBoleta(mercadoId) {
    if (!picksActuales) return '';
    const fl = picksActuales.filtros?.local || {};
    const fv = picksActuales.filtros?.visitante || {};
    return `${picksActuales.local.id}:${picksActuales.visitante.id}:${picksActuales.liga_ids.local}:${picksActuales.liga_ids.visitante}:${picksActuales.temporadas.local}:${picksActuales.temporadas.visitante}:${fl.condicion}:${fl.limite}:${fl.periodo}:${fv.condicion}:${fv.limite}:${fv.periodo}:${mercadoId}`;
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
    panel.innerHTML = avisos.length ? `<strong>Atención a la correlación</strong><ul>${avisos.map(aviso => `<li>${escaparHtml(aviso)}</li>`).join('')}</ul><p>No multipliques estos porcentajes como si fueran eventos independientes.</p>` : '';
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
            condicion_local: picksActuales.filtros?.local?.condicion,
            condicion_visitante: picksActuales.filtros?.visitante?.condicion,
            limite_local: picksActuales.filtros?.local?.limite,
            limite_visitante: picksActuales.filtros?.visitante?.limite,
            periodo_local: picksActuales.filtros?.local?.periodo,
            periodo_visitante: picksActuales.filtros?.visitante?.periodo,
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
                selecciones: items.map(({ team_local, team_visitante, league_local, league_visitante, temporada_local, temporada_visitante, condicion_local, condicion_visitante, limite_local, limite_visitante, periodo_local, periodo_visitante, mercado_id }) => ({
                    team_local, team_visitante, league_local, league_visitante,
                    temporada_local, temporada_visitante, condicion_local, condicion_visitante,
                    limite_local, limite_visitante, periodo_local, periodo_visitante, mercado_id
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

function pintarPicks() {
    if (!picksActuales) return;
    const content = document.getElementById('picks-content');
    const categoria = document.getElementById('pick-category').value;
    const alcance = document.getElementById('pick-scope').value;
    const direccion = document.getElementById('pick-direction').value;
    const lineaTexto = document.getElementById('pick-line').value;
    const linea = lineaTexto === '' ? null : Number(lineaTexto);
    const recomendados = new Set(picksActuales.recomendados.map(item => item.id));
    const mercadosCategoria = picksActuales.mercados.filter(item => (
        (!categoria || item.categoria === categoria)
        && (!alcance || item.alcance === alcance)
        && (!direccion || item.tipo === direccion)
        && (linea === null || item.linea === linea)
    ));
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
        <p class="method-note">${escaparHtml(picksActuales.metodologia)} Los roles del cruce siguen siendo izquierda-local y derecha-visitante, pero la evidencia histórica respeta los filtros elegidos. Comparar competiciones distintas mezcla contextos y se muestra como referencia, no como una predicción calibrada.</p>`;
}

function prepararFiltrosComparador() {
    const controles = ['pick-category', 'pick-scope', 'pick-direction', 'pick-line'].map(id => document.getElementById(id));
    const categoria = controles[0];
    categoria.innerHTML = '<option value="">Todas las categorías</option>' + picksActuales.categorias.map(item => {
        const total = picksActuales.mercados.filter(mercado => mercado.categoria === item).length;
        return `<option value="${escaparHtml(item)}">${escaparHtml(NOMBRES_CATEGORIAS[item] || item)} (${total})</option>`;
    }).join('');
    const alcances = { total: 'Ambos equipos', local: 'Equipo local', visitante: 'Equipo visitante' };
    controles[1].innerHTML = '<option value="">Todos los alcances</option>' + [...new Set(picksActuales.mercados.map(item => item.alcance).filter(Boolean))].map(item => `<option value="${item}">${alcances[item] || escaparHtml(item)}</option>`).join('');
    controles[2].innerHTML = '<option value="">Over y Under</option><option value="over">Over · Más de</option><option value="under">Under · Menos de</option>';
    controles.forEach(control => { control.disabled = false; control.value = ''; });
    actualizarLineasComparador();
}

function actualizarLineasComparador() {
    if (!picksActuales) return;
    const categoria = document.getElementById('pick-category').value;
    const alcance = document.getElementById('pick-scope').value;
    const direccion = document.getElementById('pick-direction').value;
    const select = document.getElementById('pick-line');
    const anterior = select.value;
    const lineas = [...new Set(picksActuales.mercados.filter(item => (
        (!categoria || item.categoria === categoria)
        && (!alcance || item.alcance === alcance)
        && (!direccion || item.tipo === direccion)
        && Number.isFinite(item.linea)
    )).map(item => item.linea))].sort((a, b) => a - b);
    select.innerHTML = '<option value="">Todas las líneas</option>' + lineas.map(item => `<option value="${item}">${item}</option>`).join('');
    select.value = lineas.includes(Number(anterior)) ? anterior : '';
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
        scope1: picksActuales.filtros?.local?.condicion || 'local',
        scope2: picksActuales.filtros?.visitante?.condicion || 'visitante',
        limit1: picksActuales.filtros?.local?.limite ?? 'all',
        limit2: picksActuales.filtros?.visitante?.limite ?? 'all',
        half1: picksActuales.filtros?.local?.periodo || 0,
        half2: picksActuales.filtros?.visitante?.periodo || 0,
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
        const filtros = new URLSearchParams({
            team1: teamA, team2: teamB, league1: leagueA, league2: leagueB,
            season1: seasonA, season2: seasonB,
            scope1: document.getElementById('scope-a').value,
            scope2: document.getElementById('scope-b').value,
            limit1: document.getElementById('limit-a').value,
            limit2: document.getElementById('limit-b').value,
            half1: document.getElementById('half-a').value,
            half2: document.getElementById('half-b').value
        });
        const respuesta = await fetch(`/api/picks?${filtros}`);
        const data = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok) throw new Error(data.error || `HTTP ${respuesta.status}`);
        if (!data.mercados.length) {
            const muestra = data.local && data.visitante ? `Muestra encontrada: ${data.local.muestra} para ${escaparHtml(data.local.nombre)} y ${data.visitante.muestra} para ${escaparHtml(data.visitante.nombre)}.` : '';
            content.innerHTML = `<div class="empty-state"><strong>No hay mercados calculables con estos filtros.</strong><br>${muestra}<br><small>${escaparHtml(data.metodologia || 'Prueba ampliando la condición o usando el partido completo.')}</small></div>`;
            ['pick-category', 'pick-scope', 'pick-direction', 'pick-line'].forEach(id => { document.getElementById(id).disabled = true; });
            document.getElementById('pick-recommended-toggle').disabled = true;
            return;
        }

        picksActuales = data;
        soloRecomendadosPicks = false;
        prepararFiltrosComparador();
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

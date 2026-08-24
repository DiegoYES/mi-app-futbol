let partidosRecomendacion = [];
const mercadosRecomendacion = new Map();
let cargaPartidosId = 0;
let momioTotalManual = false;

function fechaHora(valor) {
  return new Date(valor).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

function cuotaDecimalDesdeEntrada(valor, formato) {
  const texto = String(valor || '').trim().replace(',', '.');
  if (!texto) return null;
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return null;
  if (formato === 'decimal') return numero > 1 ? numero : null;
  if (!Number.isInteger(numero) || (numero > -100 && numero < 100)) return null;
  return numero > 0 ? 1 + numero / 100 : 1 + 100 / Math.abs(numero);
}

function americanoDesdeDecimal(decimal) {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

function momioEnFormato(decimal, formato) {
  if (!Number.isFinite(decimal) || decimal <= 1) return '';
  if (formato === 'decimal') return decimal.toFixed(2);
  const americano = americanoDesdeDecimal(decimal);
  return americano > 0 ? `+${americano}` : String(americano);
}

function resumenMomios(decimal, americano) {
  if (!decimal) return '—';
  const recibido = americano ?? americanoDesdeDecimal(decimal);
  const momioAmericano = recibido === -100 ? 100 : recibido;
  return `${Number(decimal).toFixed(2)} / ${momioAmericano > 0 ? '+' : ''}${momioAmericano}`;
}

function normalizarCienAmericano(input, formato) {
  if (formato === 'americano' && input.value.trim() === '-100') input.value = '+100';
}

const NOMBRES_EDITORIALES_EQUIPO = new Map([
  [2329, 'Audax Italiano']
]);

function nombreEquipoEditorial(equipo = {}) {
  return NOMBRES_EDITORIALES_EQUIPO.get(Number(equipo.id)) || equipo.nombre || 'Equipo';
}

function etiquetaPartido(partido) {
  return `${fechaHora(partido.fecha)} · ${nombreEquipoEditorial(partido.local)} vs ${nombreEquipoEditorial(partido.visitante)} · ${partido.liga?.nombre || 'Competición'}`;
}

function textoIndexPartido(partido) {
  return [
    etiquetaPartido(partido),
    partido.local?.nombre,
    partido.visitante?.nombre,
    partido.liga?.nombre
  ].filter(Boolean).join(' ');
}

function poblarPartidosFila(fila, seleccionado = '', legado = null) {
  const select = fila.querySelector('[data-rec="partido"]');
  const id = Number(seleccionado);
  const busqueda = fila.querySelector('[data-rec="buscar-partido"]')?.value || '';
  const opciones = FutbolSearch.ordenar(partidosRecomendacion, busqueda, textoIndexPartido);
  const partidoSeleccionado = partidosRecomendacion.find(partido => partido.api_id === id);
  if (partidoSeleccionado && !opciones.some(partido => partido.api_id === id)) opciones.unshift(partidoSeleccionado);
  if (id && !opciones.some(partido => partido.api_id === id) && legado) {
    opciones.unshift({
      api_id: id,
      fecha: legado.fecha_partido,
      liga: legado.liga || {},
      local: legado.local || { nombre: legado.evento || 'Partido guardado' },
      visitante: legado.visitante || { nombre: '' }
    });
  }
  select.innerHTML = '<option value="">Selecciona un partido…</option>' + opciones.map(partido =>
    `<option value="${partido.api_id}" ${partido.api_id === id ? 'selected' : ''}>${escaparHtml(etiquetaPartido(partido))}</option>`
  ).join('');
}

const NOMBRES_CATEGORIAS_MERCADO = { goles: 'Goles', resultado: 'Resultado', corners: 'Córners', tarjetas: 'Tarjetas', tiros: 'Tiros', tiros_puerta: 'Tiros a puerta', faltas: 'Faltas', offsides: 'Fueras de juego' };

function opcionesFiltro(select, valores, etiqueta, nombres = {}) {
  const actual = select.value;
  select.innerHTML = `<option value="">${etiqueta}</option>` + valores.map(valor => `<option value="${escaparHtml(valor)}">${escaparHtml(nombres[valor] || valor)}</option>`).join('');
  if (valores.includes(actual)) select.value = actual;
}

function prepararFiltrosMercadoFila(fila, seleccionado = '') {
  const partidoId = Number(fila.querySelector('[data-rec="partido"]').value);
  const periodo = Number(fila.querySelector('[data-rec="periodo"]').value) || 0;
  const todos = mercadosRecomendacion.get(`${partidoId}:${periodo}`) || [];
  const elegido = todos.find(item => item.id === seleccionado);
  const categoria = fila.querySelector('[data-rec="categoria"]');
  const alcance = fila.querySelector('[data-rec="alcance"]');
  const direccion = fila.querySelector('[data-rec="direccion"]');
  const linea = fila.querySelector('[data-rec="linea"]');
  opcionesFiltro(categoria, [...new Set(todos.map(item => item.categoria).filter(Boolean))], 'Categoría', NOMBRES_CATEGORIAS_MERCADO);
  opcionesFiltro(alcance, [...new Set(todos.map(item => item.alcance).filter(Boolean))], 'Total o equipo', { total: 'Ambos equipos · total', local: 'Equipo local', visitante: 'Equipo visitante' });
  opcionesFiltro(direccion, [...new Set(todos.map(item => item.tipo).filter(Boolean))], 'Over / Under', { over: 'Over · Más de', under: 'Under · Menos de' });
  const lineas = [...new Set(todos.map(item => item.linea).filter(Number.isFinite))].sort((a, b) => a - b).map(String);
  opcionesFiltro(linea, lineas, 'Línea');
  if (elegido) {
    categoria.value = elegido.categoria || '';
    alcance.value = elegido.alcance || '';
    direccion.value = elegido.tipo || '';
    linea.value = Number.isFinite(elegido.linea) ? String(elegido.linea) : '';
  }
}

function pintarMercadosFila(fila, seleccionado = '', nombreLegado = '') {
  const partidoId = Number(fila.querySelector('[data-rec="partido"]').value);
  const select = fila.querySelector('[data-rec="mercado"]');
  const periodo = Number(fila.querySelector('[data-rec="periodo"]').value) || 0;
  const todos = mercadosRecomendacion.get(`${partidoId}:${periodo}`) || [];
  const categoria = fila.querySelector('[data-rec="categoria"]').value;
  const alcance = fila.querySelector('[data-rec="alcance"]').value;
  const direccion = fila.querySelector('[data-rec="direccion"]').value;
  const linea = fila.querySelector('[data-rec="linea"]').value;
  const mercados = FutbolSearch.ordenar(todos, '', mercado => `${mercado.nombre} ${mercado.categoria}`).filter(item => (!categoria || item.categoria === categoria)
    && (!alcance || item.alcance === alcance)
    && (!direccion || item.tipo === direccion)
    && (!linea || item.linea === Number(linea)));
  const mercadoSeleccionado = todos.find(mercado => mercado.id === seleccionado);
  if (mercadoSeleccionado && !mercados.some(mercado => mercado.id === seleccionado)) mercados.unshift(mercadoSeleccionado);
  const existe = todos.some(mercado => mercado.id === seleccionado);
  select.innerHTML = `<option value="">${mercados.length ? `Selecciona entre ${mercados.length} mercado${mercados.length === 1 ? '' : 's'}…` : 'No hay mercados con esos filtros'}</option>`
    + (!existe && seleccionado ? `<option value="${escaparHtml(seleccionado)}" selected>${escaparHtml(nombreLegado || seleccionado)}</option>` : '')
    + mercados.map(mercado => `<option value="${escaparHtml(mercado.id)}" ${mercado.id === seleccionado ? 'selected' : ''}>${escaparHtml(mercado.nombre)} · ${mercado.estimacion}% · muestra ${mercado.muestra}</option>`).join('');
  select.disabled = !mercados.length;
}

async function cargarMercadosFila(fila, seleccionado = '', nombreLegado = '') {
  const partidoId = Number(fila.querySelector('[data-rec="partido"]').value);
  const periodo = Number(fila.querySelector('[data-rec="periodo"]').value) || 0;
  const claveMercados = `${partidoId}:${periodo}`;
  const select = fila.querySelector('[data-rec="mercado"]');
  if (!partidoId) {
    select.innerHTML = '<option value="">Primero selecciona un partido</option>';
    select.disabled = true;
    return;
  }
  select.disabled = true;
  select.innerHTML = '<option value="">Cargando mercados…</option>';
  try {
    if (!mercadosRecomendacion.has(claveMercados)) {
      const respuesta = await fetch(`/api/admin/recomendaciones/partidos/${partidoId}/mercados?periodo=${periodo}`);
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(datos.error || 'No se pudieron cargar los mercados.');
      mercadosRecomendacion.set(claveMercados, datos.mercados);
    }
    if (Number(fila.querySelector('[data-rec="partido"]').value) !== partidoId) return;
    prepararFiltrosMercadoFila(fila, seleccionado);
    pintarMercadosFila(fila, seleccionado, nombreLegado);
  } catch (error) {
    select.innerHTML = `<option value="">${escaparHtml(error.message)}</option>`;
  }
}

function agregarSeleccion(datos = {}) {
  const fila = document.createElement('div');
  fila.className = 'rec-selection';
  fila.innerHTML = `<input data-rec="buscar-partido" type="search" placeholder="1. Busca el equipo o la liga…">
    <select data-rec="partido" required></select>
    <select data-rec="periodo" aria-label="Período del mercado"><option value="0" ${!datos.periodo ? 'selected' : ''}>2. Partido completo</option><option value="1" ${datos.periodo === 1 ? 'selected' : ''}>2. Primer tiempo</option><option value="2" ${datos.periodo === 2 ? 'selected' : ''}>2. Segundo tiempo</option></select>
    <select data-rec="categoria"><option value="">3. Categoría</option></select>
    <select data-rec="alcance"><option value="">4. Total o equipo</option></select>
    <select data-rec="direccion"><option value="">5. Over / Under</option></select>
    <select data-rec="linea"><option value="">6. Línea</option></select>
    <span class="rec-market-help">El mercado final aparece abajo con su estimación y muestra histórica.</span>
    <select data-rec="mercado" required disabled><option value="">Selecciona primero un partido</option></select>
    <select data-rec="formato"><option value="decimal" ${datos.formato_momio !== 'americano' ? 'selected' : ''}>Decimal</option><option value="americano" ${datos.formato_momio === 'americano' ? 'selected' : ''}>Americano</option></select>
    <input data-rec="momio" inputmode="text" maxlength="20" required placeholder="Momio" value="${escaparHtml(datos.momio_capturado ?? datos.cuota ?? '')}">
    <input data-rec="casa" maxlength="80" placeholder="Casa (opcional)" value="${escaparHtml(datos.casa || '')}">
    <button class="rec-danger" type="button" data-rec-quitar>Quitar</button>`;
  document.getElementById('rec-selecciones').appendChild(fila);
  poblarPartidosFila(fila, datos.partido_api_id, datos);
  if (datos.partido_api_id) cargarMercadosFila(fila, datos.mercado_id, datos.mercado);
}

async function cargarPartidosRecomendacion() {
  const cierre = document.getElementById('rec-cierra').value;
  const estado = document.getElementById('rec-partidos-status');
  if (!cierre) {
    partidosRecomendacion = [];
    estado.textContent = 'Elige una fecha límite para cargar partidos.';
    return;
  }
  const limite = new Date(cierre);
  if (limite <= new Date()) {
    partidosRecomendacion = [];
    estado.textContent = 'La fecha límite debe estar en el futuro.';
    return;
  }
  const carga = ++cargaPartidosId;
  estado.textContent = 'Cargando partidos disponibles…';
  try {
    const respuesta = await fetch(`/api/admin/recomendaciones/partidos?hasta=${encodeURIComponent(limite.toISOString())}`);
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudieron cargar los partidos.');
    if (carga !== cargaPartidosId) return;
    partidosRecomendacion = datos.partidos;
    estado.textContent = partidosRecomendacion.length
      ? `${partidosRecomendacion.length} partido(s) entre ahora y ${fechaHora(limite)}.`
      : 'No hay partidos guardados dentro de ese rango.';
    document.querySelectorAll('.rec-selection').forEach(fila => {
      const seleccionado = fila.querySelector('[data-rec="partido"]').value;
      poblarPartidosFila(fila, seleccionado);
      if (seleccionado) cargarMercadosFila(fila, fila.querySelector('[data-rec="mercado"]').value);
    });
  } catch (error) {
    if (carga !== cargaPartidosId) return;
    estado.textContent = error.message;
  }
}

function actualizarMomioTotal(forzar = false) {
  if (momioTotalManual && !forzar) return;
  const cuotas = [...document.querySelectorAll('.rec-selection')].map(fila => cuotaDecimalDesdeEntrada(
    fila.querySelector('[data-rec="momio"]').value,
    fila.querySelector('[data-rec="formato"]').value
  ));
  const input = document.getElementById('rec-momio-total');
  if (!cuotas.length || cuotas.some(cuota => !cuota)) {
    input.value = '';
    document.getElementById('rec-total-ayuda').textContent = 'Captura los momios individuales para calcular el total.';
    return;
  }
  const total = cuotas.reduce((producto, cuota) => producto * cuota, 1);
  input.value = momioEnFormato(total, document.getElementById('rec-formato-total').value);
  document.getElementById('rec-total-ayuda').textContent = `Cálculo de las selecciones: ${resumenMomios(total)}. Puedes reemplazarlo.`;
}

function ajustarSelecciones() {
  const contenedor = document.getElementById('rec-selecciones');
  if (!contenedor.children.length) agregarSeleccion();
  const esPick = document.getElementById('rec-tipo').value === 'pick';
  if (esPick) {
    while (contenedor.children.length > 1) contenedor.lastElementChild.remove();
  }
  const tipo = document.getElementById('rec-tipo').value;
  document.getElementById('rec-agregar').title = esPick
    ? 'Al añadir otra selección se cambiará automáticamente a parlay.'
    : tipo === 'combinada'
      ? 'Añadir otra selección del mismo partido.'
      : 'Añadir otra selección al parlay.';
}

function limpiarRecomendacion() {
  document.getElementById('rec-form').reset();
  document.getElementById('rec-id').value = '';
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  manana.setHours(23, 59, 0, 0);
  document.getElementById('rec-cierra').value = fechaLocalInput(manana);
  document.getElementById('rec-selecciones').innerHTML = '';
  document.getElementById('rec-guardar').textContent = 'Crear recomendación';
  document.getElementById('rec-cancelar').hidden = true;
  momioTotalManual = false;
  agregarSeleccion();
  ajustarSelecciones();
  cargarPartidosRecomendacion();
}

function datosRecomendacionFormulario() {
  const cierreLocal = document.getElementById('rec-cierra').value;
  return {
    tipo: document.getElementById('rec-tipo').value,
    titulo: document.getElementById('rec-titulo').value,
    descripcion: document.getElementById('rec-descripcion').value,
    visibilidad: document.getElementById('rec-visibilidad').value,
    estado_publicacion: document.getElementById('rec-publicacion').value,
    resultado: document.getElementById('rec-resultado').value,
    destacada: document.getElementById('rec-destacada').checked,
    formato_momio_total: document.getElementById('rec-formato-total').value,
    momio_total: document.getElementById('rec-momio-total').value,
    cierra_en: cierreLocal ? new Date(cierreLocal).toISOString() : '',
    selecciones: [...document.querySelectorAll('.rec-selection')].map(fila => ({
      partido_api_id: Number(fila.querySelector('[data-rec="partido"]').value),
      mercado_id: fila.querySelector('[data-rec="mercado"]').value,
      periodo: Number(fila.querySelector('[data-rec="periodo"]').value) || 0,
      formato_momio: fila.querySelector('[data-rec="formato"]').value,
      momio: fila.querySelector('[data-rec="momio"]').value,
      casa: fila.querySelector('[data-rec="casa"]').value
    }))
  };
}

async function guardarRecomendacion(evento) {
  evento.preventDefault();
  const id = document.getElementById('rec-id').value;
  const boton = document.getElementById('rec-guardar');
  boton.disabled = true;
  try {
    const respuesta = await fetch(id ? `/api/admin/recomendaciones/${id}` : '/api/admin/recomendaciones', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datosRecomendacionFormulario())
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudo guardar la recomendación.');
    limpiarRecomendacion();
    await cargarRecomendacionesAdmin();
  } catch (error) {
    alert(error.message);
  } finally {
    boton.disabled = false;
  }
}

let recomendacionesAdmin = [];

async function cargarRecomendacionesAdmin() {
  const contenedor = document.getElementById('rec-lista');
  const respuesta = await fetch('/api/admin/recomendaciones');
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    contenedor.innerHTML = `<div class="ticket-empty">${escaparHtml(datos.error || 'No se pudieron cargar.')}</div>`;
    return;
  }
  recomendacionesAdmin = datos.recomendaciones;
  if (!recomendacionesAdmin.length) {
    contenedor.innerHTML = '<div class="ticket-empty">Todavía no hay picks, combinadas ni parlays editoriales.</div>';
    return;
  }
  contenedor.innerHTML = recomendacionesAdmin.map(item => `<article class="rec-card" data-rec-id="${item._id}">
    <div class="rec-card-head"><div><span class="rec-card-meta">${item.tipo === 'parlay' ? 'PARLAY' : item.tipo === 'combinada' ? 'COMBINADA' : 'PICK'} · ${escaparHtml(item.visibilidad)} · ${escaparHtml(item.estado_publicacion)}</span><h3>${escaparHtml(item.titulo)}</h3></div><span class="badge ${item.resultado === 'acertado' ? 'premium' : item.resultado === 'fallado' ? 'expirado' : 'prueba'}">${escaparHtml(item.resultado)}</span></div>
    ${item.descripcion ? `<p>${escaparHtml(item.descripcion)}</p>` : ''}
    <ol>${item.selecciones.map(seleccion => `<li><strong>${escaparHtml(seleccion.evento)}</strong> · ${escaparHtml(seleccion.mercado)} · ${resumenMomios(seleccion.cuota, seleccion.momio_americano)}${seleccion.casa ? ` · ${escaparHtml(seleccion.casa)}` : ''}<br><small>${fechaHora(seleccion.fecha_partido)}</small></li>`).join('')}</ol>
    <div class="rec-card-meta">Cierra ${fechaHora(item.cierra_en)} · Momio total ${resumenMomios(item.cuota_total, item.momio_total_americano)}${item.destacada ? ' · ⭐ Destacada' : ''}</div>
    <div class="rec-actions" style="margin-top:11px"><button class="rec-secondary" type="button" data-rec-editar="${item._id}">Editar</button><button class="rec-danger" type="button" data-rec-eliminar="${item._id}">Eliminar</button></div>
  </article>`).join('');
}

async function editarRecomendacion(id) {
  const item = recomendacionesAdmin.find(recomendacion => recomendacion._id === id);
  if (!item) return;
  document.getElementById('rec-id').value = item._id;
  document.getElementById('rec-tipo').value = item.tipo;
  document.getElementById('rec-visibilidad').value = item.visibilidad;
  document.getElementById('rec-publicacion').value = item.estado_publicacion;
  document.getElementById('rec-resultado').value = item.resultado;
  document.getElementById('rec-titulo').value = item.titulo;
  document.getElementById('rec-descripcion').value = item.descripcion || '';
  document.getElementById('rec-cierra').value = fechaLocalInput(item.cierra_en);
  document.getElementById('rec-formato-total').value = item.formato_momio_total || 'decimal';
  document.getElementById('rec-momio-total').value = item.momio_total_capturado || item.cuota_total || '';
  document.getElementById('rec-destacada').checked = item.destacada;
  document.getElementById('rec-selecciones').innerHTML = '';
  momioTotalManual = true;
  await cargarPartidosRecomendacion();
  item.selecciones.forEach(agregarSeleccion);
  ajustarSelecciones();
  document.getElementById('rec-guardar').textContent = 'Guardar cambios';
  document.getElementById('rec-cancelar').hidden = false;
  document.getElementById('rec-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function eliminarRecomendacion(id) {
  if (!confirm('¿Eliminar definitivamente esta recomendación?')) return;
  const respuesta = await fetch(`/api/admin/recomendaciones/${id}`, { method: 'DELETE' });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) return alert(datos.error || 'No se pudo eliminar.');
  if (document.getElementById('rec-id').value === id) limpiarRecomendacion();
  cargarRecomendacionesAdmin();
}


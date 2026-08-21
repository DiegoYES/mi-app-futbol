const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const paginas = [
  'index.html', 'inicio.html', 'login.html', 'admin.html', 'calendario.html',
  'partido.html', 'picks.html', 'boletas.html', 'equipos.html', 'equipo.html', 'jugadores.html',
  'competiciones.html', 'competicion.html', 'jugador.html', 'arbitros.html', 'guia.html', 'sugerencias.html',
  'suscripcion.html', 'configuracion.html'
];

for (const pagina of paginas) {
  test(`${pagina} contiene JavaScript inline válido`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', pagina), 'utf8');
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .map(coincidencia => coincidencia[1])
      .filter(codigo => codigo.trim());

    assert.ok(scripts.length > 0 || /<script\s+src=/.test(html));
    for (const codigo of scripts) {
      assert.doesNotThrow(() => new Function(codigo));
    }
  });
}

test('app.js contiene JavaScript válido', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.doesNotThrow(() => new Function(codigo));
});

test('market-search.js contiene JavaScript válido', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'market-search.js'), 'utf8');
  assert.doesNotThrow(() => new Function(codigo));
});

test('el comparador permite buscar competiciones por país y equipos por nombre', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const estilos = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(codigo, /Buscar liga o país/);
  assert.match(codigo, /Buscar equipo/);
  assert.match(codigo, /coincideBusqueda/);
  assert.match(codigo, /league-picker-group/);
  assert.doesNotMatch(codigo, />8 ligas disponibles</);
  assert.match(estilos, /\.team-picker-list \{ position:static/);
  assert.doesNotMatch(estilos, /\.compare-action\.is-ready \{ position:sticky/);
});

test('el calendario pluraliza correctamente la palabra competición', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'calendario.html'), 'utf8');
  assert.doesNotMatch(html, /competición\$\{competiciones\.length === 1 \? '' : 'es'\}/);
  assert.match(html, /\? 'competición' : 'competiciones'/);
});

test('el calendario evita ligas duplicadas y permite contraer sus grupos', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'calendario.html'), 'utf8');
  assert.doesNotMatch(html, /const susLigas =/);
  assert.match(html, /data-league-group/);
  assert.match(html, /data-leagues-action="expandir"/);
  assert.match(html, /data-leagues-action="contraer"/);
  assert.match(html, /loading="lazy" decoding="async"/);
});

test('el calendario permite filtrar por estado y rango de hora local', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'calendario.html'), 'utf8');
  assert.match(html, /data-status-filter="terminado"/);
  assert.match(html, /data-status-filter="en_juego"/);
  assert.match(html, /data-status-filter="no_iniciado"/);
  assert.match(html, /id="horaDesde"/);
  assert.match(html, /id="horaHasta"/);
  assert.match(html, /function coincideEstadoYHora/);
  assert.match(html, /p\.finalizado \|\| enJuego/);
  assert.match(html, /marcador \$\{enJuego \? 'live'/);
});

test('los picks del comparador reciben los filtros visibles de ambos equipos', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(codigo, /scope1: document\.getElementById\('scope-a'\)\.value/);
  assert.match(codigo, /limit2: document\.getElementById\('limit-b'\)\.value/);
  assert.match(codigo, /half1: document\.getElementById\('half-a'\)\.value/);
  assert.match(html, /también se usan al generar los picks/);
});

test('partido y comparador permiten filtrar todas las categorías y líneas exactas', () => {
  const partido = fs.readFileSync(path.join(__dirname, '..', 'public', 'partido.html'), 'utf8');
  const comparador = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(partido, />Todas<\/option>/);
  assert.match(partido, /Todas las líneas/);
  assert.match(comparador, /id="pick-scope"/);
  assert.match(comparador, /id="pick-direction"/);
  assert.match(comparador, /id="pick-line"/);
});

test('auth-client.js contiene JavaScript válido y monta Mis picks globales', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'auth-client.js'), 'utf8');
  assert.doesNotThrow(() => new Function(codigo));
  assert.match(codigo, /global-picks-widget/);
  assert.match(codigo, /futbol:picks-actualizados/);
});

test('los eventos anónimos del embudo tienen sintaxis válida y cobertura de vistas', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'product-events.js'), 'utf8');
  const landing = fs.readFileSync(path.join(__dirname, '..', 'public', 'landing.html'), 'utf8');
  const calendario = fs.readFileSync(path.join(__dirname, '..', 'public', 'calendario.html'), 'utf8');
  const comparador = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const suscripcion = fs.readFileSync(path.join(__dirname, '..', 'public', 'suscripcion.html'), 'utf8');

  assert.doesNotThrow(() => new Function(codigo));
  assert.match(codigo, /\.landing-cta/);
  assert.match(landing, /data-product-event="landing_view"/);
  assert.match(calendario, /data-product-event="calendar_view"/);
  assert.match(comparador, /data-product-event="comparator_view"/);
  assert.match(suscripcion, /data-product-event="subscription_view"/);
});

test('el registro limitado por IP redirige al aviso específico', () => {
  const login = fs.readFileSync(path.join(__dirname, '..', 'public', 'login.html'), 'utf8');
  const auth = fs.readFileSync(path.join(__dirname, '..', 'public', 'auth-client.js'), 'utf8');
  assert.match(login, /datos\.usuario\.motivo === 'ip_duplicada'/);
  assert.match(login, /\/?registro=ip_duplicada/);
  assert.match(auth, /parametros\.get\('registro'\) === 'ip_duplicada'/);
  assert.match(auth, /history\.replaceState/);
});

test('la prueba y el checkout enlazan condiciones y exigen consentimiento', () => {
  const landing = fs.readFileSync(path.join(__dirname, '..', 'public', 'landing.html'), 'utf8');
  const checkout = fs.readFileSync(path.join(__dirname, '..', 'public', 'suscripcion.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'suscripcion.js'), 'utf8');
  const terminos = fs.readFileSync(path.join(__dirname, '..', 'public', 'terminos.html'), 'utf8');

  assert.match(landing, /Una sola prueba gratuita por persona/);
  assert.match(landing, /href="\/terminos\.html"/);
  assert.match(checkout, /id="billing-consent"/);
  assert.match(checkout, /href="\/terminos\.html"/);
  assert.match(script, /acepta_terminos: true/);
  assert.match(terminos, /No está permitido crear, solicitar o utilizar cuentas adicionales/);
});

test('el panel de administración conecta sus controles sin eventos inline bloqueados por CSP', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  assert.doesNotMatch(html, /\son(?:click|change|input|submit)=/i);
  assert.match(html, /function instalarEventos\(\)/);
  assert.match(html, /data-accion="guardar-ticket"/);
  assert.match(html, /data-accion="cortesia"/);
  assert.match(html, /data-accion="extender"/);
});

test('los enfrentamientos del centro de partido exponen detalles desplegables', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'partido.html'), 'utf8');
  assert.match(html, /data-h2h-details/);
  assert.match(html, /alternarDetalleH2H/);
  assert.match(html, /Ver estadísticas/);
});

test('la ficha ofrece las estadísticas como una opción propia del partido', () => {
  const partido = fs.readFileSync(path.join(__dirname, '..', 'public', 'partido.html'), 'utf8');
  assert.match(partido, /data-match-tab="estadisticas"/);
  assert.doesNotMatch(partido, /data-match-tab="estadisticas" hidden/);
  assert.match(partido, /id="estadisticasPartido"/);
  assert.match(partido, /pintarEstadisticasPartido/);
  assert.match(partido, /Las estadísticas estarán disponibles cuando finalice/);
  assert.match(partido, /Jugador destacado/);
  assert.match(partido, /tarjetaJugadorPartido/);
  assert.match(partido, /Duelos ganados/);
  assert.match(partido, /id="fAlcanceLocal"/);
  assert.match(partido, /id="fAlcanceVisitante"/);
  assert.doesNotMatch(partido, /id="fAlcance"/);
});

test('la ficha permite buscar manualmente líneas sin depender de una casa', () => {
  const partido = fs.readFileSync(path.join(__dirname, '..', 'public', 'partido.html'), 'utf8');
  assert.match(partido, /id="periodoMercadoPartido"/);
  assert.match(partido, />Ambos equipos</);
  assert.match(partido, /id="tipoMercadoPartido"/);
  assert.match(partido, /id="lineaMercadoPartido"/);
  assert.match(partido, /function filtrarMercados/);
  assert.doesNotMatch(partido, /id="buscarMercadoPartido"/);
  assert.doesNotMatch(partido, /id="familiaMercadoPartido"/);
  assert.doesNotMatch(partido, /Playdoit · picks apostables/);
});

test('Mis picks permite explorar candidatos generales por línea', () => {
  const picks = fs.readFileSync(path.join(__dirname, '..', 'public', 'picks.html'), 'utf8');
  assert.match(picks, /Mejores picks generales/);
  assert.match(picks, /general-linea/);
  assert.match(picks, /general: '1'/);
  assert.match(picks, /general-pick/);
  assert.match(picks, /data-save-general/);
  assert.match(picks, /Guardar en Mis picks/);
  assert.match(picks, /data-explain-general/);
  assert.match(picks, /general-explanation-dialog/);
});

test('la ficha explora por línea exacta sin duplicar un ranking automático', () => {
  const partido = fs.readFileSync(path.join(__dirname, '..', 'public', 'partido.html'), 'utf8');
  assert.match(partido, /Explora los picks de este partido/);
  assert.match(partido, /linea === null \|\| item\.linea === linea/);
  assert.doesNotMatch(partido, /Mejores picks del partido/);
});

test('el directorio de competiciones agrupa temporadas y permite elegirlas', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'competiciones.html'), 'utf8');
  assert.match(html, /data-competition-season/);
  assert.match(html, /temporadas\.map/);
  assert.match(html, /ligas\/torneos únicos/);
  assert.match(html, /normalizarCatalogo/);
});

test('el directorio de equipos selecciona ligas y delega la temporada a la ficha', () => {
  const directorio = fs.readFileSync(path.join(__dirname, '..', 'public', 'equipos.html'), 'utf8');
  const ficha = fs.readFileSync(path.join(__dirname, '..', 'public', 'equipo.html'), 'utf8');
  assert.match(directorio, /allSeasons=true/);
  assert.match(directorio, /Buscar país o liga/);
  assert.match(directorio, /liga\.pais} \$\{liga\.nombre/);
  assert.match(directorio, /league-picker-group/);
  assert.doesNotMatch(directorio, /value="\$\{c\.id\}:\$\{c\.temporada\}"/);
  assert.match(ficha, /id="season"/);
  assert.match(ficha, /Menos de 2\.5 goles/);
  assert.match(ficha, /Producción por partido/);
  assert.match(ficha, /recent-opponent/);
});

test('user-library.js contiene JavaScript válido', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-library.js'), 'utf8');
  assert.doesNotThrow(() => new Function(codigo));
});

test('el directorio de jugadores separa competición y temporada', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'jugadores.html'), 'utf8');
  assert.match(html, /id="liga"/);
  assert.match(html, /id="temporada"/);
  assert.match(html, /pintarTemporadas/);
  assert.match(html, /&season=\$\{season\}/);
  assert.match(html, /if\(!league\|\|!season\)/);
  assert.match(html, /Elige una competición y una temporada/);
  assert.doesNotMatch(html, /const \[league,season\]=valor\.split/);
});

test('el formulario de tickets maneja respuestas HTML sin mostrar errores de JSON', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'sugerencias.html'), 'utf8');
  assert.match(html, /function leerRespuesta/);
  assert.match(html, /content-type/);
  assert.match(html, /servicio de tickets no está disponible/);
});

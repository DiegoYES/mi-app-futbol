const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET ||= 'secreto-de-pruebas-con-longitud-suficiente';

const mongoose = require('mongoose');
// Sin conexión a Mongo, una consulta queda en cola 10 s por defecto. Aquí lo
// que se comprueba es que el fallo se resuelva en 404, no cuánto tarda.
mongoose.set('bufferTimeoutMS', 200);

const jwt = require('jsonwebtoken');
const { app } = require('../server');
const {
  escaparRegex,
  revisarConfiguracionSegura,
  textoDeConsulta
} = require('../middleware/security');
const { duracionSesionMs } = require('../middleware/auth');
const { normalizarRuta } = require('../middleware/paginasPrivadas');

async function servidorTemporal(t) {
  const servidor = await new Promise(resolve => {
    const instancia = app.listen(0, '127.0.0.1', () => resolve(instancia));
  });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const { port } = servidor.address();
  return `http://127.0.0.1:${port}`;
}

test('el panel de administración no se sirve a visitantes anónimos', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/admin.html`);
  const cuerpo = await respuesta.text();

  assert.equal(respuesta.status, 404);
  assert.doesNotMatch(cuerpo, /Panel/i);
  assert.doesNotMatch(cuerpo, /cargarUsuarios/);
});

test('los scripts y estilos de administración devuelven 404 a visitantes anónimos', async t => {
  const baseUrl = await servidorTemporal(t);
  const archivos = ['/admin.js', '/admin-users.js', '/admin-picks.js', '/admin.css'];
  for (const archivo of archivos) {
    const res = await fetch(`${baseUrl}${archivo}`);
    assert.equal(res.status, 404, `${archivo} debió responder 404`);
  }
});

test('el panel de administración tampoco se filtra por variantes de la ruta', async t => {
  const baseUrl = await servidorTemporal(t);
  const variantes = ['/admin.html/', '//admin.html', '/./admin.html', '/%61dmin.html', '/ADMIN.HTML'];

  for (const ruta of variantes) {
    const respuesta = await fetch(`${baseUrl}${ruta}`, { redirect: 'manual' });
    assert.ok(
      respuesta.status >= 300,
      `${ruta} devolvió ${respuesta.status}; el panel no debe servirse`
    );
    const cuerpo = await respuesta.text();
    assert.doesNotMatch(cuerpo, /cargarUsuarios/, `${ruta} filtró el contenido del panel`);
  }
});

test('un token con rol de usuario no abre el panel de administración', async t => {
  const baseUrl = await servidorTemporal(t);
  // Firmado con el secreto real: el rol del token nunca sustituye al de la base.
  const token = jwt.sign({ id: '507f1f77bcf86cd799439011', rol: 'admin' }, process.env.JWT_SECRET);
  const respuesta = await fetch(`${baseUrl}/admin.html`, { headers: { cookie: `token=${token}` } });

  assert.equal(respuesta.status, 404);
});

test('la API de administración exige sesión', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/api/admin/usuarios`);
  const cuerpo = await respuesta.json();

  assert.equal(respuesta.status, 401);
  assert.equal(cuerpo.codigo, 'SIN_TOKEN');
});

test('la configuración de cuenta no se sirve a visitantes anónimos', async t => {
  const baseUrl = await servidorTemporal(t);
  const respuesta = await fetch(`${baseUrl}/configuracion.html`);
  const cuerpo = await respuesta.text();

  assert.equal(respuesta.status, 404);
  assert.doesNotMatch(cuerpo, /Cambiar contraseña/);
});

test('los cambios de cuenta exigen sesión y rechazan orígenes externos', async t => {
  const baseUrl = await servidorTemporal(t);
  const solicitudes = [
    ['/api/auth/perfil', 'PATCH', { nombre: 'Persona', preferencias: { formato_momio: 'ambos' } }],
    ['/api/auth/cambiar-password', 'POST', { password_actual: 'x', password_nueva: 'frase extensa de ejemplo' }],
    ['/api/auth/revocar-sesiones', 'POST', undefined]
  ];

  for (const [ruta, method, body] of solicitudes) {
    const respuesta = await fetch(`${baseUrl}${ruta}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    assert.equal(respuesta.status, 401, ruta);
  }

  const externa = await fetch(`${baseUrl}/api/auth/perfil`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: 'https://sitio-atacante.example' },
    body: JSON.stringify({ nombre: 'Persona', preferencias: { formato_momio: 'ambos' } })
  });
  assert.equal(externa.status, 403);
  assert.equal((await externa.json()).codigo, 'ORIGEN_NO_PERMITIDO');
});

test('la configuración pinta datos del servidor sólo con textContent o value', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'configuracion.html'), 'utf8');
  assert.doesNotMatch(codigo, /\.innerHTML\s*=/);
  assert.match(codigo, /cuenta-nombre'\)\.textContent/);
  assert.match(codigo, /config-nombre'\)\.value/);
});

test('normalizarRuta neutraliza codificaciones y recorridos', () => {
  assert.equal(normalizarRuta('/admin.html'), '/admin.html');
  assert.equal(normalizarRuta('//admin.html'), '/admin.html');
  assert.equal(normalizarRuta('/./admin.html'), '/admin.html');
  assert.equal(normalizarRuta('/%61dmin.html'), '/admin.html');
  assert.equal(normalizarRuta('/publico/../admin.html'), '/admin.html');
  assert.equal(normalizarRuta('/admin.html?x=1'), '/admin.html');
  assert.equal(normalizarRuta('/ADMIN.HTML'), '/admin.html');
  assert.equal(normalizarRuta('/%ZZ'), null);
  assert.equal(normalizarRuta('/admin.html%00.txt'), null);
});

test('escaparRegex anula los metacaracteres de una búsqueda', () => {
  const patron = escaparRegex('(a+)+$');
  assert.equal(patron, '\\(a\\+\\)\\+\\$');
  assert.ok(new RegExp(patron).test('(a+)+$'));
  assert.ok(!new RegExp(patron).test('aaaa'));
});

test('textoDeConsulta tolera arreglos, objetos y textos larguísimos', () => {
  assert.equal(textoDeConsulta(['uno', 'dos']), 'dos');
  assert.equal(textoDeConsulta({ $ne: null }), '');
  assert.equal(textoDeConsulta(undefined), '');
  assert.equal(textoDeConsulta('  hola  '), 'hola');
  assert.equal(textoDeConsulta('x'.repeat(500)).length, 80);
  assert.equal(textoDeConsulta('x'.repeat(500), 10).length, 10);
});

test('revisarConfiguracionSegura alerta de una puesta en producción insegura', () => {
  const avisos = revisarConfiguracionSegura({ NODE_ENV: 'production' });
  assert.equal(avisos.length, 2);
  assert.ok(avisos.some(aviso => /TRUST_PROXY/.test(aviso)));
  assert.ok(avisos.some(aviso => /APP_ORIGIN/.test(aviso)));

  const seguro = revisarConfiguracionSegura({
    NODE_ENV: 'production',
    TRUST_PROXY: '1',
    APP_ORIGIN: 'https://futbol.example.com'
  });
  assert.deepEqual(seguro, []);

  assert.ok(revisarConfiguracionSegura({}).some(aviso => /NODE_ENV/.test(aviso)));
});

test('ninguna ruta devuelve el mensaje interno de error al cliente', () => {
  const archivos = ['server.js', 'routes/admin.js', 'routes/boletas.js', 'routes/calendario.js',
    'routes/home.js', 'routes/jugadores.js', 'routes/picks.js', 'routes/auth.js'];

  for (const archivo of archivos) {
    const codigo = fs.readFileSync(path.join(__dirname, '..', archivo), 'utf8');
    assert.doesNotMatch(codigo, /error:\s*error\.message/, `${archivo} filtra error.message`);
  }
});

test('el frontend escapa los nombres de equipo del aviso de correlación', () => {
  const codigo = ['app.js', 'app-picks.js'].map(archivo => fs.readFileSync(path.join(__dirname, '..', 'public', archivo), 'utf8')).join(String.fromCharCode(10));
  const linea = codigo.split('\n').find(item => item.includes('bet-slip-correlation') === false
    && item.includes('Atención a la correlación'));

  assert.ok(linea, 'no se encontró el render del aviso de correlación');
  assert.match(linea, /escaparHtml\(aviso\)/);
});

test('las búsquedas con $regex sólo usan patrones escapados', () => {
  for (const archivo of ['routes/admin.js', 'routes/jugadores.js']) {
    const codigo = fs.readFileSync(path.join(__dirname, '..', archivo), 'utf8');
    const usos = codigo.match(/\$regex:\s*([A-Za-z_$][\w$.]*)/g) || [];
    assert.ok(usos.length > 0, `${archivo} debería seguir teniendo búsquedas por regex`);
    for (const uso of usos) {
      assert.doesNotMatch(uso, /\$regex:\s*(busqueda|q)\b/, `${archivo} usa el texto crudo en ${uso}`);
    }
  }
});

test('el login mitiga timing attacks evaluando hash simulado si el usuario no existe', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  assert.match(codigo, /HASH_DUMMY/, 'falta hash dummy para timing attacks');
  assert.match(codigo, /hashParaComparar\s*=\s*usuario\?\.password\s*\|\|\s*HASH_DUMMY/, 'no se compara con hash dummy cuando el usuario es nulo');
});

test('todas las agregaciones de usuario y rutas incluyen maxTimeMS defensivo', () => {
  const rutas = ['routes/home.js', 'routes/jugadores.js', 'routes/calendario.js', 'routes/admin.js', 'services/dataQuality.js', 'services/betting/predictionEvaluationService.js'];
  for (const archivo of rutas) {
    const codigo = fs.readFileSync(path.join(__dirname, '..', archivo), 'utf8');
    const conteoAggregate = (codigo.match(/\.aggregate\(/g) || []).length;
    const conteoMaxTime = (codigo.match(/maxTimeMS/g) || []).length;
    assert.ok(conteoAggregate > 0, `${archivo} debería tener agregaciones`);
    assert.equal(conteoMaxTime, conteoAggregate, `${archivo} tiene ${conteoAggregate} aggregate(s) pero ${conteoMaxTime} maxTimeMS`);
  }
});

test('las rutas administrativas validan el identificador ObjectId', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
  assert.match(codigo, /function validarIdMongo/, 'falta middleware validarIdMongo');
  assert.match(codigo, /mongoose\.isValidObjectId/, 'no se usa isValidObjectId');
});

test('la ruta de explicacion de mercado valida el identificador de mercado', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../routes/picks.js'), 'utf8');
  assert.match(codigo, /mercadoId = String\(req\.params\.mercado/, 'no extrae mercadoId de params');
  assert.match(codigo, /\[a-zA-Z0-9_.-]\{2,64\}/, 'no valida formato alfanumérico seguro');
});

test('el H2H exige dos equipos enteros y distintos antes de consultar Mongo', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const inicio = codigo.indexOf("app.get('/api/equipos/h2h'");
  const bloque = codigo.slice(inicio, codigo.indexOf('Partido.find(filtro)', inicio));
  assert.ok(inicio > -1, 'no existe la ruta /api/equipos/h2h');
  assert.match(bloque, /Number\.parseInt\(req\.query\.team1, 10\)/, 'team1 debe parsearse con radix');
  assert.match(bloque, /\[team1, team2\]\.every\(Number\.isInteger\)/, 'falta comprobar que ambos equipos sean enteros');
  assert.match(bloque, /team1 === team2/, 'falta rechazar el mismo equipo dos veces');
  assert.doesNotMatch(bloque, /[^.]parseInt\(req\.query\.\w+\)/, 'no debe quedar parseInt sin radix');
  assert.match(bloque, /leagueId !== null && !Number\.isInteger\(leagueId\)/, 'una competición no numérica debe responder 400');
  assert.match(bloque, /season !== null && !Number\.isInteger\(season\)/, 'una temporada no numérica debe responder 400');
  assert.match(bloque, /La temporada no es válida\./, 'falta el mensaje de temporada inválida');
  assert.doesNotMatch(bloque, /if \(Number\.isInteger\(season\)\) filtro/, 'season=abc no debe ignorarse en silencio');
});

test('el checkout de suscripción se serializa por usuario con cerrojo en Mongo', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../routes/billing.js'), 'utf8');
  assert.match(codigo, /crearBloqueoTrabajo\(\{ leaseMs: 30_000 \}\)/, 'falta crear el cerrojo por petición');
  assert.match(codigo, /`billing:subscribe:\$\{req\.usuario\._id\}`/, 'el cerrojo debe ser por usuario');
  assert.match(codigo, /CHECKOUT_EN_CURSO/, 'falta responder 409 cuando otro checkout está en curso');
  assert.match(codigo, /cerrojo\.liberar\(nombreCerrojo\)/, 'el cerrojo debe liberarse en finally');
});

test('el buscador spotlight escapa el catálogo antes de insertarlo con innerHTML', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../public/spotlight-search.js'), 'utf8');
  assert.match(codigo, /function esc\(valor\)/, 'falta el helper esc()');
  const inicio = codigo.indexOf('resultsEl.innerHTML = itemsAMostrar');
  assert.ok(inicio > -1, 'no se encontró el render de resultados');
  const plantilla = codigo.slice(inicio, codigo.indexOf(".join('')", inicio));
  for (const campo of ['url', 'icono', 'nombre', 'sub']) {
    assert.match(plantilla, new RegExp(`\\$\\{esc\\(item\\.${campo}\\)\\}`), `item.${campo} debe pasar por esc()`);
    assert.doesNotMatch(plantilla, new RegExp(`\\$\\{item\\.${campo}\\}`), `item.${campo} no debe interpolarse sin escapar`);
  }
});

test('el buscador spotlight descarta items con href/src fuera de la allowlist de protocolos', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../public/spotlight-search.js'), 'utf8');
  assert.match(codigo, /resultados\.filter\(itemSeguro\)/, 'los resultados deben filtrarse con itemSeguro antes de renderizar');
  assert.match(codigo, /urlSegura\(item\.url\) && urlSegura\(item\.icono\)/, 'itemSeguro debe validar url e icono');

  const inicio = codigo.indexOf('function urlSegura(valor)');
  assert.ok(inicio > -1, 'falta el helper urlSegura()');
  const fin = codigo.indexOf('\n  }\n', inicio) + 4;
  const urlSegura = new Function(`${codigo.slice(inicio, fin)}; return urlSegura;`)();

  for (const permitida of ['/competicion.html?id=262', '/api/ligas/262/logo', '/brand-mark.svg', 'https://data-fut.com/x', 'http://localhost:3000/x', 'data:image/png;base64,AAAA']) {
    assert.equal(urlSegura(permitida), true, `${permitida} debería aceptarse`);
  }
  for (const bloqueada of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.com/x', 'ftp://x', 'competicion.html', '', null, undefined]) {
    assert.equal(urlSegura(bloqueada), false, `${String(bloqueada)} debería rechazarse`);
  }
});

test('los modelos declaran los índices de sync, boleta e IP sin tocar documentos', () => {
  const partido = fs.readFileSync(path.join(__dirname, '../models/partido.js'), 'utf8');
  const usuario = fs.readFileSync(path.join(__dirname, '../models/Usuario.js'), 'utf8');
  assert.match(partido, /name: 'sync_estadisticas_pendientes'/, 'falta el índice de estadísticas pendientes');
  assert.match(partido, /name: 'sync_detalle_pendiente'/, 'falta el índice de detalle pendiente');
  assert.match(partido, /name: 'boleta_equipos_fecha'/, 'falta el índice del fallback por equipos');
  assert.match(usuario, /name: 'usuario_ip_registro'/, 'falta el índice de IP de registro');
});

test('desde-boleta resuelve partidos en batch en vez de un findOne por selección', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
  const inicio = codigo.indexOf('/recomendaciones/desde-boleta/');
  const bloque = codigo.slice(inicio, codigo.indexOf('Recomendacion.create', inicio));
  assert.ok(inicio > -1, 'no existe la ruta desde-boleta');
  assert.match(bloque, /api_id: \{ \$in: ids/, 'falta la consulta batch por api_id');
  assert.match(bloque, /partidosPorApiId\.get\(sel\.partido_api_id\)/, 'falta el mapa por api_id');
  assert.doesNotMatch(bloque, /await Partido\.findOne\(\{ api_id: sel\.partido_api_id \}\)/, 'no debe quedar findOne por selección');
});

test('el otorgamiento premium usa $set atómico y nunca save() del documento', () => {
  const webhook = fs.readFileSync(path.join(__dirname, '../routes/mercadoPagoWebhook.js'), 'utf8');
  const billing = fs.readFileSync(path.join(__dirname, '../routes/billing.js'), 'utf8');
  assert.match(webhook, /Usuario\.findByIdAndUpdate\(usuario\._id, \{\s*\$set: \{ plan: 'premium'/, 'el webhook debe otorgar premium con $set atómico');
  assert.doesNotMatch(webhook, /usuario\.save\(\)/, 'el webhook no debe guardar el documento completo');
  assert.match(billing, /Usuario\.findByIdAndUpdate\(req\.usuario\._id, \{\s*\$set: \{ plan: 'premium'/, 'la reconciliación debe otorgar premium con $set atómico');
  assert.doesNotMatch(billing, /req\.usuario\.save\(\)/, 'la reconciliación no debe guardar el documento completo');
});

test('la cookie de sesión vive lo mismo que el token (7d por defecto)', () => {
  assert.equal(duracionSesionMs('7d'), 7 * 24 * 60 * 60 * 1000, '7d debe dar 7 días en ms');
  assert.equal(duracionSesionMs('30d'), 30 * 24 * 60 * 60 * 1000, 'respeta JWT_EXPIRA cuando se configura');
  assert.equal(duracionSesionMs('basura'), 7 * 24 * 60 * 60 * 1000, 'un valor inválido cae a 7d');
  const auth = fs.readFileSync(path.join(__dirname, '../middleware/auth.js'), 'utf8');
  assert.match(auth, /JWT_EXPIRA = process\.env\.JWT_EXPIRA \|\| '7d'/, 'el default debe ser 7d como en .env.example');
  const rutas = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  assert.match(rutas, /maxAge: duracionSesionMs\(\)/, 'la cookie debe derivar su maxAge del token');
  assert.doesNotMatch(rutas, /maxAge: 30 \* 24 \* 60 \* 60 \* 1000/, 'no debe quedar maxAge fijo de 30d');
});

test('el sync nunca convierte dato ausente en cero ni pisa detalle existente', () => {
  const syncDb = fs.readFileSync(path.join(__dirname, '../scripts/syncDatabase.js'), 'utf8');
  assert.doesNotMatch(syncDb, /parseInt\(s\.find\(x => x\.type/, 'extraerStats no debe usar parseInt con || 0');
  assert.match(syncDb, /valorEstadistica\(s, 'Total Shots'\)/, 'usa el helper nulable como completarEstadisticas.js');
  const calendario = fs.readFileSync(path.join(__dirname, '../scripts/syncCalendario.js'), 'utf8');
  assert.match(calendario, /\$setOnInsert/, 'el upsert de calendario debe llevar defaults sólo para inserts');
  const eventos = fs.readFileSync(path.join(__dirname, '../scripts/guardarEventos.js'), 'utf8');
  assert.match(eventos, /jugador_id \|\| e\?\.jugador/, 'debe detectar eventos ricos antes de escribir');
  assert.match(eventos, /eventos_no_disponibles: \{ \$ne: true \}/, 'no debe reintentar huecos vacíos sin SYNC_RETRY_GAPS');
});

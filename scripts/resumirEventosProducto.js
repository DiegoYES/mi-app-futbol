const { EVENTOS_PRODUCTO } = require('../services/productEvents');

function parsearArgumentos(argv) {
  const indice = argv.indexOf('--environment');
  return { entorno: indice >= 0 ? argv[indice + 1] : null };
}

function resumirLineas(contenido, { entorno = null } = {}) {
  const conteos = Object.fromEntries(EVENTOS_PRODUCTO.map(evento => [evento, 0]));
  let total = 0;
  for (const linea of contenido.split(/\r?\n/)) {
    const inicio = linea.indexOf('[product-event] ');
    if (inicio < 0) continue;
    try {
      const registro = JSON.parse(linea.slice(inicio + '[product-event] '.length));
      if (!Object.hasOwn(conteos, registro.event)) continue;
      if (entorno && registro.environment !== entorno) continue;
      conteos[registro.event] += 1;
      total += 1;
    } catch (_) {
      // Los mensajes ajenos o truncados del journal se ignoran.
    }
  }
  return { total, conteos };
}

function imprimirResumen(resumen, { entorno = null } = {}) {
  console.log(`Eventos de producto${entorno ? ` · ${entorno}` : ''}: ${resumen.total}`);
  for (const evento of EVENTOS_PRODUCTO) console.log(`${evento}: ${resumen.conteos[evento]}`);
}

if (require.main === module) {
  const opciones = parsearArgumentos(process.argv.slice(2));
  let contenido = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', fragmento => { contenido += fragmento; });
  process.stdin.on('end', () => imprimirResumen(resumirLineas(contenido, opciones), opciones));
}

module.exports = { parsearArgumentos, resumirLineas };

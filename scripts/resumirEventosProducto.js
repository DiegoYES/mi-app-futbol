const { EVENTOS_PRODUCTO } = require('../services/productEvents');

function parsearArgumentos(argv) {
  const indiceEntorno = argv.indexOf('--environment');
  const indiceMuestra = argv.indexOf('--minimum-sample');
  const muestraPedida = indiceMuestra >= 0 ? Number.parseInt(argv[indiceMuestra + 1], 10) : 50;
  return {
    entorno: indiceEntorno >= 0 ? argv[indiceEntorno + 1] : null,
    muestraMinima: Number.isInteger(muestraPedida) && muestraPedida > 0 ? muestraPedida : 50
  };
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

function tasa(numerador, denominador) {
  return denominador > 0 ? Number(((numerador / denominador) * 100).toFixed(1)) : null;
}

function calcularTasas(conteos, muestraMinima = 50) {
  const registros = conteos.registration_active + conteos.registration_ip_limited;
  return {
    landingACta: tasa(conteos.trial_cta_click, conteos.landing_view),
    ctaARegistro: tasa(registros, conteos.trial_cta_click),
    registrosActivos: tasa(conteos.registration_active, registros),
    registroACheckout: tasa(conteos.checkout_started, registros),
    registros,
    muestraSuficiente: conteos.landing_view >= muestraMinima,
    muestraMinima
  };
}

function formatoTasa(valor, numerador, denominador) {
  return `${valor == null ? '—' : `${valor}%`} (${numerador}/${denominador})`;
}

function imprimirResumen(resumen, { entorno = null, muestraMinima = 50 } = {}) {
  console.log(`Eventos de producto${entorno ? ` · ${entorno}` : ''}: ${resumen.total}`);
  for (const evento of EVENTOS_PRODUCTO) console.log(`${evento}: ${resumen.conteos[evento]}`);
  const tasas = calcularTasas(resumen.conteos, muestraMinima);
  console.log('Tasas agregadas de eventos (no usuarios únicos):');
  console.log(`landing → CTA: ${formatoTasa(tasas.landingACta, resumen.conteos.trial_cta_click, resumen.conteos.landing_view)}`);
  console.log(`CTA → registro: ${formatoTasa(tasas.ctaARegistro, tasas.registros, resumen.conteos.trial_cta_click)}`);
  console.log(`registros con prueba activa: ${formatoTasa(tasas.registrosActivos, resumen.conteos.registration_active, tasas.registros)}`);
  console.log(`registro → checkout: ${formatoTasa(tasas.registroACheckout, resumen.conteos.checkout_started, tasas.registros)}`);
  console.log(`Muestra: ${tasas.muestraSuficiente ? 'suficiente' : 'insuficiente'} (${resumen.conteos.landing_view}/${tasas.muestraMinima} vistas landing)`);
}

if (require.main === module) {
  const opciones = parsearArgumentos(process.argv.slice(2));
  let contenido = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', fragmento => { contenido += fragmento; });
  process.stdin.on('end', () => imprimirResumen(resumirLineas(contenido, opciones), opciones));
}

module.exports = { calcularTasas, parsearArgumentos, resumirLineas };

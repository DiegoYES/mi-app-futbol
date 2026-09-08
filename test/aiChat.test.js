const test = require('node:test');
const assert = require('node:assert/strict');
const { SYSTEM_INSTRUCTION, sanitizarRespuesta, responderConsulta } = require('../services/aiChat');

test('SYSTEM_INSTRUCTION contiene lineamientos clave de Data-Fut', () => {
  assert.match(SYSTEM_INSTRUCTION, /FutBot/);
  assert.match(SYSTEM_INSTRUCTION, /data-fut\.com/);
  assert.match(SYSTEM_INSTRUCTION, /Comparador/);
  assert.match(SYSTEM_INSTRUCTION, /Mejores Picks/);
  assert.match(SYSTEM_INSTRUCTION, /Mis Boletas/);
  assert.match(SYSTEM_INSTRUCTION, /Over\/Under/);
  assert.match(SYSTEM_INSTRUCTION, /BTTS/);
  assert.match(SYSTEM_INSTRUCTION, /\$70 MXN/);
  assert.match(SYSTEM_INSTRUCTION, /Juego Responsable/);
});

test('responderConsulta rechaza mensajes vacíos o solo espacios', async () => {
  const r1 = await responderConsulta('');
  assert.equal(r1.ok, false);
  assert.match(r1.error, /no puede estar vacío/);

  const r2 = await responderConsulta('   ');
  assert.equal(r2.ok, false);
  assert.match(r2.error, /no puede estar vacío/);

  const r3 = await responderConsulta(null);
  assert.equal(r3.ok, false);
  assert.match(r3.error, /no puede estar vacío/);
});

test('responderConsulta rechaza mensajes de más de 400 caracteres', async () => {
  const mensajeLargo = 'a'.repeat(401);
  const res = await responderConsulta(mensajeLargo);
  assert.equal(res.ok, false);
  assert.match(res.error, /400 caracteres/);
});

test('responderConsulta responde con aviso amigable si no hay API key configurada', async () => {
  const res = await responderConsulta('¿Qué es Data-Fut?', { apiKey: '' });
  assert.equal(res.ok, true);
  assert.match(res.respuesta, /fase de configuración/i);
});

test('responderConsulta maneja respuestas exitosas de Gemini', async () => {
  const mockFetch = async (url, options) => {
    assert.match(url, /key=test-api-key/);
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].parts[0].text, '¿Cómo uso el comparador?');
    assert.ok(body.system_instruction);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'El comparador te permite analizar dos equipos frente a frente.' }]
            }
          }
        ]
      })
    };
  };

  const res = await responderConsulta('¿Cómo uso el comparador?', {
    apiKey: 'test-api-key',
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, true);
  assert.equal(res.respuesta, 'El comparador te permite analizar dos equipos frente a frente.');
});

test('responderConsulta maneja límite de cuota (HTTP 429) elegantemente sin romper', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: 'RESOURCE_EXHAUSTED' } })
  });

  const res = await responderConsulta('Dame estadísticas', {
    apiKey: 'test-api-key',
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, true);
  assert.match(res.respuesta, /límite de consultas/i);
});

test('responderConsulta maneja errores 500 de API con mensaje amigable', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: { message: 'Internal error' } })
  });

  const res = await responderConsulta('Hola bot', {
    apiKey: 'test-api-key',
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, true);
  assert.match(res.respuesta, /No pude procesar tu consulta/i);
});

test('responderConsulta maneja respuestas sin candidatos válidos', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [] })
  });

  const res = await responderConsulta('Pregunta extraña', {
    apiKey: 'test-api-key',
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, true);
  assert.match(res.respuesta, /No tengo una respuesta clara/i);
});

test('responderConsulta maneja timeout (AbortError)', async () => {
  const mockFetch = async () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  };

  const res = await responderConsulta('Pregunta lenta', {
    apiKey: 'test-api-key',
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, true);
  assert.match(res.respuesta, /tardó demasiado/i);
});

test('sanitizarRespuesta remueve rutas tecnicas y convierte enlaces markdown en texto limpio', () => {
  const texto = 'Visita nuestra sección de **[Mejores Picks](/picks.html)** o el Comparador (/comparador.html) para analizar.';
  const limpio = sanitizarRespuesta(texto);
  assert.equal(limpio, 'Visita nuestra sección de **Mejores Picks** o el Comparador para analizar.');

  const textoConUrls = 'Entra a https://data-fut.com/picks.html o revisa /calendario y /picks directamente.';
  const limpio2 = sanitizarRespuesta(textoConUrls);
  assert.equal(limpio2, 'Entra a Data-Fut o revisa el Calendario y la sección de Mejores Picks directamente.');
});

test('formatearContextoDeportivo estructura partidos y picks correctamente', () => {
  const { formatearContextoDeportivo } = require('../services/aiChat');
  assert.equal(formatearContextoDeportivo(null), '');
  assert.equal(formatearContextoDeportivo('invalido'), '');
  assert.equal(formatearContextoDeportivo({}), '');

  const contexto = {
    pagina: 'Comparador',
    partido: 'Real Madrid vs Barcelona',
    liga: 'La Liga',
    candidatos: [
      { mercado: 'Over 2.5 goles', estimacion: 82, confianza: 'alta', muestra: 20 },
      { mercado: 'Over 8.5 córners', estimacion: 75, confianza: 'media', muestra: 20 }
    ],
    mercados: [
      { mercado: 'Over 1.5 goles', estimacion: 90, confianza: 'alta' }
    ]
  };

  const bloque = formatearContextoDeportivo(contexto);
  assert.match(bloque, /\[Contexto actual del usuario en pantalla\]:/);
  assert.match(bloque, /Pantalla activa: Comparador/);
  assert.match(bloque, /Partido en análisis: Real Madrid vs Barcelona \(La Liga\)/);
  assert.match(bloque, /Over 2\.5 goles \(Estimación: 82%, Confianza: alta, Muestra: 20 partidos\)/);
  assert.match(bloque, /Over 1\.5 goles \(Estimación: 90%, Confianza: alta\)/);
});

test('responderConsulta inyecta el bloque de contexto en el system_instruction de Gemini', async () => {
  let systemInstructionCapturado = '';
  const mockFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    systemInstructionCapturado = body.system_instruction?.parts?.[0]?.text || '';
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Para este partido, el Over 2.5 goles tiene 82% de respaldo.' }] } }]
      })
    };
  };

  const res = await responderConsulta('¿Qué pick recomiendas?', {
    apiKey: 'test-api-key',
    fetchImpl: mockFetch,
    contexto: {
      pagina: 'Comparador',
      partido: 'América vs Chivas',
      candidatos: [{ mercado: 'Over 2.5 goles', estimacion: 82, confianza: 'alta' }]
    }
  });

  assert.equal(res.ok, true);
  assert.match(systemInstructionCapturado, /América vs Chivas/);
  assert.match(systemInstructionCapturado, /Over 2\.5 goles/);
  assert.match(res.respuesta, /Over 2\.5 goles/);
});

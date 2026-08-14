const test = require('node:test');
const assert = require('node:assert/strict');
const { analizarLinea, normalizarRuta, opciones, resumir } = require('../scripts/resumirLatenciaNginx');

function linea({ ruta, estado = 200, rt, urt = rt, upstream = '127.0.0.1:3000', host = 'data-fut.com' }) {
  return `127.0.0.1 - - [14/Aug/2026:06:11:54 +0000] "GET ${ruta} HTTP/2.0" ${estado} 63 "-" "test" host=${host} rt=${rt} urt=${urt} uaddr=${upstream} ustatus=${estado}`;
}

test('ignora logs anteriores que no contienen métricas de tiempo', () => {
  assert.equal(analizarLinea('127.0.0.1 - - "GET / HTTP/2.0" 200 10 "-" "test"'), null);
});

test('elimina queries y normaliza identificadores antes de agrupar', () => {
  assert.equal(normalizarRuta('/api/partido/123?token=secreto'), '/api/partido/:id');
  assert.equal(normalizarRuta('/reset/abcdefghijklmnopqrstuvwxyz'), '/reset/:token');
  const fila = analizarLinea(linea({ ruta: '/api/partido/456?email=privado@example.com', rt: '0.012' }));
  assert.equal(fila.ruta, '/api/partido/:id');
  assert.equal(JSON.stringify(fila).includes('privado'), false);
});

test('separa hosts y conserva compatibilidad con líneas anteriores', () => {
  const anterior = analizarLinea(linea({ ruta: '/', rt: '0.010' }).replace('host=data-fut.com ', ''));
  assert.equal(anterior.host, 'desconocido');
  assert.equal(analizarLinea(linea({ ruta: '/', rt: '0.010', host: 'staging.data-fut.com' })).host, 'staging.data-fut.com');
  assert.equal(opciones(['--host', 'data-fut.com', '--top', '10']).host, 'data-fut.com');
});

test('calcula latencia, errores e instancias por ruta normalizada', () => {
  const filas = [
    analizarLinea(linea({ ruta: '/api/partido/1', rt: '0.010', urt: '0.008' })),
    analizarLinea(linea({ ruta: '/api/partido/2', rt: '0.020', urt: '0.018', upstream: '127.0.0.1:3001' })),
    analizarLinea(linea({ ruta: '/api/partido/3', estado: 503, rt: '0.100', urt: '-' }))
  ];
  const [grupo] = resumir(filas);
  assert.deepEqual(grupo, {
    host: 'data-fut.com',
    ruta: 'GET /api/partido/:id',
    solicitudes: 3,
    promedio_ms: 43.33,
    p95_ms: 100,
    p99_ms: 100,
    max_ms: 100,
    upstream_promedio_ms: 13,
    errores_5xx: 1,
    instancias: '127.0.0.1:3000,127.0.0.1:3001'
  });
});

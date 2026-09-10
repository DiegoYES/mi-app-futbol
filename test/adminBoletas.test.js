const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');

process.env.JWT_SECRET ||= 'secreto-de-pruebas-con-longitud-suficiente-para-firmar-tokens';

const Usuario = require('../models/Usuario');
const Boleta = require('../models/Boleta');
const { firmarToken } = require('../middleware/auth');
const routerAdmin = require('../routes/admin');

test('GET /api/admin/boletas-usuarios restringe acceso y protege datos sensibles', async t => {
  const Partido = require('../models/partido');
  const origFind = Boleta.find;
  const origFindById = Usuario.findById;
  const origPartidoFind = Partido.find;

  Partido.find = () => ({
    sort: () => ({
      lean: async () => []
    }),
    lean: async () => []
  });

  // Mock de Usuario.findById para autenticación de middleware
  Usuario.findById = async (id) => {
    let rol = 'usuario';
    if (id === 'admin-id') rol = 'admin';
    if (id === 'marketing-id') rol = 'marketing';
    return {
      _id: id,
      rol,
      activo: true,
      sesion_version: 0,
      estadoAcceso() {
        return { tieneAcceso: true, plan: 'premium', motivo: rol, diasRestantes: null };
      }
    };
  };

  // Mock de Boleta.find con populate
  Boleta.find = () => {
    return {
      sort() {
        return {
          limit() {
            return {
              populate() {
                return {
                  lean: async () => [
                    {
                      _id: 'boleta-1',
                      nombre: 'Parlay Viernes de Liga MX',
                      creada_en: new Date('2026-09-09T18:00:00Z'),
                      usuario: {
                        _id: 'user-a',
                        nombre: 'Juan Perez',
                        email: 'juan@test.com',
                        plan: 'premium',
                        rol: 'usuario',
                        fecha_registro: new Date('2026-08-01'),
                        ultimo_acceso: new Date('2026-09-09')
                      },
                      selecciones: [
                        {
                          partido_api_id: 101,
                          local: { id: 1, nombre: 'América' },
                          visitante: { id: 2, nombre: 'Chivas' },
                          mercado: { id: 'over_25', nombre: 'Más de 2.5 goles' },
                          estimacion: 65,
                          confianza: 'alta'
                        }
                      ]
                    },
                    {
                      _id: 'boleta-2',
                      nombre: 'Combinada Sábado',
                      creada_en: new Date('2026-09-09T19:00:00Z'),
                      usuario: {
                        _id: 'user-a',
                        nombre: 'Juan Perez',
                        email: 'juan@test.com',
                        plan: 'premium',
                        rol: 'usuario',
                        fecha_registro: new Date('2026-08-01'),
                        ultimo_acceso: new Date('2026-09-09')
                      },
                      selecciones: [
                        {
                          partido_api_id: 102,
                          local: { id: 3, nombre: 'Cruz Azul' },
                          visitante: { id: 4, nombre: 'Pumas' },
                          mercado: { id: 'btts_yes', nombre: 'Ambos anotan: Sí' },
                          estimacion: 70,
                          confianza: 'alta'
                        }
                      ]
                    },
                    {
                      _id: 'boleta-3',
                      nombre: 'Boleta Domingo',
                      creada_en: new Date('2026-09-09T20:00:00Z'),
                      usuario: {
                        _id: 'user-b',
                        nombre: 'Maria Gomez',
                        email: 'maria@test.com',
                        plan: 'prueba',
                        rol: 'usuario',
                        fecha_registro: new Date('2026-09-05'),
                        ultimo_acceso: new Date('2026-09-09')
                      },
                      selecciones: [
                        {
                          partido_api_id: 103,
                          local: { id: 5, nombre: 'Toluca' },
                          visitante: { id: 6, nombre: 'Tigres' },
                          mercado: { id: 'under_25', nombre: 'Menos de 2.5 goles' },
                          estimacion: 55,
                          confianza: 'media'
                        }
                      ]
                    }
                  ]
                };
              }
            };
          }
        };
      }
    };
  };

  t.after(() => {
    Usuario.findById = origFindById;
    Boleta.find = origFind;
    Partido.find = origPartidoFind;
  });

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/admin', routerAdmin);

  const servidor = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const { port } = servidor.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const tokenAdmin = firmarToken({ _id: 'admin-id', rol: 'admin', sesion_version: 0 });
  const tokenMarketing = firmarToken({ _id: 'marketing-id', rol: 'marketing', sesion_version: 0 });
  const tokenUsuario = firmarToken({ _id: 'usuario-id', rol: 'usuario', sesion_version: 0 });

  // 1. Visitante anónimo -> 401 SIN_TOKEN
  const resAnon = await fetch(`${baseUrl}/api/admin/boletas-usuarios`);
  assert.equal(resAnon.status, 401);

  // 2. Usuario normal -> 403 NO_AUTORIZADO
  const resUser = await fetch(`${baseUrl}/api/admin/boletas-usuarios`, {
    headers: { Authorization: `Bearer ${tokenUsuario}` }
  });
  assert.equal(resUser.status, 403);
  const dataUser = await resUser.json();
  assert.equal(dataUser.codigo, 'NO_AUTORIZADO');

  // 3. Admin -> 200 OK
  const resAdmin = await fetch(`${baseUrl}/api/admin/boletas-usuarios`, {
    headers: { Authorization: `Bearer ${tokenAdmin}` }
  });
  assert.equal(resAdmin.status, 200);
  const dataAdmin = await resAdmin.json();

  // 4. Marketing -> 200 OK
  const resMarketing = await fetch(`${baseUrl}/api/admin/boletas-usuarios`, {
    headers: { Authorization: `Bearer ${tokenMarketing}` }
  });
  assert.equal(resMarketing.status, 200);
  const dataMarketing = await resMarketing.json();

  // 5. Validar estructura agrupada por usuario
  assert.equal(dataAdmin.resumen.totalUsuarios, 2, 'Deben haber 2 usuarios con boletas');
  assert.equal(dataAdmin.resumen.totalBoletas, 3, 'Deben haber 3 boletas en total');
  assert.equal(dataAdmin.usuarios.length, 2);

  const userA = dataAdmin.usuarios.find(u => u.usuario.id === 'user-a');
  assert.ok(userA, 'Usuario A debe existir');
  assert.equal(userA.totalBoletas, 2, 'Usuario A debe tener 2 boletas');
  assert.equal(userA.boletas.length, 2);

  const userB = dataAdmin.usuarios.find(u => u.usuario.id === 'user-b');
  assert.ok(userB, 'Usuario B debe existir');
  assert.equal(userB.totalBoletas, 1, 'Usuario B debe tener 1 boleta');

  // 6. VALIDACIÓN ESTRICTA DE SEGURIDAD / PRIVACIDAD: Cero fuga de contraseñas, tokens e IPs
  const payloadStr = JSON.stringify(dataAdmin);
  assert.doesNotMatch(payloadStr, /"password"/i, 'Nunca debe exponer la propiedad password');
  assert.doesNotMatch(payloadStr, /"ip_registro"/i, 'Nunca debe exponer ip_registro');
  assert.doesNotMatch(payloadStr, /"ip_ultimo_acceso"/i, 'Nunca debe exponer ip_ultimo_acceso');
  assert.doesNotMatch(payloadStr, /"token_verificacion"/i, 'Nunca debe exponer token_verificacion');

  for (const grupo of dataAdmin.usuarios) {
    const u = grupo.usuario;
    assert.equal('password' in u, false);
    assert.equal('ip_registro' in u, false);
    assert.equal('ip_ultimo_acceso' in u, false);
    assert.equal('token_verificacion' in u, false);
    assert.ok(u.id);
    assert.ok(u.nombre);
    assert.ok(u.email);
    assert.ok(u.plan);
  }

  // 7. Prueba de filtro por búsqueda ?q=
  const resBusqueda = await fetch(`${baseUrl}/api/admin/boletas-usuarios?q=Toluca`, {
    headers: { Authorization: `Bearer ${tokenAdmin}` }
  });
  assert.equal(resBusqueda.status, 200);
  const dataBusqueda = await resBusqueda.json();
  assert.equal(dataBusqueda.usuarios.length, 1);
  assert.equal(dataBusqueda.usuarios[0].usuario.id, 'user-b');
});

test('POST /api/admin/recomendaciones/desde-boleta/:id permite a marketing y admin publicar una recomendación', async t => {
  const origFindById = Usuario.findById;
  const origBoletaFindById = Boleta.findById;
  const Recomendacion = require('../models/Recomendacion');
  const origRecCreate = Recomendacion.create;
  const Partido = require('../models/partido');
  const origPartidoFindOne = Partido.findOne;
  Partido.findOne = () => ({
    lean: async () => null,
    sort: () => ({ lean: async () => null })
  });

  Usuario.findById = async (id) => ({
    _id: id,
    rol: id === 'marketing-id' ? 'marketing' : 'admin',
    activo: true,
    sesion_version: 0,
    estadoAcceso() {
      return { tieneAcceso: true, plan: 'premium', motivo: 'marketing', diasRestantes: null };
    }
  });

  Boleta.findById = (id) => ({
    lean: async () => ({
      _id: id,
      nombre: 'Parlay Estelar de Liga MX',
      selecciones: [
        {
          partido_api_id: 201,
          local: { id: 10, nombre: 'Monterrey' },
          visitante: { id: 20, nombre: 'Tigres' },
          mercado: { id: 'over_25', nombre: 'Más de 2.5 goles' },
          estimacion: 60
        },
        {
          partido_api_id: 202,
          local: { id: 30, nombre: 'Toluca' },
          visitante: { id: 40, nombre: 'Atlas' },
          mercado: { id: 'btts_yes', nombre: 'Ambos anotan' },
          estimacion: 65
        }
      ]
    })
  });

  let recCreada = null;
  Recomendacion.create = async (datos) => {
    recCreada = datos;
    return { _id: 'rec-123', ...datos };
  };

  t.after(() => {
    Usuario.findById = origFindById;
    Boleta.findById = origBoletaFindById;
    Recomendacion.create = origRecCreate;
    Partido.findOne = origPartidoFindOne;
  });

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/admin', routerAdmin);

  const servidor = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const { port } = servidor.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const tokenMarketing = firmarToken({ _id: 'marketing-id', rol: 'marketing', sesion_version: 0 });

  const res = await fetch(`${baseUrl}/api/admin/recomendaciones/desde-boleta/6aa1d66a7c39f8cb03203dcc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenMarketing}`
    },
    body: JSON.stringify({
      titulo: 'Parlay Especial Publicado',
      visibilidad: 'gratis',
      estado_publicacion: 'publicada',
      momio_total: '2.56',
      destacada: true,
      descripcion: 'Parlay armado por usuario y aprobado por equipo editorial.'
    })
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.mensaje, 'Recomendación creada a partir de la boleta.');
  assert.ok(recCreada);
  assert.equal(recCreada.tipo, 'parlay');
  assert.equal(recCreada.titulo, 'Parlay Especial Publicado');
  assert.equal(recCreada.visibilidad, 'gratis');
  assert.equal(recCreada.estado_publicacion, 'publicada');
  assert.equal(recCreada.destacada, true);
  assert.equal(recCreada.selecciones.length, 2);

  // Probar publicación de boleta especificando momios individuales personalizados
  const resConMomios = await fetch(`${baseUrl}/api/admin/recomendaciones/desde-boleta/6aa1d66a7c39f8cb03203dcc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenMarketing}`
    },
    body: JSON.stringify({
      titulo: 'Parlay Personalizado Con Momios',
      visibilidad: 'premium',
      estado_publicacion: 'publicada',
      momio_total: '+145',
      selecciones: [
        { momio: '1.30', casa: 'PlayDoIt' },
        { momio: '-200', casa: 'PlayDoIt' }
      ]
    })
  });
  assert.equal(resConMomios.status, 201);
  assert.equal(recCreada.selecciones[0].cuota, 1.3);
  assert.equal(recCreada.selecciones[0].casa, 'PlayDoIt');
  assert.equal(recCreada.selecciones[1].momio_americano, -200);
  assert.equal(recCreada.selecciones[1].cuota, 1.5);
  assert.equal(recCreada.momio_total_americano, 145);
  assert.equal(recCreada.cuota_total, 2.45);
});

test('PATCH /api/admin/recomendaciones/:id/momios permite a marketing y admin actualizar momios individuales y total', async t => {
  const origFindById = Usuario.findById;
  const Recomendacion = require('../models/Recomendacion');
  const origRecFindById = Recomendacion.findById;

  Usuario.findById = async (id) => ({
    _id: id,
    rol: id === 'marketing-id' ? 'marketing' : id === 'admin-id' ? 'admin' : 'usuario',
    activo: true,
    sesion_version: 0,
    estadoAcceso() {
      return { tieneAcceso: true, plan: 'premium', motivo: 'marketing', diasRestantes: null };
    }
  });

  const recMock = {
    _id: 'rec-abc',
    tipo: 'parlay',
    cuota_total: 2.45,
    momio_total_americano: 145,
    formato_momio_total: 'americano',
    momio_total_capturado: '+145',
    selecciones: [
      {
        partido_api_id: 101,
        mercado_id: 'over_25',
        cuota: 1.27,
        momio_americano: -370,
        formato_momio: 'decimal',
        momio_capturado: '1.27',
        casa: ''
      },
      {
        partido_api_id: 102,
        mercado_id: 'under_55',
        cuota: 1.22,
        momio_americano: -455,
        formato_momio: 'decimal',
        momio_capturado: '1.22',
        casa: ''
      }
    ],
    async save() { return this; }
  };

  Recomendacion.findById = async (id) => {
    if (id === '6aa1d66a7c39f8cb03203dcc') return recMock;
    return null;
  };

  t.after(() => {
    Usuario.findById = origFindById;
    Recomendacion.findById = origRecFindById;
  });

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/admin', routerAdmin);

  const servidor = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const { port } = servidor.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const tokenMarketing = firmarToken({ _id: 'marketing-id', rol: 'marketing', sesion_version: 0 });
  const tokenUsuario = firmarToken({ _id: 'usuario-id', rol: 'usuario', sesion_version: 0 });

  // 1. Usuario regular debe ser bloqueado
  const resBloqueado = await fetch(`${baseUrl}/api/admin/recomendaciones/6aa1d66a7c39f8cb03203dcc/momios`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenUsuario}` },
    body: JSON.stringify({ momio_total: '2.50' })
  });
  assert.equal(resBloqueado.status, 403);

  // 2. Marketing puede actualizar momios individuales y total
  const resEdicion = await fetch(`${baseUrl}/api/admin/recomendaciones/6aa1d66a7c39f8cb03203dcc/momios`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenMarketing}` },
    body: JSON.stringify({
      momio_total: '+180',
      selecciones: [
        { indice: 0, momio: '1.35', casa: 'PlayDoIt' },
        { indice: 1, momio: '-250', casa: 'PlayDoIt' }
      ]
    })
  });
  assert.equal(resEdicion.status, 200);
  const dataEdicion = await resEdicion.json();
  assert.equal(dataEdicion.mensaje, 'Momios actualizados correctamente.');
  assert.equal(recMock.selecciones[0].cuota, 1.35);
  assert.equal(recMock.selecciones[0].casa, 'PlayDoIt');
  assert.equal(recMock.selecciones[1].momio_americano, -250);
  assert.equal(recMock.selecciones[1].cuota, 1.4);
  assert.equal(recMock.momio_total_americano, 180);
  assert.equal(recMock.cuota_total, 2.8);

  // 3. Momio inválido debe responder 400
  const resInvalido = await fetch(`${baseUrl}/api/admin/recomendaciones/6aa1d66a7c39f8cb03203dcc/momios`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenMarketing}` },
    body: JSON.stringify({ momio_total: 'invalido' })
  });
  assert.equal(resInvalido.status, 400);
});

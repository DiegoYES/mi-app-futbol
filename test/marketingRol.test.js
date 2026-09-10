const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET ||= 'secreto-de-pruebas-con-longitud-suficiente-para-firmar-tokens';

const Usuario = require('../models/Usuario');
const { requireEditorial, requireAdmin, firmarToken } = require('../middleware/auth');
const express = require('express');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

test('el modelo Usuario acepta el rol marketing y otorga acceso activo permanente', () => {
  const usuarioMarketing = new Usuario({
    email: 'marketing@data-fut.com',
    password: 'password-seguro-123',
    nombre: 'Staff Marketing',
    rol: 'marketing',
    prueba_termina: new Date('2020-01-01')
  });

  const estado = usuarioMarketing.estadoAcceso();
  assert.equal(estado.tieneAcceso, true, 'Debe tener acceso activo');
  assert.equal(estado.plan, 'premium', 'Debe figurar como plan premium');
  assert.equal(estado.motivo, 'marketing', 'Motivo debe ser marketing');
  assert.equal(estado.diasRestantes, null, 'No debe expirar');

  const serializado = usuarioMarketing.aJSON();
  assert.equal(serializado.rol, 'marketing');
  assert.equal(serializado.tieneAcceso, true);
  assert.equal('password' in serializado, false, 'Nunca debe exponer la contraseña');
});

test('requireEditorial permite a admin y marketing, pero bloquea a usuario regular', () => {
  let nextLlamado = false;
  const next = () => { nextLlamado = true; };

  // 1. Marketing permitido
  nextLlamado = false;
  const reqMarketing = { usuario: { rol: 'marketing' } };
  const resMarketing = mockRes();
  requireEditorial(reqMarketing, resMarketing, next);
  assert.equal(nextLlamado, true, 'Marketing debe pasar requireEditorial');

  // 2. Admin permitido
  nextLlamado = false;
  const reqAdmin = { usuario: { rol: 'admin' } };
  const resAdmin = mockRes();
  requireEditorial(reqAdmin, resAdmin, next);
  assert.equal(nextLlamado, true, 'Admin debe pasar requireEditorial');

  // 3. Usuario regular bloqueado
  nextLlamado = false;
  const reqUsuario = { usuario: { rol: 'usuario' } };
  const resUsuario = mockRes();
  requireEditorial(reqUsuario, resUsuario, next);
  assert.equal(nextLlamado, false, 'Usuario regular no debe pasar requireEditorial');
  assert.equal(resUsuario.statusCode, 403);
  assert.equal(resUsuario.body?.codigo, 'NO_AUTORIZADO');
});

test('requireAdmin bloquea al rol marketing y solo permite a admin', () => {
  let nextLlamado = false;
  const next = () => { nextLlamado = true; };

  // 1. Marketing bloqueado
  nextLlamado = false;
  const reqMarketing = { usuario: { rol: 'marketing' } };
  const resMarketing = mockRes();
  requireAdmin(reqMarketing, resMarketing, next);
  assert.equal(nextLlamado, false, 'Marketing debe ser bloqueado por requireAdmin');
  assert.equal(resMarketing.statusCode, 403);
  assert.equal(resMarketing.body?.codigo, 'NO_ADMIN');

  // 2. Admin permitido
  nextLlamado = false;
  const reqAdmin = { usuario: { rol: 'admin' } };
  const resAdmin = mockRes();
  requireAdmin(reqAdmin, resAdmin, next);
  assert.equal(nextLlamado, true, 'Admin debe pasar requireAdmin');
});

test('rutas de admin: marketing puede acceder a recomendaciones pero se le bloquea usuarios', async t => {
  const origFindById = Usuario.findById;
  Usuario.findById = async (id) => {
    const rol = id === 'marketing-id' ? 'marketing' : (id === 'admin-id' ? 'admin' : 'usuario');
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
  t.after(() => { Usuario.findById = origFindById; });

  const routerAdmin = require('../routes/admin');
  const app = express();
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

  // 1. Marketing intentando acceder a /usuarios -> DEBE RETORNAR 403 NO_ADMIN
  const resUsuarios = await fetch(`${baseUrl}/api/admin/usuarios`, {
    headers: { Authorization: `Bearer ${tokenMarketing}` }
  });
  assert.equal(resUsuarios.status, 403);
  const dataUsuarios = await resUsuarios.json();
  assert.equal(dataUsuarios.codigo, 'NO_ADMIN');

  // 2. Marketing intentando acceder a /ips-duplicadas -> DEBE RETORNAR 403 NO_ADMIN
  const resIps = await fetch(`${baseUrl}/api/admin/ips-duplicadas`, {
    headers: { Authorization: `Bearer ${tokenMarketing}` }
  });
  assert.equal(resIps.status, 403);
  const dataIps = await resIps.json();
  assert.equal(dataIps.codigo, 'NO_ADMIN');

  // 3. Usuario regular intentando acceder a /recomendaciones -> DEBE RETORNAR 403 NO_AUTORIZADO
  const resRecsUsuario = await fetch(`${baseUrl}/api/admin/recomendaciones`, {
    headers: { Authorization: `Bearer ${tokenUsuario}` }
  });
  assert.equal(resRecsUsuario.status, 403);
  const dataRecs = await resRecsUsuario.json();
  assert.equal(dataRecs.codigo, 'NO_AUTORIZADO');
});

test('esStaff exime a marketing y admin del rate limiting pero evalúa usuarios normales', () => {
  const { esStaff } = require('../middleware/security');

  // 1. req.usuario con rol marketing o admin
  assert.equal(esStaff({ usuario: { rol: 'marketing' } }), true);
  assert.equal(esStaff({ usuario: { rol: 'admin' } }), true);
  assert.equal(esStaff({ usuario: { rol: 'usuario' } }), false);
  assert.equal(esStaff({ usuario: { _id: '6a7975b7a2bf1e560d2327fd', rol: 'usuario' } }), true);

  // 2. req anónimo sin token
  assert.equal(esStaff({}), false);
  assert.equal(esStaff({ headers: {} }), false);

  // 3. req con Bearer token firmado
  const tokenMarketing = firmarToken({ _id: 'mkt-123', rol: 'marketing', sesion_version: 0 });
  const tokenAdmin = firmarToken({ _id: 'adm-123', rol: 'admin', sesion_version: 0 });
  const tokenUser = firmarToken({ _id: 'usr-123', rol: 'usuario', sesion_version: 0 });

  assert.equal(esStaff({ headers: { authorization: `Bearer ${tokenMarketing}` } }), true);
  assert.equal(esStaff({ headers: { authorization: `Bearer ${tokenAdmin}` } }), true);
  assert.equal(esStaff({ headers: { authorization: `Bearer ${tokenUser}` } }), false);

  // 4. req con Cookie token
  assert.equal(esStaff({ cookies: { token: tokenMarketing } }), true);
  assert.equal(esStaff({ cookies: { token: tokenAdmin } }), true);
  assert.equal(esStaff({ cookies: { token: tokenUser } }), false);

  // 5. req con Cookie token del id de marketing conocido
  const tokenLegacyMarketing = firmarToken({ _id: '6a7975b7a2bf1e560d2327fd', rol: 'usuario', sesion_version: 0 });
  assert.equal(esStaff({ cookies: { token: tokenLegacyMarketing } }), true);
});

test('limiteUsuario no bloquea ráfagas de marketing pero sí a usuarios normales', async t => {
  const { limiteUsuario } = require('../middleware/security');
  const cookieParser = require('cookie-parser');
  const app = express();
  app.use(cookieParser());
  app.use('/test-rate', (req, res, next) => {
    // Simular requireAuth
    const token = req.cookies?.token;
    if (token) {
      try {
        const payload = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
        req.usuario = { _id: payload.id, rol: payload.rol };
      } catch {}
    }
    next();
  }, limiteUsuario, (_req, res) => res.json({ ok: true }));

  const servidor = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const { port } = servidor.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const tokenMarketing = firmarToken({ _id: 'marketing-load-test', rol: 'marketing', sesion_version: 0 });

  // Disparar múltiples peticiones con rol marketing: NINGUNA debe devolver 429
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${baseUrl}/test-rate`, {
      headers: { Cookie: `token=${tokenMarketing}` }
    });
    assert.equal(res.status, 200, `Petición ${i + 1} de marketing no debió ser bloqueada`);
  }
});

test('el usuario de marketing puede consultar y guardar picks de partidos terminados mientras usuario regular es rechazado', async t => {
  const Partido = require('../models/partido');
  const PickGuardado = require('../models/PickGuardado');
  const cookieParser = require('cookie-parser');
  const { requireAuth } = require('../middleware/auth');
  const picksRoutes = require('../routes/picks');
  const { liquidarPendientes } = require('../routes/picks');

  const origUsuarioFindById = Usuario.findById;
  const origPartidoFindOne = Partido.findOne;
  const origPartidoFind = Partido.find;
  const origPickFind = PickGuardado.find;
  const origPickCreate = PickGuardado.create;
  const origPickDelete = PickGuardado.findOneAndDelete;

  Usuario.findById = async (id) => {
    const rol = id === 'marketing-user' ? 'marketing' : 'usuario';
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

  const partidoFinalizado = {
    api_id: 9999,
    fecha: new Date('2026-09-08T18:00:00Z'),
    estado: 'FT',
    liga: { id: 10, nombre: 'Liga MX', temporada: 2026 },
    equipo_local: { id: 1, nombre: 'América', goles: 2 },
    equipo_visitante: { id: 2, nombre: 'Chivas', goles: 1 }
  };

  Partido.findOne = () => ({
    lean: async () => partidoFinalizado
  });

  const partidoHistorico = {
    api_id: 1001,
    fecha: new Date('2026-09-01T18:00:00Z'),
    estado: 'FT',
    liga: { id: 10, nombre: 'Liga MX', temporada: 2026 },
    equipo_local: { id: 1, nombre: 'América', goles: 2 },
    equipo_visitante: { id: 2, nombre: 'Chivas', goles: 1 },
    goles: { local: 2, visitante: 1 }
  };

  Partido.find = () => ({
    sort: () => ({
      limit: () => ({
        lean: async () => [partidoHistorico, partidoHistorico]
      }),
      lean: async () => [partidoHistorico, partidoHistorico]
    }),
    lean: async () => [partidoFinalizado]
  });

  let pickGuardadoMock = null;
  PickGuardado.find = (filtro = {}) => ({
    select: () => ({
      lean: async () => []
    }),
    sort: () => ({
      limit: () => ({
        lean: async () => (pickGuardadoMock ? [pickGuardadoMock] : [])
      })
    }),
    lean: async () => {
      if (pickGuardadoMock) {
        if (filtro.retrospectivo && filtro.retrospectivo.$ne === true && pickGuardadoMock.retrospectivo) {
          return [];
        }
        return [pickGuardadoMock];
      }
      return [];
    }
  });

  PickGuardado.create = async (datos) => {
    pickGuardadoMock = { _id: 'mock-pick-id', estado: 'pendiente', ...datos };
    return pickGuardadoMock;
  };

  PickGuardado.findOneAndDelete = async (filtro) => {
    if (pickGuardadoMock && (!filtro.estado || pickGuardadoMock.estado === filtro.estado)) {
      const res = pickGuardadoMock;
      pickGuardadoMock = null;
      return res;
    }
    return null;
  };

  t.after(() => {
    Usuario.findById = origUsuarioFindById;
    Partido.findOne = origPartidoFindOne;
    Partido.find = origPartidoFind;
    PickGuardado.find = origPickFind;
    PickGuardado.create = origPickCreate;
    PickGuardado.findOneAndDelete = origPickDelete;
  });

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/picks', requireAuth, picksRoutes);

  const servidor = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const { port } = servidor.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const tokenUser = firmarToken({ _id: 'regular-user', rol: 'usuario', sesion_version: 0 });
  const tokenMarketing = firmarToken({ _id: 'marketing-user', rol: 'marketing', sesion_version: 0 });

  // 1. GET /api/picks/partido/9999 con usuario regular -> guardable: false
  const resGetRegular = await fetch(`${baseUrl}/api/picks/partido/9999`, {
    headers: { Authorization: `Bearer ${tokenUser}` }
  });
  assert.equal(resGetRegular.status, 200);
  const dataGetRegular = await resGetRegular.json();
  assert.equal(dataGetRegular.guardable, false, 'Usuario regular no debe poder guardar picks en partido terminado');
  assert.match(dataGetRegular.motivo_no_guardable, /ya terminó/);

  // 2. GET /api/picks/partido/9999 con marketing -> guardable: true
  const resGetMarketing = await fetch(`${baseUrl}/api/picks/partido/9999`, {
    headers: { Authorization: `Bearer ${tokenMarketing}` }
  });
  assert.equal(resGetMarketing.status, 200);
  const dataGetMarketing = await resGetMarketing.json();
  assert.equal(dataGetMarketing.guardable, true, 'Marketing sí debe tener guardable: true en partido terminado');
  assert.equal(dataGetMarketing.motivo_no_guardable, null);

  // 3. POST /api/picks/seguimiento con usuario regular en partido terminado -> 409
  const resPostRegular = await fetch(`${baseUrl}/api/picks/seguimiento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenUser}` },
    body: JSON.stringify({ partido_id: 9999, mercado_id: 'over_25', periodo: 0 })
  });
  assert.equal(resPostRegular.status, 409, 'Usuario regular debe recibir 409 en partido terminado');

  // 4. POST /api/picks/seguimiento con marketing en partido terminado -> 201 y retrospectivo: true
  const resPostMarketing = await fetch(`${baseUrl}/api/picks/seguimiento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenMarketing}` },
    body: JSON.stringify({ partido_id: 9999, mercado_id: 'over_25', periodo: 0 })
  });
  assert.equal(resPostMarketing.status, 201, 'Marketing debe poder guardar el pick en partido terminado');
  const dataPostMarketing = await resPostMarketing.json();
  assert.ok(dataPostMarketing.pick);
  assert.equal(dataPostMarketing.pick.retrospectivo, true, 'Debe marcarse como pick retrospectivo');
  assert.equal(dataPostMarketing.pick.estado, 'pendiente', 'Debe crearse como pendiente para armar boletas');

  // 5. liquidarPendientes NO debe liquidar automáticamente picks retrospectivos para no quitarlos de "Por armar"
  let bulkWriteLlamado = false;
  PickGuardado.bulkWrite = async () => { bulkWriteLlamado = true; };
  await liquidarPendientes('marketing-user');
  assert.equal(bulkWriteLlamado, false, 'liquidarPendientes no debe tocar picks retrospectivos');

  // 6. DELETE /api/picks/seguimiento/:id permite a marketing eliminar el pick
  const resDelete = await fetch(`${baseUrl}/api/picks/seguimiento/mock-pick-id`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenMarketing}` }
  });
  assert.equal(resDelete.status, 200);
});



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


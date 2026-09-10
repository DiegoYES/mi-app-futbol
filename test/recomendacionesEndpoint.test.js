const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET ||= 'secreto-de-pruebas-con-longitud-suficiente-para-firmar-tokens';

const express = require('express');
const router = require('../routes/recomendaciones');
const Recomendacion = require('../models/Recomendacion');
const { firmarToken } = require('../middleware/auth');
const Usuario = require('../models/Usuario');

test('GET /api/recomendaciones separa activas de historial y calcula resumen', async t => {
  const ahora = new Date();
  const manana = new Date(ahora.getTime() + 24 * 3600 * 1000);
  const ayer = new Date(ahora.getTime() - 24 * 3600 * 1000);

  const mockDb = [
    {
      _id: 'rec-activa-1',
      tipo: 'pick',
      titulo: 'Pick Activo de Hoy',
      visibilidad: 'gratis',
      estado_publicacion: 'publicada',
      resultado: 'pendiente',
      cierra_en: manana,
      selecciones: []
    },
    {
      _id: 'rec-resuelta-1',
      tipo: 'combinada',
      titulo: 'Pick del Martes',
      visibilidad: 'premium',
      estado_publicacion: 'publicada',
      resultado: 'acertado',
      cierra_en: ayer,
      selecciones: []
    },
    {
      _id: 'rec-resuelta-2',
      tipo: 'parlay',
      titulo: 'Pick Pasado Fallado',
      visibilidad: 'premium',
      estado_publicacion: 'publicada',
      resultado: 'fallado',
      cierra_en: ayer,
      selecciones: []
    }
  ];

  const origFind = Recomendacion.find;
  Recomendacion.find = () => ({
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    async lean() {
      return JSON.parse(JSON.stringify(mockDb));
    }
  });
  t.after(() => { Recomendacion.find = origFind; });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.usuario = {
      _id: 'usuario-test',
      rol: 'usuario',
      estadoAcceso() {
        return { tieneAcceso: true, plan: 'premium', motivo: 'suscripcion_activa', diasRestantes: 20 };
      }
    };
    next();
  });
  app.use('/api/recomendaciones', router);

  const servidor = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const { port } = servidor.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const res = await fetch(`${baseUrl}/api/recomendaciones`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.activas.length, 1, 'Debe haber exactamente 1 recomendación activa');
  assert.equal(data.activas[0].titulo, 'Pick Activo de Hoy');

  assert.equal(data.historial.length, 2, 'Debe haber 2 recomendaciones en el historial');
  assert.ok(data.historial.some(h => h.titulo === 'Pick del Martes'));
  assert.ok(data.historial.some(h => h.titulo === 'Pick Pasado Fallado'));

  assert.equal(data.resumen.total_historial, 2);
  assert.equal(data.resumen.acertadas, 1);
  assert.equal(data.resumen.falladas, 1);
  assert.equal(data.resumen.efectividad, 50);
});

test('GET /api/recomendaciones incluye recomendación destacada acertada vigente en activas y en historial', async t => {
  const ahora = new Date();
  const manana = new Date(ahora.getTime() + 24 * 3600 * 1000);

  const mockDb = [
    {
      _id: 'rec-destacada-resuelta',
      tipo: 'parlay',
      titulo: 'Parlay Triple MLS Ganador',
      visibilidad: 'gratis',
      estado_publicacion: 'publicada',
      destacada: true,
      resultado: 'acertado',
      cierra_en: manana,
      selecciones: []
    }
  ];

  const origFind = Recomendacion.find;
  Recomendacion.find = () => ({
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    async lean() {
      return JSON.parse(JSON.stringify(mockDb));
    }
  });
  t.after(() => { Recomendacion.find = origFind; });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.usuario = {
      _id: 'usuario-test',
      rol: 'usuario',
      estadoAcceso() {
        return { tieneAcceso: true, plan: 'gratis' };
      }
    };
    next();
  });
  app.use('/api/recomendaciones', router);

  const servidor = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const { port } = servidor.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const res = await fetch(`${baseUrl}/api/recomendaciones`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.activas.length, 1, 'La recomendación destacada acertada debe aparecer en activas');
  assert.equal(data.activas[0].titulo, 'Parlay Triple MLS Ganador');
  assert.equal(data.activas[0].resultado, 'acertado');

  assert.equal(data.historial.length, 1, 'La recomendación resuelta también debe constar en historial');
  assert.equal(data.historial[0].titulo, 'Parlay Triple MLS Ganador');
  assert.equal(data.resumen.acertadas, 1);
  assert.equal(data.resumen.efectividad, 100);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { fechaISOEnZona, horaEnZona, zonaHorariaValida } = require('../services/timeZone');

test('convierte el mismo kickoff a la zona local del visitante', () => {
  const kickoff = new Date('2026-08-03T01:30:00.000Z');
  assert.equal(fechaISOEnZona(kickoff, 'America/Mexico_City'), '2026-08-02');
  assert.equal(fechaISOEnZona(kickoff, 'Europe/Madrid'), '2026-08-03');
  assert.equal(horaEnZona(kickoff, 'America/Mexico_City'), '19:30');
  assert.equal(horaEnZona(kickoff, 'Europe/Madrid'), '03:30');
});

test('usa México Centro cuando el navegador no manda una zona válida', () => {
  assert.equal(zonaHorariaValida('zona/inventada'), 'America/Mexico_City');
  assert.equal(zonaHorariaValida(''), 'America/Mexico_City');
});

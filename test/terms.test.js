const test = require('node:test');
const assert = require('node:assert/strict');
const { TERMS_VERSION, consentimientoValido } = require('../services/terms');

test('el checkout exige aceptación expresa de la versión vigente', () => {
  assert.equal(consentimientoValido(), false);
  assert.equal(consentimientoValido({ acepta_terminos: true }), false);
  assert.equal(consentimientoValido({ acepta_terminos: false, version_terminos: TERMS_VERSION }), false);
  assert.equal(consentimientoValido({ acepta_terminos: true, version_terminos: 'anterior' }), false);
  assert.equal(consentimientoValido({ acepta_terminos: true, version_terminos: TERMS_VERSION }), true);
});

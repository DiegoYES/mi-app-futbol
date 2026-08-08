const TERMS_VERSION = '2026-08-08';

function consentimientoValido(body = {}) {
  return body.acepta_terminos === true && body.version_terminos === TERMS_VERSION;
}

module.exports = { TERMS_VERSION, consentimientoValido };

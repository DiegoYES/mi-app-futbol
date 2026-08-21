const FORMATOS_MOMIO = new Set(['ambos', 'decimal', 'americano']);
const PASSWORDS_COMUNES = new Set([
  '123456789012345', 'password1234567', 'contraseña123456',
  'qwerty123456789', 'administrador123', 'datafut123456789'
]);

function contarCaracteres(valor) {
  return [...valor].length;
}

function comparableAlfanumerico(valor) {
  return String(valor)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es-MX')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function normalizarNombreCuenta(valor, { opcional = false } = {}) {
  if (typeof valor !== 'string') return { error: 'El nombre debe ser texto.' };
  const nombre = valor.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!nombre && opcional) return { valor: '' };
  const longitud = contarCaracteres(nombre);
  if (longitud < 2 || longitud > 80) {
    return { error: 'El nombre debe tener entre 2 y 80 caracteres.' };
  }
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\p{N} .'’\-]*$/u.test(nombre)) {
    return { error: 'El nombre contiene caracteres no permitidos.' };
  }
  return { valor: nombre };
}

function normalizarPreferenciasCuenta(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return { error: 'Las preferencias no son válidas.' };
  }
  if (Object.keys(valor).some(clave => clave !== 'formato_momio')) {
    return { error: 'La preferencia enviada no está permitida.' };
  }
  if (!FORMATOS_MOMIO.has(valor.formato_momio)) {
    return { error: 'Selecciona un formato de momio válido.' };
  }
  return { valor: { formato_momio: valor.formato_momio } };
}

function normalizarPerfilCuenta(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { error: 'Los datos del perfil no son válidos.' };
  }
  if (Object.keys(entrada).some(clave => !['nombre', 'preferencias'].includes(clave))) {
    return { error: 'El perfil contiene campos no permitidos.' };
  }
  const nombre = normalizarNombreCuenta(entrada.nombre);
  if (nombre.error) return nombre;
  const preferencias = normalizarPreferenciasCuenta(entrada.preferencias);
  if (preferencias.error) return preferencias;
  return { valor: { nombre: nombre.valor, preferencias: preferencias.valor } };
}

function validarPasswordNueva(valor, { email = '', nombre = '' } = {}) {
  if (typeof valor !== 'string') return { error: 'La nueva contraseña debe ser texto.' };
  const caracteres = contarCaracteres(valor);
  const bytes = Buffer.byteLength(valor, 'utf8');
  if (caracteres < 15) return { error: 'Usa al menos 15 caracteres en la nueva contraseña.' };
  if (bytes > 72) return { error: 'La nueva contraseña supera el máximo seguro de 72 bytes.' };
  if (/\p{Cc}/u.test(valor)) return { error: 'La nueva contraseña contiene caracteres de control.' };
  const comparable = valor.normalize('NFKC').toLocaleLowerCase('es-MX');
  if (PASSWORDS_COMUNES.has(comparable)) return { error: 'Elige una contraseña menos común.' };
  const correoLocal = comparableAlfanumerico(String(email).split('@')[0]);
  const nombreComparable = comparableAlfanumerico(nombre);
  const passwordComparable = comparableAlfanumerico(comparable);
  if ((correoLocal.length >= 4 && passwordComparable.includes(correoLocal))
      || (nombreComparable.length >= 4 && passwordComparable.includes(nombreComparable))) {
    return { error: 'La contraseña no debe contener tu nombre ni tu correo.' };
  }
  return { valor };
}

module.exports = {
  FORMATOS_MOMIO,
  normalizarNombreCuenta,
  normalizarPerfilCuenta,
  normalizarPreferenciasCuenta,
  validarPasswordNueva
};

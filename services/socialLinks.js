const ICONOS_SOCIALES = ['instagram', 'x', 'facebook', 'tiktok', 'youtube', 'linkedin', 'whatsapp', 'telegram', 'discord', 'twitch', 'web', 'link'];
const ICONOS = new Set(ICONOS_SOCIALES);

function urlSocial(valor) {
  const texto = String(valor || '').trim();
  try {
    const url = new URL(texto);
    return ['https:', 'http:'].includes(url.protocol) && url.hostname ? url.toString() : null;
  } catch { return null; }
}

function normalizarEnlaceSocial(entrada = {}) {
  const nombre = String(entrada.nombre || '').trim().slice(0, 50);
  const url = urlSocial(entrada.url);
  const icono = String(entrada.icono || '').trim().toLowerCase();
  const orden = Number.parseInt(entrada.orden, 10);
  if (!nombre) return { error: 'Escribe el nombre de la red o enlace.' };
  if (!url) return { error: 'Escribe una URL http o https válida.' };
  if (!ICONOS.has(icono)) return { error: 'Selecciona un icono válido.' };
  return { datos: { nombre, url, icono, activo: entrada.activo !== false, orden: Number.isInteger(orden) ? Math.min(Math.max(orden, 0), 999) : 0 } };
}

module.exports = { ICONOS_SOCIALES, normalizarEnlaceSocial };

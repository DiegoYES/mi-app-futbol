require('dotenv').config({ quiet: true });
const axios = require('axios');
const { obtenerApiKeys } = require('../services/apiQuota');

async function main() {
  const claves = obtenerApiKeys();
  if (!claves.length) throw new Error('No hay API keys configuradas.');
  const estados = [];
  for (let indice = 0; indice < claves.length; indice += 1) {
    try {
      const respuesta = await axios.get('https://v3.football.api-sports.io/status', {
        headers: { 'x-apisports-key': claves[indice] },
        timeout: 15000,
        validateStatus: () => true
      });
      estados.push({
        clave: `key${indice + 1}`,
        http: respuesta.status,
        plan: respuesta.data?.response?.subscription?.plan || null,
        solicitudes: respuesta.data?.response?.requests || null,
        disponible: !respuesta.data?.errors || Object.keys(respuesta.data.errors).length === 0,
        errores: respuesta.data?.errors || null,
        agotada: Boolean(respuesta.data?.errors?.requests),
        mensaje: respuesta.data?.errors?.requests || null,
        headers: {
          limite_diario: Number(respuesta.headers['x-ratelimit-requests-limit']) || null,
          restantes_diarias: Number(respuesta.headers['x-ratelimit-requests-remaining']) || null
        }
      });
    } catch (error) {
      estados.push({ clave: `key${indice + 1}`, error: error.code || error.message });
    }
  }
  console.log(JSON.stringify({
    aviso: 'Diagnóstico independiente; no suma cuotas ni cambia automáticamente la key activa.',
    estados
  }, null, 2));
}

main().catch(error => {
  console.error(`❌ No se pudieron revisar las keys: ${error.message}`);
  process.exitCode = 1;
});

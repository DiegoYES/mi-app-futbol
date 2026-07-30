require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const PlaydoitProvider = require('../providers/PlaydoitProvider');

async function main() {
  const visible = process.argv.includes('--headed') || process.argv.includes('--visible');
  const directorio = path.join(__dirname, '..', 'var', 'playdoit');
  const archivo = path.join(directorio, `captura-${new Date().toISOString().replaceAll(':', '-')}.json`);
  await fs.mkdir(directorio, { recursive: true });
  const proveedor = new PlaydoitProvider({
    headless: !visible,
    espera: visible ? Number(process.env.PLAYDOIT_INSPECTION_MS || 90000) : undefined,
    onCapture: async resultado => fs.writeFile(archivo, JSON.stringify({
      aviso: 'Captura pública sanitizada. Puede contener datos deportivos; no contiene cookies, cabeceras ni tokens.',
      urlFinal: resultado.urlFinal,
      responses: resultado.respuestas
    }, null, 2))
  });
  if (visible) console.log('Navegador visible: inicia sesión tú mismo si hace falta y abre los partidos/mercados durante la ventana de inspección. La aplicación no lee ni guarda tu contraseña.');
  const resultado = await proveedor.refreshMarkets();
  const capturaCreada = await fs.access(archivo).then(() => true).catch(() => false);
  console.log(JSON.stringify({ estrategia: resultado.estrategia, selecciones: resultado.selecciones.length, problemas: resultado.problemas, captura: capturaCreada ? archivo : null }, null, 2));
  if (!resultado.selecciones.length) process.exitCode = 2;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

#!/usr/bin/env node
// Extrae un campo de un proceso PM2 a partir de la salida de `pm2 jlist`.
// Uso: pm2 jlist | node deploy/pm2-info.js <nombre_proceso> <campo>
// Campos: status | script | cwd | pid
// Códigos de salida: 0 ok, 2 uso/JSON inválido, 3 el proceso no existe.
const [, , nombre, campo] = process.argv;
const CAMPOS = ['status', 'script', 'cwd', 'pid'];
if (!nombre || !CAMPOS.includes(campo)) {
  console.error(`Uso: pm2 jlist | node pm2-info.js <nombre> <${CAMPOS.join('|')}>`);
  process.exit(2);
}
let crudo = '';
process.stdin.on('data', (c) => { crudo += c; });
process.stdin.on('end', () => {
  let lista;
  try {
    lista = JSON.parse(crudo);
  } catch {
    console.error('pm2 jlist no devolvió JSON válido.');
    process.exit(2);
  }
  const proceso = Array.isArray(lista) ? lista.find((p) => p && p.name === nombre) : null;
  if (!proceso) process.exit(3);
  const env = proceso.pm2_env || {};
  const valores = {
    status: env.status || '',
    script: env.pm_exec_path || '',
    cwd: env.pm_cwd || env.cwd || '',
    pid: String(proceso.pid || '')
  };
  console.log(valores[campo]);
});

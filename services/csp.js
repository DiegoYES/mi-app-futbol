const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
function recorrer(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?recorrer(path.join(dir,e.name)):[path.join(dir,e.name)]);}
function crearHashesEstilosInline(publicDir){
  const valores=new Set();
  for(const archivo of recorrer(publicDir).filter(a=>/\.(?:html|js)$/.test(a))){const fuente=fs.readFileSync(archivo,'utf8');for(const m of fuente.matchAll(/style="([^"]+)"/g)){if(!m[1].includes('${'))valores.add(m[1]);}}
  return [...valores].map(valor=>`'sha256-${crypto.createHash('sha256').update(valor).digest('base64')}'`);
}
module.exports={crearHashesEstilosInline};

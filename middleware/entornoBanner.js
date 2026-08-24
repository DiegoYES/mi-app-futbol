const fs = require('fs');
const path = require('path');
const BANNER_ID = 'banner-entorno-prueba';
const BANNER_HTML = `<div id="${BANNER_ID}" class="environment-banner">⚠️ ENTORNO DE PRUEBA — staging — los datos pueden ser sintéticos y borrarse en cualquier momento</div>`;
const BANNER_CSS = '.environment-banner{position:sticky;top:0;z-index:9999;background:#b45309;color:#fff;text-align:center;font:600 13px/1.4 system-ui,sans-serif;padding:6px 12px;letter-spacing:.04em}';
function esStaging(env=process.env){return String(env.APP_ENVIRONMENT||'').trim().toLowerCase()==='staging';}
function inyectarBanner(html){if(typeof html!=='string'||html.includes(`id="${BANNER_ID}"`))return html;const abre=html.search(/<body[^>]*>/i);if(abre===-1)return html;const fin=html.indexOf('>',abre)+1;return `${html.slice(0,fin)}\n${BANNER_HTML}${html.slice(fin)}`;}
function inyectarNonce(html,nonce){
  if(typeof html!=='string'||!nonce)return html;
  let salida=html.replace(/<script(?![^>]*\bsrc=)(?![^>]*\bnonce=)([^>]*)>/gi,`<script nonce="${nonce}"$1>`).replace(/<style(?![^>]*\bnonce=)([^>]*)>/gi,`<style nonce="${nonce}"$1>`);
  const meta=`<meta name="csp-nonce" content="${nonce}">`;
  if(!salida.includes('name="csp-nonce"'))salida=salida.replace(/<head([^>]*)>/i,`<head$1>\n${meta}`);
  return salida;
}
function transformarHtml(html,{staging=false,nonce=''}={}){let salida=staging?inyectarBanner(html):html;if(staging&&!salida.includes(BANNER_CSS))salida=salida.replace(/<\/head>/i,`<style>${BANNER_CSS}</style>\n</head>`);return inyectarNonce(salida,nonce);}
function crearEnviadorHtml(publicDir,env=process.env){const staging=esStaging(env);return function enviarHtml(res,archivo){const nonce=res.locals?.cspNonce||'';const ruta=path.join(publicDir,archivo);if(!staging&&!nonce)return res.sendFile(ruta);fs.readFile(ruta,'utf8',(err,html)=>{if(err)return res.status(404).end();res.type('html').send(transformarHtml(html,{staging,nonce}));});};}
function bannerEstatico(publicDir,env=process.env){const staging=esStaging(env);return(req,res,next)=>{if(!['GET','HEAD'].includes(req.method))return next();let rutaPedida;try{rutaPedida=decodeURIComponent(req.path);}catch{return next();}if(!rutaPedida.toLowerCase().endsWith('.html'))return next();const archivo=path.normalize(path.join(publicDir,rutaPedida));if(!archivo.startsWith(publicDir+path.sep))return next();const nonce=res.locals?.cspNonce||'';if(!staging&&!nonce)return next();fs.readFile(archivo,'utf8',(err,html)=>{if(err)return next();res.type('html').send(transformarHtml(html,{staging,nonce}));});};}
module.exports={BANNER_ID,BANNER_HTML,esStaging,inyectarBanner,inyectarNonce,transformarHtml,crearEnviadorHtml,bannerEstatico};

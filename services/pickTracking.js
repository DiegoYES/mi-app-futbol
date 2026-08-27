const { MERCADOS, obtenerMercado } = require('./marketCatalog');
const { estadisticasPeriodo } = require('./teamStats');

const MERCADOS_EVALUABLES = new Set(MERCADOS.map(mercado => mercado.id));
function separarPeriodo(mercadoId) { const m=String(mercadoId).match(/^(.*)__(1|2)t$/); return m?{mercadoId:m[1],periodo:Number(m[2])}:{mercadoId,periodo:0}; }
function idMercadoPeriodo(mercadoId, periodo=0) { return periodo===1||periodo===2?`${mercadoId}__${periodo}t`:mercadoId; }
function evaluarMercado(mercadoId, partidoOGolesLocal, golesVisitante) {
  const separado=separarPeriodo(mercadoId); const mercado=obtenerMercado(separado.mercadoId); if(!mercado)return null;
  if(typeof partidoOGolesLocal==='object'&&partidoOGolesLocal!==null){const p=partidoOGolesLocal;if(separado.periodo>0&&p.tiempos_completos!==true)return null;if(separado.periodo===0&&mercado.requiereAvanzadas&&p.estadisticas_completas!==true)return null;if(![p.equipo_local?.goles,p.equipo_visitante?.goles].every(Number.isFinite))return null;return mercado.cumple(estadisticasPeriodo(p.equipo_local,separado.periodo),estadisticasPeriodo(p.equipo_visitante,separado.periodo));}
  if(![partidoOGolesLocal,golesVisitante].every(Number.isFinite)||mercado.requiereAvanzadas)return null;return mercado.cumple({goles:partidoOGolesLocal},{goles:golesVisitante});
}
function resumirRendimiento(picks) {
  const acertados=picks.filter(p=>p.estado==='acertado').length,fallados=picks.filter(p=>p.estado==='fallado').length,pendientes=picks.filter(p=>p.estado==='pendiente').length,resueltos=acertados+fallados;
  const evaluados=picks.filter(p=>['acertado','fallado'].includes(p.estado)&&Number.isFinite(p.estimacion));
  const brier=evaluados.length?evaluados.reduce((s,p)=>s+((p.estimacion/100-(p.estado==='acertado'?1:0))**2),0)/evaluados.length:null;
  return{total:picks.length,pendientes,resueltos,acertados,fallados,efectividad:resueltos?Number((acertados/resueltos*100).toFixed(1)):null,brier:brier===null?null:Number(brier.toFixed(3))};
}
function agrupar(picks, clave, etiqueta=valor=>String(valor)) {
  const mapa=new Map(); for(const pick of picks){const valor=clave(pick);if(valor==null||valor==='')continue;const id=String(valor);if(!mapa.has(id))mapa.set(id,[]);mapa.get(id).push(pick);}
  return[...mapa.entries()].map(([id,items])=>({id,etiqueta:etiqueta(id,items[0]),...resumirRendimiento(items)})).sort((a,b)=>b.resueltos-a.resueltos||b.total-a.total).slice(0,40);
}
function rangoMuestra(valor){const n=Number(valor)||0;return n<5?'0-4':n<10?'5-9':n<20?'10-19':'20+';}
function bandaCalibracion(valor){const n=Math.max(0,Math.min(100,Number(valor)||0));const inicio=n<50?0:Math.min(90,Math.floor(n/10)*10);return inicio===0?'0-49':`${inicio}-${inicio===90?100:inicio+9}`;}
function resumirRendimientoSegmentado(picks){
  const resueltos=picks.filter(p=>['acertado','fallado'].includes(p.estado));
  const segmentos={
    mercado:agrupar(picks,p=>p.mercado?.base_id||separarPeriodo(p.mercado?.id).mercadoId,(id,item)=>item.mercado?.nombre?.replace(/ · (Partido completo|[12]T)$/,'')||id),
    liga:agrupar(picks,p=>p.liga?.id,(_id,item)=>item.liga?.nombre||`Liga ${_id}`),
    alcance:agrupar(picks,p=>p.mercado?.alcance||'total',id=>({local:'Local',visitante:'Visitante',total:'Total'}[id]||id)),
    periodo:agrupar(picks,p=>Number(p.mercado?.periodo??separarPeriodo(p.mercado?.id).periodo),id=>({'0':'Partido completo','1':'Primer tiempo','2':'Segundo tiempo'}[id]||id)),
    confianza:agrupar(picks,p=>p.confianza,id=>`Confianza ${id}`),
    muestra:agrupar(picks,p=>rangoMuestra(p.muestra),id=>`Muestra ${id}`),
    mes:agrupar(picks,p=>p.fecha_partido?new Date(p.fecha_partido).toISOString().slice(0,7):null),
    temporada:agrupar(picks,p=>p.liga?.temporada,id=>`Temporada ${id}`)
  };
  const calibracion=agrupar(resueltos,p=>bandaCalibracion(p.estimacion),id=>`${id}%`).map(item=>{const [a,b]=item.id.split('-').map(Number);const grupo=resueltos.filter(p=>bandaCalibracion(p.estimacion)===item.id);return{...item,estimacion_media:Number((grupo.reduce((s,p)=>s+p.estimacion,0)/grupo.length).toFixed(1)),desviacion:item.efectividad===null?null:Number((item.efectividad-(a+b)/2).toFixed(1))};});
  return{resumen:resumirRendimiento(picks),segmentos,calibracion};
}
module.exports={MERCADOS_EVALUABLES,evaluarMercado,idMercadoPeriodo,resumirRendimiento,resumirRendimientoSegmentado,separarPeriodo,rangoMuestra,bandaCalibracion};

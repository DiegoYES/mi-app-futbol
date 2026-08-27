const estado={webhook_pago_fallos:0,ultimo_webhook_pago_fallido:null};
function registrarFalloWebhookPago(){estado.webhook_pago_fallos+=1;estado.ultimo_webhook_pago_fallido=new Date().toISOString();}
function obtenerEstadoOperativo(){return{...estado};}
module.exports={obtenerEstadoOperativo,registrarFalloWebhookPago};

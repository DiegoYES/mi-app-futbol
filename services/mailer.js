const { APP_ORIGIN, EMAIL_FROM, EMAIL_REPLY_TO, RESEND_API_KEY } = process.env;

function escaparHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function obtenerUrlBase() {
  const origin = (process.env.APP_ORIGIN || 'https://data-fut.com').split(',')[0].trim();
  return origin.replace(/\/+$/, '');
}

function generarHtmlVerificacion({ nombre, urlVerificacion }) {
  const nombreSeguro = escaparHtml(nombre || 'futbolero');
  const urlSegura = escaparHtml(urlVerificacion);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verifica tu correo - Data-Fut</title>
</head>
<body style="margin: 0; padding: 0; background-color: #07100d; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e5f4ee;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #07100d; width: 100% !important; margin: 0; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px; background-color: #0d1a15; border: 1px solid rgba(84, 227, 142, 0.2); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          
          <!-- Encabezado / Logo -->
          <tr>
            <td style="padding: 32px 32px 20px 32px; text-align: center; border-bottom: 1px solid rgba(84, 227, 142, 0.1);">
              <div style="font-size: 26px; font-weight: 900; letter-spacing: 2px; color: #54e38e;">
                DATA<span style="color: #68d9e7;">-FUT</span>
              </div>
              <div style="font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: #8fa89d; margin-top: 4px; font-weight: 700;">
                Estadísticas & Análisis de Fútbol
              </div>
            </td>
          </tr>

          <!-- Contenido Principal -->
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #ffffff;">
                ¡Hola, ${nombreSeguro}! 👋
              </h1>
              <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #c4d8ce;">
                Gracias por registrarte en Data-Fut. Para completar la configuración de tu cuenta y mantenerla protegida, confirma tu dirección de correo electrónico pulsando el botón de abajo:
              </p>

              <!-- Botón CTA -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 28px 0;">
                <tr>
                  <td align="center">
                    <a href="${urlSegura}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 15px 36px; background-color: #54e38e; color: #07100d; font-size: 15px; font-weight: 800; text-decoration: none; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 4px 14px rgba(84, 227, 142, 0.4);">
                      Verificar mi correo
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 8px 0; font-size: 13px; line-height: 1.5; color: #8fa89d;">
                Si el botón no funciona en tu cliente de correo, copia y pega el siguiente enlace en tu navegador:
              </p>
              <div style="padding: 12px; background-color: #07100d; border: 1px solid rgba(84, 227, 142, 0.15); border-radius: 8px; word-break: break-all; font-size: 12px; color: #68d9e7; font-family: monospace;">
                ${urlSegura}
              </div>

              <!-- Caducidad & Seguridad -->
              <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(84, 227, 142, 0.1); font-size: 12px; color: #6f877c; line-height: 1.5;">
                <p style="margin: 0 0 8px 0;">
                  ⏳ Este enlace de verificación tiene una vigencia de <strong>24 horas</strong>.
                </p>
                <p style="margin: 0;">
                  Si tú no creaste esta cuenta en Data-Fut, puedes ignorar este correo con total tranquilidad.
                </p>
              </div>
            </td>
          </tr>

          <!-- Pie de página -->
          <tr>
            <td style="padding: 20px 32px; background-color: #07100d; text-align: center; border-top: 1px solid rgba(84, 227, 142, 0.08); font-size: 11px; color: #5f746b;">
              Data-Fut · <a href="mailto:contacto@data-fut.com" style="color: #54e38e; text-decoration: none;">contacto@data-fut.com</a>
              <br>
              Plataforma de estadísticas, valor esperado y comparador de fútbol.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function generarTextoVerificacion({ nombre, urlVerificacion }) {
  const nombreLimpio = (nombre || 'futbolero').trim();
  return `¡Hola, ${nombreLimpio}!

Gracias por registrarte en Data-Fut.

Por favor confirma tu dirección de correo electrónico abriendo el siguiente enlace en tu navegador:

${urlVerificacion}

Este enlace estará activo durante las próximas 24 horas.

Si tú no creaste esta cuenta en Data-Fut, puedes ignorar este correo de forma segura.

Atentamente,
El equipo de Data-Fut
contacto@data-fut.com
`;
}

async function enviarEmailVerificacion({ email, nombre, token }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[mailer] RESEND_API_KEY no configurada. Se omite el envío de correo de verificación.');
    return { ok: false, motivo: 'resend_no_configurado' };
  }

  if (!email || !token) {
    return { ok: false, motivo: 'datos_incompletos' };
  }

  const baseUrl = obtenerUrlBase();
  const urlVerificacion = `${baseUrl}/verificar-email.html?token=${encodeURIComponent(token)}`;
  const fromEmail = process.env.EMAIL_FROM || 'Data-Fut <verificacion@send.data-fut.com>';
  const replyToEmail = process.env.EMAIL_REPLY_TO || 'contacto@data-fut.com';

  const html = generarHtmlVerificacion({ nombre, urlVerificacion });
  const text = generarTextoVerificacion({ nombre, urlVerificacion });

  try {
    const respuesta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        reply_to: replyToEmail,
        subject: 'Confirma tu correo en Data-Fut ⚽',
        html,
        text
      })
    });

    const data = await respuesta.json().catch(() => null);

    if (!respuesta.ok) {
      console.error('[mailer] Error de Resend API al enviar verificación:', respuesta.status, data);
      return {
        ok: false,
        status: respuesta.status,
        error: data?.message || 'Error al comunicarse con Resend'
      };
    }

    return { ok: true, id: data?.id };
  } catch (error) {
    console.error('[mailer] Error de red o inesperado enviando correo:', error);
    return { ok: false, error: error.message };
  }
}

module.exports = {
  enviarEmailVerificacion,
  generarHtmlVerificacion,
  generarTextoVerificacion,
  obtenerUrlBase
};

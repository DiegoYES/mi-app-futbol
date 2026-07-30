# Seguridad y despliegue a producción

La aplicación web **no consulta API-Football desde el navegador**. Los clientes
leen MongoDB y únicamente los workers de sincronización llaman al proveedor. La
clave nunca debe aparecer en `public/`, HTML, JavaScript del navegador, URLs,
logs, capturas ni respuestas HTTP.

## Crítico antes de publicar

1. Crea `/etc/mi-app-futbol/app.env` fuera del repositorio, propiedad del usuario
   del servicio y con permisos `600`. Genera el secreto JWT con:

   ```bash
   openssl rand -base64 48
   ```

2. Configura `NODE_ENV=production`, `APP_ORIGIN=https://tu-dominio`,
   `TRUST_PROXY=1`, `MONGODB_URI`, `JWT_SECRET` y `API_FOOTBALL_KEY`. No copies
   `.env` a una imagen, commit, respaldo público o pipeline log.
3. Rota cualquier clave que alguna vez haya estado en Git, frontend, chat o log.
   Si el panel del proveedor permite restringir el proyecto por IP, usa la IP de
   salida estática de la VM. Conserva `API_FOOTBALL_ALLOW_KEY_FAILOVER=false`:
   varias keys no deben emplearse para evadir la cuota.
4. Ejecuta `npm ci --omit=dev`, `npm run db:indexes`, `npm run check` y
   `npm test`. Revisa `npm audit --omit=dev` en CI antes del despliegue y bloquea
   releases con vulnerabilidades altas sin evaluar.
5. MongoDB no debe escuchar públicamente. Habilita autenticación, firewall,
   copias cifradas y una prueba periódica de restauración.

## Controles que ya aplica la aplicación

- Reserva diaria atómica en MongoDB y sincronización con los encabezados reales.
- Salida serializada a 4 solicitudes/segundo, equivalente a 240/minuto por
  worker, por debajo de los topes Pro de 5/s y 300/min.
- Reintentos limitados para 429, timeouts y 5xx; respeta `Retry-After`, usa
  backoff con jitter y abre un circuito temporal después de fallos consecutivos.
- Distingue `X-RateLimit-*` por minuto de `x-ratelimit-requests-*` diarios y
  reconoce `errors.rateLimit`; un 429 temporal no quema el contador del día.
- Lease distribuido en MongoDB para impedir dos ejecuciones del mismo batch de
  cron, incluso con más de una VM.
- Límite HTTP por IP y por usuario, límite de body, validación de origen en
  escrituras, Helmet, cookies `HttpOnly`/`Secure`/`SameSite=Lax` e IP obtenida
  sólo mediante la configuración explícita de proxy.
- CSP en modo compatible bloquea scripts remotos, objetos, iframes y conexiones
  externas. Como la interfaz conserva JavaScript inline, el siguiente refuerzo
  será moverlo a archivos o nonces para retirar `'unsafe-inline'`.
- Caché local acotado con coalescencia: solicitudes idénticas simultáneas
  comparten una consulta en lugar de golpear MongoDB varias veces.
- `/health/live` comprueba el proceso y `/health/ready` comprueba MongoDB. El
  diagnóstico detallado está restringido al administrador en
  `/api/admin/produccion/estado` y nunca devuelve claves.

## VM recomendada

1. Crea un usuario sin shell administrativo, por ejemplo `miappfutbol`, y copia
   el proyecto en `/opt/mi-app-futbol`. El proceso no debe ejecutarse como root.
2. Usa el servicio de ejemplo `deploy/mi-app-futbol.service`. Ajusta rutas y
   concede escritura únicamente a `var/` si Playdoit guarda capturas locales.
3. Coloca Nginx o Caddy delante de Express. El ejemplo
   `deploy/nginx-mi-app-futbol.conf` incluye TLS, proxy, límite perimetral y
   timeouts. Sustituye dominio y certificados; después conserva `TRUST_PROXY=1`.
4. Expón sólo 80/443. Restringe SSH por IP/llave, deshabilita contraseña y root,
   activa actualizaciones automáticas de seguridad y sincronización NTP.
5. Programa `scripts/cronSync.sh batch1|batch2|batch3` desde systemd timers o
   cron. El propio script adquiere el lease distribuido. No ejecutes workers de
   sincronización dentro de cada réplica web.

## Alertas mínimas

- Sondea `/health/ready` cada minuto y alerta tras tres fallos.
- Consulta como administrador `/api/admin/produccion/estado`: alerta con cuota
  diaria menor al margen operativo, `limitadas > 0`, circuito abierto, MongoDB
  no disponible o memoria creciendo de forma sostenida.
- Activa los avisos de consumo del dashboard API-Sports (50%, 75%, 90% y 100%).
- Centraliza logs y alerta por aumentos de 401, 403, 429 y 5xx. Conserva IDs de
  solicitud, pero nunca cookies, JWT, contraseñas, API keys ni cuerpos de login.
- Haz copia diaria de MongoDB con retención y cifrado; prueba restauración antes
  del lanzamiento.

## Escalado

Una VM con un proceso web y un worker es el punto de partida más sencillo. El
caché y los rate limits HTTP actuales son locales por proceso. Antes de añadir
múltiples réplicas, mueve ambos stores a Redis, conserva el lease MongoDB para
workers, usa una sola cola de sincronización y configura balanceador con checks
de `/health/ready`. El control diario ya es compartido, pero el ritmo de 4/s es
por proceso: no levantes varios workers hasta disponer de un limitador distribuido.

Si API-Football falla, la web continúa sirviendo el último dato persistido en
MongoDB. Muestra su fecha de actualización en la interfaz y evita borrar datos
vigentes por una respuesta vacía o transitoria del proveedor.

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
   `TRUST_PROXY=1`, `MONGODB_URI`, `JWT_SECRET`, `API_FOOTBALL_KEY`,
   `REDIS_SOCKET=/run/redis/redis-server.sock` y
   `REDIS_KEY_PREFIX=datafut:production`. No copies
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
- `/admin.html` **no** se sirve como archivo estático: pasa por un control de
  rol que responde `404` (no `403`) a cualquiera que no tenga sesión de
  administrador, de modo que la ruta ni siquiera se anuncia. El control
  normaliza la ruta, así que `//admin.html`, `/./admin.html` o `/%61dmin.html`
  tampoco la esquivan. La API `/api/admin/*` mantiene su propio
  `requireAuth + requireAdmin`.
- Las búsquedas por texto que llegan a MongoDB escapan los metacaracteres antes
  de construir un `$regex`, acotan la longitud y toleran parámetros repetidos,
  de modo que un campo de búsqueda no puede inyectar una expresión regular ni
  provocar retroceso catastrófico (ReDoS).
- Los errores 500 devuelven un mensaje genérico más el `requestId`; el detalle
  del fallo sólo queda en el log del servidor.
- Al arrancar, la aplicación advierte si `NODE_ENV`, `TRUST_PROXY` o
  `APP_ORIGIN` faltan. Sin `NODE_ENV=production` la cookie de sesión viaja sin
  `Secure` y sin HSTS; sin `TRUST_PROXY` detrás de Nginx o Cloudflare todas las
  peticiones comparten IP y el límite de intentos de login deja de aislar a un
  atacante.
- CSP en modo compatible bloquea scripts remotos, objetos, iframes y conexiones
  externas. Como la interfaz conserva JavaScript inline, el siguiente refuerzo
  será moverlo a archivos o nonces para retirar `'unsafe-inline'`.
- Caché Redis compartido con fallback local y coalescencia dentro de cada
  proceso: solicitudes idénticas simultáneas comparten una consulta en lugar
  de golpear MongoDB varias veces. Los rate limits usan el mismo backend con
  prefijos independientes por política.
- `/health/live` comprueba el proceso y `/health/ready` comprueba MongoDB y,
  cuando está habilitado, Redis. El
  diagnóstico detallado está restringido al administrador en
  `/api/admin/produccion/estado` y nunca devuelve claves.

## VM recomendada

> Estado actual: producción corre bajo systemd como `mi-app-futbol.service`,
> con usuario restringido y releases inmutables en `/opt/mi-app-futbol`.
> Nginx balancea `mi-app-futbol`/3000 y
> `mi-app-futbol-secondary`/3001 mediante `least_conn`. Staging permanece en
> dos procesos PM2 balanceados.

1. Crea un usuario sin shell administrativo, por ejemplo `miappfutbol`, y copia
   el proyecto en `/opt/mi-app-futbol`. El proceso no debe ejecutarse como root.
2. Usa el servicio de ejemplo `deploy/mi-app-futbol.service`. Ajusta rutas y
   concede escritura únicamente a `var/` si Playdoit guarda capturas locales.
3. Coloca Nginx o Caddy delante de Express. El ejemplo
   `deploy/nginx-mi-app-futbol.conf` incluye TLS, proxy, límite perimetral y
   timeouts. Sustituye dominio y certificados; después conserva `TRUST_PROXY=1`.
4. Expón sólo 80/443. Restringe SSH por IP/llave, deshabilita contraseña y root,
   activa actualizaciones automáticas de seguridad y sincronización NTP.
5. Programa `scripts/cronSync.sh hourly` una vez por hora (por ejemplo, al minuto
   7) desde systemd timers o cron. El propio script adquiere el lease distribuido.
   No ejecutes workers de
   sincronización dentro de cada réplica web.

## Pool systemd activo

Desde el 2026-08-14 producción ejecuta una segunda instancia web como
`mi-app-futbol-secondary.service` en el puerto 3001 y balancea 3000/3001 con
`least_conn`. No crea workers adicionales, no modifica MongoDB y ambas
instancias comparten el release, JWT y Redis de producción.

Mientras no exista `/etc/mi-app-futbol/deploy.env`, los scripts de promoción y
rollback administran únicamente `mi-app-futbol.service`, igual que antes. Al
activar el pool, ese archivo configura ambas unidades y sus puertos; los
reinicios son secuenciales y cada instancia debe pasar `/health/ready`.
Entre instancias espera 11 segundos para superar el `fail_timeout=10s` de
Nginx antes de tocar la siguiente.

Comprobaciones del pool:

```bash
sudo test/ops/deploy-systemd.sh
sudo test/ops/enable-production-pool.sh
sudo systemd-analyze verify deploy/mi-app-futbol-secondary.service
sudo nginx -t -p "$PWD/" -c test/ops/nginx-production-pool.conf
```

En una instalación nueva, la activación exige escribir literalmente
`ACTIVAR_POOL`:

```bash
sudo deploy/enable-production-pool.sh
```

No vuelvas a ejecutar ese activador en esta VM: abortará porque los archivos ya
existen. El respaldo de la configuración previa es
`/root/data-fut-pool-backup.VzetCE`.

El activador valida primero la primaria y la unidad, crea un respaldo privado,
arranca y comprueba la secundaria directamente, valida `nginx -t`, recarga
Nginx y finalmente comprueba el readiness público. Si cualquier paso falla,
detiene y deshabilita la secundaria, elimina sólo los archivos recién
instalados, restaura el snippet previo y vuelve a validar la primaria.

Después de promociones o mantenimiento deben aprobar:

```bash
curl -fsS http://127.0.0.1:3000/health/ready
curl -fsS http://127.0.0.1:3001/health/ready
curl -fsS https://data-fut.com/health/ready
sudo systemctl status mi-app-futbol mi-app-futbol-secondary --no-pager
sudo nginx -t
```

## Latencia observada en Nginx

El access log de esta VM usa el formato `data_fut_timing`. Conserva el formato
combinado y añade `rt` (tiempo total), `urt` (tiempo del upstream Node),
`uaddr` (instancia 3000/3001) y `ustatus` (estado del upstream). No deben
añadirse cookies, JWT, claves, cuerpos ni encabezados de autorización al log.
El respaldo anterior al cambio es
`/root/nginx-backup-20260814-timing/nginx.conf`; la rotación continúa diaria,
con 14 archivos.

Para resumir las rutas más lentas sin conservar query strings ni IDs dinámicos:

```bash
sudo node scripts/resumirLatenciaNginx.js /var/log/nginx/access.log --top 25
```

La salida ordena por p95 y también muestra promedio, p99, máximo, errores 5xx,
tiempo promedio de Node e instancias utilizadas. Espera una muestra suficiente
antes de optimizar: health checks o unas cuantas solicitudes sintéticas no
representan tráfico de usuarios.

## Flujo de despliegue con staging

Ningún commit debería llegar a producción sin pasar por el entorno de prueba
`staging.data-fut.com` (servicio, puerto, base de datos y secretos separados;
sin cron ni API-Football). El flujo commit → staging → smoke test → promoción,
junto con el rollback, está documentado en [`STAGING.md`](STAGING.md). La
promoción (`deploy/promote-production.sh`) sólo acepta el commit registrado
como validado por el smoke test y exige confirmación explícita.

## Alertas mínimas

- Instala `deploy/data-fut-monitor` como `/usr/local/sbin/data-fut-monitor`
  y ejecútalo cada cinco minutos. Comprueba ambas unidades Node, puertos
  3000/3001, readiness público, Nginx, MongoDB, Redis, SSH, Fail2ban, memoria,
  swap y disco; no reinicia servicios.
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
caché y los rate limits HTTP pueden compartir Redis mediante `REDIS_SOCKET` o
`REDIS_URL`; valida primero namespaces distintos, readiness y comportamiento
fail-closed antes de añadir réplicas. Conserva el lease MongoDB para workers,
usa una sola cola de sincronización y configura el balanceador con checks de
`/health/ready`. El control diario ya es compartido, pero el ritmo de 4/s es
por proceso: no levantes varios workers hasta disponer de un limitador
distribuido para las llamadas salientes.

Si API-Football falla, la web continúa sirviendo el último dato persistido en
MongoDB. Muestra su fecha de actualización en la interfaz y evita borrar datos
vigentes por una respuesta vacía o transitoria del proveedor.

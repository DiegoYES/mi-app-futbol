# Entorno de staging (staging.data-fut.com)

Staging es un entorno de prueba completamente separado de producción. Sirve
para validar cada commit **antes** de promoverlo a https://data-fut.com.

## Infraestructura real (fase 1: PM2)

Producción corre hoy bajo **PM2** como proceso `futbol-app` (usuario root,
cwd `/var/www/mi-app-futbol`, puerto 3000, Nginx → 127.0.0.1:3000). La fase 1
añade staging con el mismo gestor para no introducir dos modelos a la vez; la
migración a systemd con usuario restringido es la [fase 2](#fase-2-migración-a-systemd-con-usuario-restringido).

## Garantías de aislamiento

Staging **no comparte nada** con producción:

| Recurso        | Producción                     | Staging                                  |
| -------------- | ------------------------------ | ---------------------------------------- |
| Dominio        | data-fut.com                   | staging.data-fut.com                     |
| Proceso PM2    | futbol-app                     | futbol-staging                           |
| Directorio     | /var/www/mi-app-futbol         | /var/www/mi-app-futbol-staging           |
| Puerto interno | 3000                           | 3100                                     |
| Configuración  | .env de producción             | /var/www/mi-app-futbol-staging/.env      |
| Base MongoDB   | mi-app-futbol                  | mi-app-futbol-staging                    |
| JWT_SECRET     | propio                         | propio (distinto, generado aparte)       |
| API-Football   | clave real                     | **sin clave** (vacía)                    |
| Cron/workers   | scripts/cronSync.sh            | **ninguno**                              |
| Cuentas        | usuarios reales                | sólo cuentas sintéticas de prueba        |

Reglas permanentes:

- La base de producción es intocable desde staging. Ningún script de este
  repositorio escribe en MongoDB durante despliegues, smoke tests, promociones
  ni rollbacks.
- Staging no ejecuta cron, workers, sincronizaciones, Playdoit ni
  actualizaciones de mercados (`MARKET_REFRESH_ENABLED=false`, clave API vacía).
- No copies datos ni credenciales de producción a staging sin autorización
  explícita. Si staging necesita datos, usa las semillas sintéticas.

## Arquitectura

```
Internet ──► Nginx (TLS)
              ├── data-fut.com          ──► 127.0.0.1:3000 (PM2: futbol-app)
              └── staging.data-fut.com  ──► 127.0.0.1:3100 (PM2: futbol-staging)
MongoDB local:
              ├── base mi-app-futbol          (producción, intocable)
              └── base mi-app-futbol-staging  (staging, sintética)
```

La aplicación detecta `APP_ENVIRONMENT=staging` y muestra un banner fijo
"ENTORNO DE PRUEBA" en todas las páginas HTML. En producción esa variable no
se define y el banner no existe (hay pruebas que cubren ambas condiciones en
`test/entornoBanner.test.js`).

## Instalación (acciones manuales, requieren autorización)

### 1. DNS

Crea un registro para el subdominio apuntando a la misma VM:

```
staging.data-fut.com.  A  <IP pública de la VM>
```

### 2. Certificado TLS

```bash
sudo certbot certonly --nginx -d staging.data-fut.com
```

### 3. Configuración de staging

El clon de `/var/www/mi-app-futbol-staging` lo crea `deploy-staging.sh` en el
primer despliegue; sólo necesitas preparar su `.env`:

```bash
sudo mkdir -p /var/www/mi-app-futbol-staging
sudo cp .env.staging.example /var/www/mi-app-futbol-staging/.env
sudo chmod 600 /var/www/mi-app-futbol-staging/.env
# Edita el archivo: genera un JWT_SECRET nuevo con `openssl rand -base64 48`.
# NUNCA copies el JWT_SECRET ni la API key de producción.
```

`deploy-staging.sh` valida antes de arrancar que ese `.env` tenga
`PORT=3100`, `APP_ENVIRONMENT=staging` y un `MONGODB_URI` terminado en
`-staging`; si algo no cuadra, aborta.

### 4. Nginx

```bash
sudo cp deploy/nginx-staging-data-fut.conf /etc/nginx/sites-available/staging-data-fut
sudo ln -s /etc/nginx/sites-available/staging-data-fut /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

La plantilla incluye (comentadas) dos protecciones adicionales recomendadas:
`auth_basic` con `htpasswd`, o restricción por IP con `allow`/`deny`. Activa al
menos una para que el entorno de prueba no sea público. Si activas
`auth_basic`, pasa las credenciales HTTP a los smoke tests mediante
`STAGING_BASIC_AUTH_USER` y `STAGING_BASIC_AUTH_PASSWORD` (variables de
entorno; nunca hardcodeadas).

### 5. Base de datos separada (creación manual y segura)

MongoDB crea la base al primer insert; no hace falta tocar producción. Para
verificar el destino **antes** de cualquier operación, aplica siempre esta
plantilla de verificación:

```
Entorno lógico : staging
Host           : 127.0.0.1:27017 (sin credenciales en pantalla)
Base           : mi-app-futbol-staging
Operación      : lectura / escritura (indícalo)
```

Si MongoDB tiene autenticación, crea un usuario **exclusivo** de staging con
permisos sólo sobre `mi-app-futbol-staging` (nunca reutilices el usuario de
producción):

```javascript
// mongosh — conecta como administrador y ejecuta SOLO esto:
use mi-app-futbol-staging
db.createUser({
  user: 'miappfutbol_stg',
  pwd: passwordPrompt(),
  roles: [{ role: 'readWrite', db: 'mi-app-futbol-staging' }]
})
```

Los índices se crean contra staging apuntando `MONGODB_URI` a la base
`-staging` y ejecutando `npm run db:indexes` **desde el clon de staging**.
Jamás ejecutes ese comando con la URI de producción.

### 6. Semillas sintéticas

`scripts/cargarSemillasStaging.js` crea una cuenta de prueba, dos equipos y un
partido sintéticos (con `api_id` negativos, imposibles de confundir con datos
reales). El proxy de escudos responde HTTP 400 a los IDs negativos; el smoke
test de Playwright tolera exactamente esos 400 (además de los 404 de imágenes
ausentes), así que las semillas no lo hacen fallar. El script **se niega a
ejecutarse** si el nombre de la base no termina en `-staging`, exige
`APP_ENVIRONMENT=staging` más la confirmación explícita
`STAGING_SEED_CONFIRM=SEMILLAS`, nunca borra nada y no consume API-Football.
No se ejecuta automáticamente; lánzalo a mano cuando lo decidas:

```bash
MONGODB_URI='mongodb://127.0.0.1:27017/mi-app-futbol-staging' \
APP_ENVIRONMENT=staging \
STAGING_SEED_CONFIRM=SEMILLAS \
STAGING_SEED_EMAIL='smoke@staging.local' \
STAGING_SEED_PASSWORD='<contraseña nueva de al menos 12 caracteres>' \
npm run seed:staging
```

Usa siempre credenciales inventadas para staging, nunca las de una cuenta real.

## Flujo commit → staging → smoke test → producción

Todos los scripts usan `set -euo pipefail`, validan rutas y variables, no
contienen secretos, no usan `rm -rf` y **jamás tocan MongoDB directamente**.
El despliegue siempre recibe un commit explícito; nunca "lo último" implícito.
Cada script valida por PM2 (`pm2 jlist` + `deploy/pm2-info.js`) el nombre,
script, cwd y estado del proceso antes de reiniciarlo, y detecta el commit
desplegado con git en ese cwd: nunca reinicia un proceso equivocado.

```bash
# 1. Despliega un commit concreto en staging: clona/actualiza
#    /var/www/mi-app-futbol-staging, hace checkout EXACTO del sha, npm ci,
#    y crea o reinicia el proceso PM2 futbol-staging (nunca futbol-app).
deploy/deploy-staging.sh <sha>

# 2. Ejecuta el smoke test. Verifica vía PM2 que futbol-staging está online
#    con el cwd y script esperados y que el HEAD del clon coincide con el
#    commit a validar; sólo entonces lo registra como VALIDADO.
STAGING_SMOKE_EMAIL='smoke@staging.local' \
STAGING_SMOKE_PASSWORD='...' \
RUN_PLAYWRIGHT=1 \
deploy/smoke-staging.sh

# 3. Promueve a producción. Valida el proceso PM2 futbol-app (nombre, script,
#    cwd, online), sólo acepta el commit registrado como validado, exige
#    teclear PROMOVER, se niega si el árbol tiene cambios locales y, si el
#    proceso no queda saludable, revierte automáticamente al commit anterior.
deploy/promote-production.sh <sha>
```

El smoke test comprueba: `/health/live`, `/health/ready`, cabeceras
CSP/HSTS/X-Content-Type-Options, banner de entorno, login con cuenta de
staging, portada autenticada, calendario, comparador, picks y boletas, y con
`RUN_PLAYWRIGHT=1` añade navegación real en escritorio y móvil, un centro de
partido abierto con identificadores reales del calendario, errores JavaScript,
respuestas 4xx/5xx inesperadas y la búsqueda "Argentina" del calendario sin
resultados duplicados. Las credenciales llegan sólo por variables de entorno.
`SMOKE_REMOTE=1` omite únicamente la verificación local de PM2/clon cuando el
smoke corre desde otra máquina.

> **Nota sobre escrituras.** El smoke test no toca MongoDB directamente, pero
> a nivel de aplicación no es 100% de sólo lectura: el login actualiza
> `ultimo_acceso`/IP de la cuenta de staging y `GET /api/picks/seguimiento`
> puede liquidar picks pendientes de esa cuenta. Ambas escrituras ocurren
> exclusivamente en la base `-staging`.

## Rollback

`promote-production.sh` registra cada activación **saludable** en
`/var/www/mi-app-futbol/RELEASE_HISTORY` (una línea por activación, campos
exactos `fecha commit etiqueta`, con etiqueta `baseline`, `promote`,
`rollback` o `auto-rollback`). Un commit que falló su health check nunca se
registra, así el rollback sin argumento jamás lo seleccionará. Para volver
atrás:

```bash
deploy/rollback-production.sh          # vuelve a la última activación saludable distinta de la actual
deploy/rollback-production.sh <sha>    # o a una concreta del historial
```

El rollback valida el proceso PM2, sólo acepta commits registrados como
activaciones saludables, exige teclear `ROLLBACK`, hace checkout + `npm ci`,
reinicia y verifica `/health/ready`. Tanto la promoción como el rollback son
**transaccionales**: si fallan el checkout, `npm ci`, `pm2 restart` o el
health check, restauran automáticamente el commit anterior, sus dependencias
y `DEPLOYED_COMMIT`, y verifican que PM2 quede saludable. No tocan MongoDB:
si un despliegue incluyó cambios de esquema, evalúa su compatibilidad hacia
atrás antes de promover (los cambios de datos requieren su propio plan
autorizado).

## Fase 2: migración a systemd con usuario restringido

**No ejecutar en la fase actual.** Producción corre como root bajo PM2; el
objetivo de la fase 2 es un servicio systemd endurecido (usuario sin
privilegios, `ProtectSystem=strict`, releases inmutables en
`/opt/mi-app-futbol/releases/<sha>` con symlink `current`).

Requisitos previos (todos con autorización explícita):

1. Ventana de mantenimiento acordada: la conmutación reinicia producción.
2. Usuario `miappfutbol` creado sin shell administrativo.
3. `/etc/mi-app-futbol/app.env` creado (permisos 600) con las variables reales.
4. Revisión de las plantillas `deploy/mi-app-futbol.service` y
   `deploy/mi-app-futbol-staging.service`.

Procedimiento: `deploy/migrate-production-systemd.sh` (exige teclear `MIGRAR`):

1. Verifica por PM2 que `futbol-app` está online con el script y cwd esperados
   y detecta el commit exacto que ejecuta; aborta ante cualquier divergencia.
2. Instala ese mismo commit como release inicial y crea `current`.
3. Instala el unit (no debe existir uno previo) y hace `daemon-reload`.
4. Conmutación: `pm2 stop futbol-app` (**sin** `delete`: la definición se
   conserva) y `systemctl start mi-app-futbol` + health check.
5. **Restauración automática si falla**: detiene y elimina el unit instalado,
   restaura symlink y `DEPLOYED_COMMIT` (o su ausencia) y rearranca el proceso
   PM2 original, verificando `/health/ready`.
6. Sólo tras un periodo de observación estable se ejecuta manualmente
   `pm2 delete futbol-app && pm2 save`, se adapta Nginx si procede y se
   actualizan los scripts de promoción/rollback al modelo systemd.

Hasta completar la fase 2, los scripts de este repositorio operan
exclusivamente sobre PM2.

## Qué NO hace ningún script de este flujo

- No ejecuta `npm run db:indexes` ni migraciones.
- No ejecuta `sync:*`, cron, workers ni Playdoit.
- No lee ni escribe la base de producción.
- No copia `.env` ni secretos.
- No borra releases, datos ni configuración.
- No reinicia procesos sin validar antes su nombre, script y cwd vía PM2.

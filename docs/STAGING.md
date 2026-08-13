# Entorno de staging (staging.data-fut.com)

Staging es un entorno de prueba completamente separado de producción. Sirve
para validar cada commit **antes** de promoverlo a https://data-fut.com.

## Infraestructura real

Producción corre bajo **systemd** como `mi-app-futbol.service`, con el usuario
restringido `miappfutbol`, releases inmutables bajo
`/opt/mi-app-futbol/releases/<sha>` y el symlink `/opt/mi-app-futbol/current`.
Staging continúa bajo PM2 como `futbol-staging`. La definición antigua
`futbol-app` permanece detenida temporalmente como contingencia de migración;
no se usa para promociones ni rollbacks normales.

## Garantías de aislamiento

Staging **no comparte nada** con producción:

| Recurso        | Producción                     | Staging                                  |
| -------------- | ------------------------------ | ---------------------------------------- |
| Dominio        | data-fut.com                   | staging.data-fut.com                     |
| Servicio       | systemd: mi-app-futbol         | PM2: futbol-staging                      |
| Directorio     | /opt/mi-app-futbol/current     | /var/www/mi-app-futbol-staging           |
| Puerto interno | 3000                           | 3100                                     |
| Configuración  | .env de producción             | /var/www/mi-app-futbol-staging/.env      |
| Base MongoDB   | mi-app-futbol                  | mi-app-futbol-staging                    |
| JWT_SECRET     | propio                         | propio (distinto, generado aparte)       |
| Redis          | namespace `datafut:production` | namespace `datafut:staging`              |
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
- El daemon y socket Redis pueden ser comunes a la VM, pero las claves lógicas
  no: `REDIS_KEY_PREFIX` debe ser distinto y explícito en cada entorno.

## Arquitectura

```
Internet ──► Nginx (TLS)
              ├── data-fut.com          ──► 127.0.0.1:3000 (systemd: mi-app-futbol)
              └── staging.data-fut.com  ──► 127.0.0.1:3100 (PM2: futbol-staging)
MongoDB local:
              ├── base mi-app-futbol          (producción, intocable)
              └── base mi-app-futbol-staging  (staging, sintética)
Redis local por socket Unix:
              ├── namespace datafut:production
              └── namespace datafut:staging
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

En la VM de referencia Redis no abre TCP. Staging usa
`REDIS_SOCKET=/run/redis/redis-server.sock` y
`REDIS_KEY_PREFIX=datafut:staging`; producción usa el mismo socket con el
prefijo `datafut:production`. `/health/ready` añade `redis: ok` cuando el
backend está habilitado y responde 503 si deja de estar disponible.

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
contienen secretos y **jamás tocan MongoDB directamente**. El despliegue
siempre recibe un commit explícito; nunca "lo último" implícito. Staging valida
su proceso PM2. Promoción y rollback validan la unidad systemd, usuario,
`WorkingDirectory`, `ExecStart`, release activo y marcadores antes de reiniciar.
Además usan `flock` para impedir operaciones concurrentes.

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

# 3. Comprueba sin cambios que el commit validado puede promoverse.
sudo deploy/promote-production.sh <sha> --check

# 4. Promueve a un release inmutable y conmuta current de forma atómica.
#    Exige teclear PROMOVER y restaura el release anterior si falla salud.
sudo deploy/promote-production.sh <sha>
```

La promoción exige que `VALIDATED_COMMIT` coincida exactamente con el SHA
pedido. Construye primero el release en un directorio temporal, instala sólo
dependencias de producción y lo mueve a su nombre definitivo cuando está
completo. `DEPLOYED_COMMIT` se escribe atómicamente y `RELEASE_HISTORY` sólo
registra activaciones que respondieron `/health/ready`.

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
`/opt/mi-app-futbol/RELEASE_HISTORY`, con formato `fecha acción -> sha`. Un
commit que falló salud nunca se registra. Para volver atrás:

```bash
sudo deploy/rollback-production.sh --check       # valida el destino automático
sudo deploy/rollback-production.sh               # última activación saludable distinta
sudo deploy/rollback-production.sh <sha> --check # valida una concreta
sudo deploy/rollback-production.sh <sha>         # conmuta a una concreta
```

El rollback sólo acepta releases completos ya existentes y registrados como
activaciones saludables, exige teclear `ROLLBACK`, conmuta el symlink de forma
atómica, reinicia systemd y verifica `/health/ready`. Tanto promoción como
rollback son **transaccionales**: ante un fallo restauran `current` y
`DEPLOYED_COMMIT`, reinician el release anterior y vuelven a comprobar salud.
No tocan MongoDB:
si un despliegue incluyó cambios de esquema, evalúa su compatibilidad hacia
atrás antes de promover (los cambios de datos requieren su propio plan
autorizado).

## Snapshot sanitizado de datos reales

Para probar variedad y volumen reales sin conectar staging a producción, usa
`npm run snapshot:staging`. El script lee producción mediante una lista blanca
fija y escribe únicamente en una base **nueva** cuyo nombre contenga `snapshot`
y termine en `-staging`. Se niega a continuar si el destino ya tiene cualquier
colección: nunca sobrescribe ni borra datos.

Colecciones copiadas: `equipos`, `partidos`, `jugadorpartidos`,
`mercadocasas` y `actualizacionmercados`. Quedan fuera `usuarios`, `boletas`,
`pickguardados`, `sugerencias`, `usoapidiarios` y `bloqueotrabajos`; por tanto,
el snapshot no contiene cuentas, hashes, correos, IP, actividad personal ni
estado operativo. Las cuentas de prueba se añaden después mediante semillas
sintéticas.

```bash
TARGET_MONGODB_URI='mongodb://127.0.0.1:27017/mi-app-futbol-snapshot-staging' \
SNAPSHOT_CONFIRM=COPIAR \
npm run snapshot:staging
```

La URI de origen se toma de `MONGODB_URI` y nunca se imprime. Si la copia se
interrumpe, el destino parcial se conserva para diagnóstico y el script se
negará a reutilizarlo. Eliminar una copia parcial requiere una autorización
separada.

## Migración a systemd completada

La migración se completó el 2026-08-13. Producción corre con el usuario sin
privilegios `miappfutbol`, `ProtectSystem=strict` y releases inmutables en
`/opt/mi-app-futbol/releases/<sha>` mediante el symlink `current`.
La primera capa adicional de hardening elimina capabilities, limita familias
de sockets a Unix/IPv4/IPv6 y protege dispositivos, namespaces, reloj,
hostname, módulos, tunables, logs y cgroups. La exposición informada por
`systemd-analyze security` bajó de 8.3 a 3.0 sin perder salud.

El script `deploy/migrate-production-systemd.sh` se conserva como registro del
procedimiento inicial y **no debe volver a ejecutarse**: aborta si la unidad ya
existe. Estado de contingencia:

1. `mi-app-futbol.service` está activo y habilitado.
2. `futbol-app` permanece detenido, no eliminado, como rollback temporal.
3. `futbol-staging` continúa activo bajo PM2.
4. No eliminar `futbol-app` hasta observar al menos una promoción y un rollback
   controlados con los scripts systemd.

## Qué NO hace ningún script de este flujo

- No ejecuta `npm run db:indexes` ni migraciones.
- No ejecuta `sync:*`, cron, workers ni Playdoit.
- Los scripts de deploy/smoke/promoción no leen ni escriben producción. La
  única excepción es `snapshot:staging`, que la lee por lista blanca y jamás
  escribe en ella.
- No copia `.env` ni secretos.
- No borra releases, datos ni configuración.
- No reinicia procesos sin validar antes su gestor, identidad y directorio.

# Entorno de staging (staging.data-fut.com)

Staging es un entorno de prueba completamente separado de producción. Sirve
para validar cada commit **antes** de promoverlo a https://data-fut.com.

## Garantías de aislamiento

Staging **no comparte nada** con producción:

| Recurso        | Producción                     | Staging                                  |
| -------------- | ------------------------------ | ---------------------------------------- |
| Dominio        | data-fut.com                   | staging.data-fut.com                     |
| Directorio     | /opt/mi-app-futbol             | /opt/mi-app-futbol-staging               |
| Servicio       | mi-app-futbol                  | mi-app-futbol-staging                    |
| Usuario SO     | miappfutbol                    | miappfutbol-stg                          |
| Puerto interno | 3000                           | 3100                                     |
| EnvironmentFile| /etc/mi-app-futbol/app.env     | /etc/mi-app-futbol-staging/app.env       |
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
              ├── data-fut.com          ──► 127.0.0.1:3000 (mi-app-futbol)
              └── staging.data-fut.com  ──► 127.0.0.1:3100 (mi-app-futbol-staging)
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

### 3. Usuario y directorios

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin miappfutbol-stg
sudo mkdir -p /opt/mi-app-futbol-staging/releases
sudo chown -R miappfutbol-stg:miappfutbol-stg /opt/mi-app-futbol-staging
```

### 4. Variables de entorno

```bash
sudo mkdir -p /etc/mi-app-futbol-staging
sudo cp .env.staging.example /etc/mi-app-futbol-staging/app.env
sudo chown miappfutbol-stg:miappfutbol-stg /etc/mi-app-futbol-staging/app.env
sudo chmod 600 /etc/mi-app-futbol-staging/app.env
# Edita el archivo: genera un JWT_SECRET nuevo con `openssl rand -base64 48`.
# NUNCA copies el JWT_SECRET ni la API key de producción.
```

### 5. Servicio systemd

```bash
sudo cp deploy/mi-app-futbol-staging.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable mi-app-futbol-staging
```

### 6. Nginx

```bash
sudo cp deploy/nginx-staging-data-fut.conf /etc/nginx/sites-available/staging-data-fut
sudo ln -s /etc/nginx/sites-available/staging-data-fut /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

La plantilla incluye (comentadas) dos protecciones adicionales recomendadas:
`auth_basic` con `htpasswd`, o restricción por IP con `allow`/`deny`. Activa al
menos una para que el entorno de prueba no sea público.

### 7. Base de datos separada (creación manual y segura)

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
`-staging` y ejecutando `npm run db:indexes` **desde el entorno de staging**.
Jamás ejecutes ese comando con la URI de producción.

### 8. Semillas sintéticas

`scripts/cargarSemillasStaging.js` crea una cuenta de prueba, dos equipos y un
partido sintéticos (con `api_id` negativos, imposibles de confundir con datos
reales). El script **se niega a ejecutarse** si el nombre de la base no termina
en `-staging`, nunca borra nada y no consume API-Football. No se ejecuta
automáticamente; lánzalo a mano cuando lo decidas:

```bash
MONGODB_URI='mongodb://127.0.0.1:27017/mi-app-futbol-staging' \
STAGING_SEED_EMAIL='smoke@staging.local' \
STAGING_SEED_PASSWORD='<contraseña nueva de al menos 12 caracteres>' \
npm run seed:staging
```

Usa siempre credenciales inventadas para staging, nunca las de una cuenta real.

## Flujo commit → staging → smoke test → producción

Todos los scripts usan `set -euo pipefail`, validan rutas y variables, no
contienen secretos, no usan `rm -rf` y **jamás tocan MongoDB**. El despliegue
siempre recibe un commit explícito; nunca "lo último" implícito.

```bash
# 1. Despliega un commit concreto en staging (releases/<sha> + symlink current).
deploy/deploy-staging.sh <sha>

# 2. Ejecuta el smoke test. Si todo pasa, registra <sha> como VALIDADO.
STAGING_SMOKE_EMAIL='smoke@staging.local' \
STAGING_SMOKE_PASSWORD='...' \
RUN_PLAYWRIGHT=1 \
deploy/smoke-staging.sh

# 3. Promueve a producción. Sólo acepta el commit registrado como validado y
#    exige teclear PROMOVER.
deploy/promote-production.sh <sha>
```

El smoke test comprueba: `/health/live`, `/health/ready`, cabeceras
CSP/HSTS/X-Content-Type-Options, banner de entorno, login con cuenta de
staging, portada autenticada, calendario, comparador, centro de partido, picks
y boletas en lectura, y con `RUN_PLAYWRIGHT=1` añade navegación real en
escritorio y móvil, errores JavaScript, respuestas 4xx/5xx inesperadas y
búsqueda sin resultados duplicados. Las credenciales llegan sólo por variables
de entorno.

## Rollback

`promote-production.sh` registra cada cambio en `/opt/mi-app-futbol/RELEASE_HISTORY`
y conserva todas las releases anteriores en `releases/`. Para volver atrás:

```bash
# Vuelve al commit anterior registrado (o indica uno del historial):
deploy/rollback-production.sh          # usa el último registrado
deploy/rollback-production.sh <sha>    # o uno concreto del historial
```

El rollback sólo activa releases ya instaladas y registradas, exige teclear
`ROLLBACK` y verifica `/health/ready` al terminar. No toca MongoDB: si un
despliegue incluyó cambios de esquema, evalúa su compatibilidad hacia atrás
antes de promover (los cambios de datos requieren su propio plan autorizado).

## Qué NO hace ningún script de este flujo

- No ejecuta `npm run db:indexes` ni migraciones.
- No ejecuta `sync:*`, cron, workers ni Playdoit.
- No lee ni escribe la base de producción.
- No copia `.env` ni secretos.
- No borra releases, datos ni configuración.

#!/usr/bin/env bash
# Despliega UN COMMIT EXPLÍCITO en el entorno de staging gestionado por PM2.
#
# Infraestructura (fase 1, PM2):
#   Producción: proceso PM2 "futbol-app", cwd /var/www/mi-app-futbol, puerto 3000.
#   Staging:    procesos PM2 "futbol-staging" y "futbol-staging-2", cwd
#               /var/www/mi-app-futbol-staging, puertos 3100/3101, clon git
#               independiente y base -staging.
#
# Uso:   deploy/deploy-staging.sh <commit>
# Vars:  REPO_DIR         repositorio git de origen (por defecto, la raíz del repo del script)
#        STAGING_DIR      destino (por defecto /var/www/mi-app-futbol-staging)
#        STAGING_PM2_APP  nombre del proceso PM2 (por defecto futbol-staging)
#        STAGING_PORT     puerto interno (por defecto 3100)
#        STAGING_SECONDARY_PM2_APP / STAGING_SECONDARY_PORT
#                         segunda instancia (futbol-staging-2 / 3101)
#        SKIP_RESTART=1   sólo instala el commit, no toca PM2
#
# Garantías:
#  - No toca MongoDB ni ejecuta sincronizaciones ni npm run db:indexes.
#  - No contiene secretos: la configuración vive en ${STAGING_DIR}/.env
#    (basada en .env.staging.example, nunca versionada).
#  - Valida por PM2 el nombre, script y cwd del proceso antes de reiniciarlo:
#    jamás reinicia futbol-app ni un proceso con otro directorio.
#  - No usa rm -rf ni borra datos; se niega si el clon tiene cambios locales.
#  - Falla si el commit no existe o las rutas no son las esperadas.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
STAGING_DIR="${STAGING_DIR:-/var/www/mi-app-futbol-staging}"
STAGING_PM2_APP="${STAGING_PM2_APP:-futbol-staging}"
STAGING_PORT="${STAGING_PORT:-3100}"
STAGING_SECONDARY_PM2_APP="${STAGING_SECONDARY_PM2_APP:-${STAGING_PM2_APP}-2}"
STAGING_SECONDARY_PORT="${STAGING_SECONDARY_PORT:-3101}"

fallo() { echo "ERROR: $*" >&2; exit 1; }

[ "$#" -eq 1 ] || fallo "uso: $0 <commit>  (el commit debe indicarse explícitamente, no se asume 'lo último')"
COMMIT_PEDIDO="$1"

[ -d "${REPO_DIR}/.git" ] || fallo "REPO_DIR no es un repositorio git: ${REPO_DIR}"
case "${STAGING_DIR}" in
  *staging*) : ;;
  *) fallo "STAGING_DIR (${STAGING_DIR}) no contiene 'staging'; me niego a desplegar ahí." ;;
esac
[ "${STAGING_DIR}" != "${REPO_DIR}" ] || fallo "STAGING_DIR no puede ser el propio repositorio de origen."
for APP_STAGING in "${STAGING_PM2_APP}" "${STAGING_SECONDARY_PM2_APP}"; do
  case "${APP_STAGING}" in
    futbol-app) fallo "ningún proceso de staging puede llamarse futbol-app (producción)." ;;
  esac
done
[ "${STAGING_PM2_APP}" != "${STAGING_SECONDARY_PM2_APP}" ] \
  || fallo "las instancias primaria y secundaria deben tener nombres distintos."
[ "${STAGING_PORT}" != "${STAGING_SECONDARY_PORT}" ] \
  || fallo "las instancias primaria y secundaria deben usar puertos distintos."
command -v pm2 >/dev/null || fallo "pm2 no está disponible."

git -C "${REPO_DIR}" cat-file -e "${COMMIT_PEDIDO}^{commit}" 2>/dev/null \
  || fallo "el commit '${COMMIT_PEDIDO}' no existe en ${REPO_DIR}"
SHA="$(git -C "${REPO_DIR}" rev-parse "${COMMIT_PEDIDO}^{commit}")"

# --- Clon independiente de staging -------------------------------------------
# Orden de instalación soportado: puedes crear ${STAGING_DIR} y colocar el
# .env ANTES del primer despliegue (es el flujo documentado). Si el directorio
# ya existe sin .git, sólo se acepta si contiene exclusivamente artefactos
# esperados de aprovisionamiento (.env, var/, marcadores de despliegue).
if [ ! -d "${STAGING_DIR}/.git" ]; then
  if [ -d "${STAGING_DIR}" ]; then
    while IFS= read -r ENTRADA; do
      case "${ENTRADA}" in
        .env|DEPLOYED_COMMIT|VALIDATED_COMMIT|var) : ;;
        *) fallo "${STAGING_DIR} contiene '${ENTRADA}', que no es un artefacto esperado de staging; resuélvelo manualmente antes de desplegar." ;;
      esac
    done < <(ls -A "${STAGING_DIR}")
  else
    mkdir -p "${STAGING_DIR}"
  fi
  echo "Inicializando clon de staging en ${STAGING_DIR} (se conserva el .env existente)..."
  git -C "${STAGING_DIR}" init --quiet
fi

# Nunca pisar cambios locales del clon (los archivos sin seguimiento, como
# .env o DEPLOYED_COMMIT, no cuentan).
[ -z "$(git -C "${STAGING_DIR}" status --porcelain --untracked-files=no)" ] \
  || fallo "el clon de staging tiene cambios locales en archivos versionados; resuélvelos antes de desplegar."

git -C "${STAGING_DIR}" fetch --quiet "${REPO_DIR}" '+refs/heads/*:refs/remotes/origen/*' 2>/dev/null || true
git -C "${STAGING_DIR}" cat-file -e "${SHA}^{commit}" 2>/dev/null \
  || fallo "el commit ${SHA} no llegó al clon de staging; revisa el fetch."

# --- Configuración de staging -------------------------------------------------
ENV_STAGING="${STAGING_DIR}/.env"
[ -f "${ENV_STAGING}" ] || fallo "falta ${ENV_STAGING}. Créalo a partir de .env.staging.example (permisos 600, secretos propios)."
grep -Eq '^MONGODB_URI=.*-staging([?/]|$)' "${ENV_STAGING}" \
  || fallo "MONGODB_URI de ${ENV_STAGING} no apunta a una base terminada en -staging; me niego a arrancar."
grep -Eq "^PORT=${STAGING_PORT}$" "${ENV_STAGING}" \
  || fallo "PORT de ${ENV_STAGING} no es ${STAGING_PORT}."
grep -Eq '^APP_ENVIRONMENT=staging$' "${ENV_STAGING}" \
  || fallo "APP_ENVIRONMENT de ${ENV_STAGING} debe ser 'staging' (activa el banner de prueba)."

# --- Checkout del commit exacto ------------------------------------------------
echo "Desplegando commit ${SHA} en ${STAGING_DIR}..."
git -C "${STAGING_DIR}" checkout --detach --quiet "${SHA}"
[ -f "${STAGING_DIR}/server.js" ] || fallo "el checkout no contiene server.js; abortando."
echo "Instalando dependencias de producción (npm ci --omit=dev)..."
(cd "${STAGING_DIR}" && npm ci --omit=dev --no-audit --no-fund)
mkdir -p "${STAGING_DIR}/var"
printf '%s\n' "${SHA}" > "${STAGING_DIR}/DEPLOYED_COMMIT"

if [ "${SKIP_RESTART:-0}" = "1" ]; then
  echo "SKIP_RESTART=1: no se toca PM2."
  exit 0
fi

# --- Procesos PM2 de staging (validados por nombre, script y cwd) --------------
JLIST="$(pm2 jlist)"
reiniciar_instancia() {
  local APP="$1" PUERTO="$2" ESTADO CWD_PM2 SCRIPT_PM2
  if ESTADO="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${APP}" status)"; then
    CWD_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${APP}" cwd)"
    SCRIPT_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${APP}" script)"
    [ "${CWD_PM2}" = "${STAGING_DIR}" ] \
      || fallo "el proceso PM2 ${APP} tiene cwd '${CWD_PM2}', no ${STAGING_DIR}; no lo reinicio."
    case "${SCRIPT_PM2}" in
      */server.js) : ;;
      *) fallo "el proceso PM2 ${APP} ejecuta '${SCRIPT_PM2}', no server.js; no lo reinicio." ;;
    esac
    echo "Reiniciando proceso PM2 ${APP} en puerto ${PUERTO} (estado previo: ${ESTADO})..."
    PORT="${PUERTO}" pm2 restart "${APP}" --update-env
  else
    echo "Creando proceso PM2 ${APP} en puerto ${PUERTO}..."
    PORT="${PUERTO}" pm2 start "${STAGING_DIR}/server.js" --name "${APP}" --cwd "${STAGING_DIR}" --time
  fi
}

reiniciar_instancia "${STAGING_PM2_APP}" "${STAGING_PORT}"
reiniciar_instancia "${STAGING_SECONDARY_PM2_APP}" "${STAGING_SECONDARY_PORT}"

esperar_ready() {
  local APP="$1" PUERTO="$2"
  echo "Esperando a que ${APP} responda /health/ready en 127.0.0.1:${PUERTO}..."
  for intento in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${PUERTO}/health/ready" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  fallo "${APP} no respondió /health/ready; revisa: pm2 logs ${APP}"
}

esperar_ready "${STAGING_PM2_APP}" "${STAGING_PORT}"
esperar_ready "${STAGING_SECONDARY_PM2_APP}" "${STAGING_SECONDARY_PORT}"
pm2 save >/dev/null 2>&1 || true

echo "Staging desplegado y saludable en ambos procesos con el commit ${SHA}."
echo "Siguiente paso: deploy/smoke-staging.sh para validar y registrar el commit."

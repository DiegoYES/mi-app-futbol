#!/usr/bin/env bash
# Despliega UN COMMIT EXPLÍCITO en el entorno de staging.
#
# Uso:   deploy/deploy-staging.sh <commit>
# Vars:  REPO_DIR         repositorio git de origen (por defecto, la raíz del repo del script)
#        STAGING_DIR      destino (por defecto /opt/mi-app-futbol-staging)
#        STAGING_SERVICE  servicio systemd (por defecto mi-app-futbol-staging)
#        STAGING_PORT     puerto interno (por defecto 3100)
#        SKIP_RESTART=1   sólo instala la release, no reinicia el servicio
#
# Garantías:
#  - No toca MongoDB ni ejecuta sincronizaciones ni npm run db:indexes.
#  - No contiene secretos: la configuración vive en /etc/mi-app-futbol-staging/app.env.
#  - No usa rm -rf: cada commit se instala en releases/<sha> y "current" es un symlink.
#  - Falla si el commit no existe o las rutas no son las esperadas.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
STAGING_DIR="${STAGING_DIR:-/opt/mi-app-futbol-staging}"
STAGING_SERVICE="${STAGING_SERVICE:-mi-app-futbol-staging}"
STAGING_PORT="${STAGING_PORT:-3100}"

fallo() { echo "ERROR: $*" >&2; exit 1; }

[ "$#" -eq 1 ] || fallo "uso: $0 <commit>  (el commit debe indicarse explícitamente, no se asume 'lo último')"
COMMIT_PEDIDO="$1"

[ -d "${REPO_DIR}/.git" ] || fallo "REPO_DIR no es un repositorio git: ${REPO_DIR}"
case "${STAGING_DIR}" in
  *staging*) : ;;
  *) fallo "STAGING_DIR (${STAGING_DIR}) no contiene 'staging'; me niego a desplegar ahí." ;;
esac

git -C "${REPO_DIR}" cat-file -e "${COMMIT_PEDIDO}^{commit}" 2>/dev/null \
  || fallo "el commit '${COMMIT_PEDIDO}' no existe en ${REPO_DIR}"
SHA="$(git -C "${REPO_DIR}" rev-parse "${COMMIT_PEDIDO}^{commit}")"

RELEASE_DIR="${STAGING_DIR}/releases/${SHA}"
mkdir -p "${STAGING_DIR}/releases"

if [ -f "${RELEASE_DIR}/.release-ok" ]; then
  echo "La release ${SHA} ya está instalada; se reutiliza."
else
  mkdir -p "${RELEASE_DIR}"
  echo "Exportando commit ${SHA} a ${RELEASE_DIR}..."
  git -C "${REPO_DIR}" archive "${SHA}" | tar -x -C "${RELEASE_DIR}"
  [ -f "${RELEASE_DIR}/server.js" ] || fallo "la exportación no contiene server.js; abortando."
  echo "Instalando dependencias de producción (npm ci --omit=dev)..."
  (cd "${RELEASE_DIR}" && npm ci --omit=dev --no-audit --no-fund)
  mkdir -p "${RELEASE_DIR}/var"
  touch "${RELEASE_DIR}/.release-ok"
fi

# Activación atómica mediante symlink; la release anterior queda intacta.
ln -sfn "${RELEASE_DIR}" "${STAGING_DIR}/current"
printf '%s\n' "${SHA}" > "${STAGING_DIR}/DEPLOYED_COMMIT"
echo "current -> ${RELEASE_DIR}"

if [ "${SKIP_RESTART:-0}" = "1" ]; then
  echo "SKIP_RESTART=1: no se reinicia el servicio."
  exit 0
fi

command -v systemctl >/dev/null || fallo "systemctl no disponible; reinicia el servicio manualmente."
echo "Reiniciando ${STAGING_SERVICE}..."
sudo systemctl restart "${STAGING_SERVICE}"

echo "Esperando a que /health/ready responda en 127.0.0.1:${STAGING_PORT}..."
for intento in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${STAGING_PORT}/health/ready" >/dev/null 2>&1; then
    echo "Staging desplegado y saludable con el commit ${SHA}."
    echo "Siguiente paso: deploy/smoke-staging.sh para validar y registrar el commit."
    exit 0
  fi
  sleep 2
done
fallo "el servicio no respondió /health/ready tras el despliegue; revisa: journalctl -u ${STAGING_SERVICE}"

#!/usr/bin/env bash
# Promueve a PRODUCCIÓN exactamente un commit ya VALIDADO en staging.
#
# Uso:   deploy/promote-production.sh <commit>
# Vars:  REPO_DIR            repositorio git de origen
#        PROD_DIR            (por defecto /opt/mi-app-futbol)
#        PROD_SERVICE        (por defecto mi-app-futbol)
#        PROD_PORT           (por defecto 3000)
#        STAGING_DIR         (por defecto /opt/mi-app-futbol-staging) — de aquí
#                            se lee VALIDATED_COMMIT.
#
# Garantías:
#  - Rechaza cualquier commit que no coincida con el registrado como validado
#    por deploy/smoke-staging.sh.
#  - Exige teclear una confirmación explícita.
#  - Verifica que el servicio systemd ejecuta desde ${PROD_DIR}/current; si el
#    servicio aún trabaja sobre ${PROD_DIR} directamente, aborta con
#    instrucciones de migración (cambiar el symlink no tendría efecto).
#  - Si el nuevo proceso no queda saludable, revierte automáticamente al
#    release anterior y reinicia.
#  - Registra el commit anterior en ${PROD_DIR}/RELEASE_HISTORY para rollback.
#  - No toca MongoDB, no ejecuta db:indexes ni sincronizaciones, no borra nada.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
PROD_DIR="${PROD_DIR:-/opt/mi-app-futbol}"
PROD_SERVICE="${PROD_SERVICE:-mi-app-futbol}"
PROD_PORT="${PROD_PORT:-3000}"
STAGING_DIR="${STAGING_DIR:-/opt/mi-app-futbol-staging}"

fallo() { echo "ERROR: $*" >&2; exit 1; }

[ "$#" -eq 1 ] || fallo "uso: $0 <commit>  (debes indicar el commit exacto a promover)"
[ -d "${REPO_DIR}/.git" ] || fallo "REPO_DIR no es un repositorio git: ${REPO_DIR}"
[ -d "${PROD_DIR}" ] || fallo "no existe PROD_DIR: ${PROD_DIR}"

git -C "${REPO_DIR}" cat-file -e "$1^{commit}" 2>/dev/null || fallo "el commit '$1' no existe."
SHA="$(git -C "${REPO_DIR}" rev-parse "$1^{commit}")"

# El flujo de releases sólo funciona si el servicio ejecuta desde current.
# Si sigue apuntando al directorio plano, cambiar el symlink no cambiaría el
# código en ejecución y este script informaría un éxito falso.
WD_SERVICIO="$(systemctl show -p WorkingDirectory --value "${PROD_SERVICE}" 2>/dev/null || true)"
if [ "${WD_SERVICIO}" != "${PROD_DIR}/current" ]; then
  fallo "el servicio ${PROD_SERVICE} ejecuta desde '${WD_SERVICIO:-desconocido}', no desde ${PROD_DIR}/current.
Migra primero (una sola vez, con autorización):
  1. Actualiza WorkingDirectory y ReadWritePaths en /etc/systemd/system/${PROD_SERVICE}.service
     según la plantilla deploy/mi-app-futbol.service del repositorio.
  2. Instala el commit actual como release inicial:
     PROD_DIR=${PROD_DIR} deploy/promote-production.sh <commit_actual>  (tras la migración)
  3. sudo systemctl daemon-reload && sudo systemctl restart ${PROD_SERVICE}"
fi

VALIDADO_ARCHIVO="${STAGING_DIR}/VALIDATED_COMMIT"
[ -f "${VALIDADO_ARCHIVO}" ] || fallo "no existe ${VALIDADO_ARCHIVO}: valida primero el commit en staging con smoke-staging.sh."
VALIDADO="$(cat "${VALIDADO_ARCHIVO}")"
[ "${SHA}" = "${VALIDADO}" ] || fallo "el commit ${SHA} NO coincide con el validado en staging (${VALIDADO}). Sólo se promueve un commit validado."

ACTUAL="(desconocido)"
[ -f "${PROD_DIR}/DEPLOYED_COMMIT" ] && ACTUAL="$(cat "${PROD_DIR}/DEPLOYED_COMMIT")"

echo "Vas a promover a PRODUCCIÓN:"
echo "  Commit nuevo   : ${SHA}"
echo "  Commit actual  : ${ACTUAL}"
echo "  Directorio     : ${PROD_DIR}"
echo "  Servicio       : ${PROD_SERVICE}"
echo "Este script NO toca MongoDB, ni índices, ni sincronizaciones."
printf 'Escribe exactamente PROMOVER para continuar: '
read -r CONFIRMACION
[ "${CONFIRMACION}" = "PROMOVER" ] || fallo "confirmación incorrecta; no se hace nada."

RELEASE_DIR="${PROD_DIR}/releases/${SHA}"
mkdir -p "${PROD_DIR}/releases"

if [ ! -f "${RELEASE_DIR}/.release-ok" ]; then
  mkdir -p "${RELEASE_DIR}"
  echo "Exportando commit ${SHA} a ${RELEASE_DIR}..."
  git -C "${REPO_DIR}" archive "${SHA}" | tar -x -C "${RELEASE_DIR}"
  [ -f "${RELEASE_DIR}/server.js" ] || fallo "la exportación no contiene server.js; abortando."
  (cd "${RELEASE_DIR}" && npm ci --omit=dev --no-audit --no-fund)
  mkdir -p "${RELEASE_DIR}/var"
  touch "${RELEASE_DIR}/.release-ok"
fi

# Registro para rollback ANTES de cambiar nada.
printf '%s %s -> %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${ACTUAL}" "${SHA}" >> "${PROD_DIR}/RELEASE_HISTORY"

RELEASE_ANTERIOR=""
[ -L "${PROD_DIR}/current" ] && RELEASE_ANTERIOR="$(readlink -f "${PROD_DIR}/current")"

ln -sfn "${RELEASE_DIR}" "${PROD_DIR}/current"
printf '%s\n' "${SHA}" > "${PROD_DIR}/DEPLOYED_COMMIT"

echo "Reiniciando ${PROD_SERVICE}..."
sudo systemctl restart "${PROD_SERVICE}"

for intento in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PROD_PORT}/health/ready" >/dev/null 2>&1; then
    echo "Producción actualizada al commit ${SHA}."
    echo "Si algo falla: deploy/rollback-production.sh"
    exit 0
  fi
  sleep 2
done

echo "ERROR: producción no respondió /health/ready con el commit ${SHA}." >&2
if [ -n "${RELEASE_ANTERIOR}" ] && [ -f "${RELEASE_ANTERIOR}/.release-ok" ]; then
  echo "Revirtiendo automáticamente al release anterior: ${RELEASE_ANTERIOR}" >&2
  printf '%s %s -> %s (auto-rollback)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SHA}" "${ACTUAL}" >> "${PROD_DIR}/RELEASE_HISTORY"
  ln -sfn "${RELEASE_ANTERIOR}" "${PROD_DIR}/current"
  [ "${ACTUAL}" != "(desconocido)" ] && printf '%s\n' "${ACTUAL}" > "${PROD_DIR}/DEPLOYED_COMMIT"
  sudo systemctl restart "${PROD_SERVICE}"
  for intento in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${PROD_PORT}/health/ready" >/dev/null 2>&1; then
      fallo "promoción fallida; producción quedó revertida y saludable con el release anterior. Revisa journalctl -u ${PROD_SERVICE}."
    fi
    sleep 2
  done
  fallo "promoción fallida y el auto-rollback tampoco respondió /health/ready. INTERVENCIÓN MANUAL URGENTE: journalctl -u ${PROD_SERVICE}."
fi
fallo "no hay release anterior instalado para auto-rollback. Revisa journalctl -u ${PROD_SERVICE} y usa deploy/rollback-production.sh si hay historial."

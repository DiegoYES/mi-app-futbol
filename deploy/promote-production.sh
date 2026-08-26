#!/usr/bin/env bash
# Promoción segura mediante releases inmutables + systemd.
# Uso: sudo deploy/promote-production.sh <commit> [--check]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
STAGING_DIR="${STAGING_DIR:-/var/www/mi-app-futbol-staging}"
RELEASES_DIR="${RELEASES_DIR:-/opt/mi-app-futbol}"
PROD_SERVICE="${PROD_SERVICE:-mi-app-futbol}"
PROD_USER="${PROD_USER:-miappfutbol}"
PROD_PORT="${PROD_PORT:-3000}"
UNIT_PATH="${UNIT_PATH:-/etc/systemd/system/${PROD_SERVICE}.service}"
EXPECTED_WORKING_DIR="${EXPECTED_WORKING_DIR:-${RELEASES_DIR}/current}"
DEPLOY_CONFIG="${DEPLOY_CONFIG:-/etc/mi-app-futbol/deploy.env}"
fallo() { echo "ERROR: $*" >&2; exit 1; }
[ "${EUID}" -eq 0 ] || fallo "ejecuta mediante sudo."
if [ -f "${DEPLOY_CONFIG}" ]; then
  [ "$(stat -c %U "${DEPLOY_CONFIG}")" = root ] || { echo "ERROR: ${DEPLOY_CONFIG} no pertenece a root." >&2; exit 1; }
  PERMISOS_CONFIG="$(stat -c %A "${DEPLOY_CONFIG}")"
  [ "${PERMISOS_CONFIG:5:1}" != w ] && [ "${PERMISOS_CONFIG:8:1}" != w ] \
    || { echo "ERROR: ${DEPLOY_CONFIG} permite escritura a grupo/otros." >&2; exit 1; }
  # Configuración no secreta instalada al activar el pool de producción.
  # shellcheck disable=SC1090
  source "${DEPLOY_CONFIG}"
fi
PROD_SERVICES="${PROD_SERVICES:-${PROD_SERVICE}}"
PROD_PORTS="${PROD_PORTS:-${PROD_PORT}}"
PROD_UNIT_PATHS="${PROD_UNIT_PATHS:-${UNIT_PATH}}"
POOL_SETTLE_SECONDS="${POOL_SETTLE_SECONDS:-11}"
read -r -a POOL_SERVICES <<< "${PROD_SERVICES}"
read -r -a POOL_PORTS <<< "${PROD_PORTS}"
read -r -a POOL_UNIT_PATHS <<< "${PROD_UNIT_PATHS}"
CHECK_ONLY=0
[ "$#" -ge 1 ] && [ "$#" -le 2 ] || fallo "uso: sudo $0 <commit> [--check]"
PEDIDO="$1"
if [ "${2:-}" = --check ]; then CHECK_ONLY=1; elif [ "$#" -eq 2 ]; then fallo "opción desconocida: $2"; fi
[ "${#POOL_SERVICES[@]}" -gt 0 ] \
  && [ "${#POOL_SERVICES[@]}" -eq "${#POOL_PORTS[@]}" ] \
  && [ "${#POOL_SERVICES[@]}" -eq "${#POOL_UNIT_PATHS[@]}" ] \
  || fallo "PROD_SERVICES, PROD_PORTS y PROD_UNIT_PATHS deben tener la misma cantidad de elementos."
[[ "${POOL_SETTLE_SECONDS}" =~ ^[0-9]+$ ]] || fallo "POOL_SETTLE_SECONDS debe ser un entero no negativo."
[ -d "${REPO_DIR}/.git" ] || fallo "no es repositorio: ${REPO_DIR}"
[ -d "${RELEASES_DIR}/releases" ] || fallo "falta el directorio de releases."
[ -L "${RELEASES_DIR}/current" ] || fallo "current no es un symlink."
id "${PROD_USER}" >/dev/null 2>&1 || fallo "no existe ${PROD_USER}."
for COMANDO in curl flock git npm readlink stat systemctl tar; do
  command -v "${COMANDO}" >/dev/null || fallo "${COMANDO} no está disponible."
done
exec 9<"${RELEASES_DIR}/releases"
flock -n 9 || fallo "hay otra promoción o rollback en curso."
GIT=(git -c "safe.directory=${REPO_DIR}" -C "${REPO_DIR}")
"${GIT[@]}" cat-file -e "${PEDIDO}^{commit}" 2>/dev/null || fallo "commit inexistente: ${PEDIDO}"
SHA="$("${GIT[@]}" rev-parse "${PEDIDO}^{commit}")"
VALIDADO_FILE="${STAGING_DIR}/VALIDATED_COMMIT"
[ -f "${VALIDADO_FILE}" ] || fallo "falta ${VALIDADO_FILE}; valida staging primero."
VALIDADO="$(tr -d '\r\n' < "${VALIDADO_FILE}")"
[ "${SHA}" = "${VALIDADO}" ] || fallo "${SHA} no coincide con staging validado (${VALIDADO})."
for INDICE in "${!POOL_SERVICES[@]}"; do
  SERVICIO="${POOL_SERVICES[${INDICE}]}"; RUTA_UNIDAD="${POOL_UNIT_PATHS[${INDICE}]}"
  [ "$(systemctl show "${SERVICIO}" -p LoadState --value)" = loaded ] || fallo "${SERVICIO} no está cargado."
  [ "$(systemctl show "${SERVICIO}" -p FragmentPath --value)" = "${RUTA_UNIDAD}" ] || fallo "ruta inesperada para ${SERVICIO}."
  [ "$(systemctl show "${SERVICIO}" -p WorkingDirectory --value)" = "${EXPECTED_WORKING_DIR}" ] || fallo "WorkingDirectory inesperado en ${SERVICIO}."
  [ "$(systemctl show "${SERVICIO}" -p User --value)" = "${PROD_USER}" ] || fallo "usuario inesperado en ${SERVICIO}."
  case "$(systemctl show "${SERVICIO}" -p ExecStart --value)" in *server.js*) :;; *) fallo "${SERVICIO} no ejecuta server.js.";; esac
  [ "$(systemctl is-active "${SERVICIO}")" = active ] || fallo "${SERVICIO} no está activo."
done
CURRENT_REAL="$(readlink -f "${RELEASES_DIR}/current")"
case "${CURRENT_REAL}" in "${RELEASES_DIR}/releases/"*) :;; *) fallo "current apunta fuera de releases.";; esac
[ ! -L "${CURRENT_REAL}" ] || fallo "el release activo no puede ser un symlink."
[ -f "${CURRENT_REAL}/.release-ok" ] && [ -f "${CURRENT_REAL}/server.js" ] || fallo "release activo incompleto."
[ "$(stat -c %U "${CURRENT_REAL}")" = "${PROD_USER}" ] || fallo "propietario inesperado en el release activo."
BASE="$(basename "${CURRENT_REAL}")"
[[ "${BASE}" =~ ^[0-9a-f]{40}$ ]] || fallo "el release activo no tiene nombre SHA completo."
[ -f "${RELEASES_DIR}/DEPLOYED_COMMIT" ] || fallo "falta DEPLOYED_COMMIT."
MARCADOR="$(tr -d '\r\n' < "${RELEASES_DIR}/DEPLOYED_COMMIT")"
[ "${MARCADOR}" = "${BASE}" ] || fallo "DEPLOYED_COMMIT y current no coinciden."
[ "${SHA}" != "${BASE}" ] || fallo "producción ya sirve ${SHA}."
RELEASE_DIR="${RELEASES_DIR}/releases/${SHA}"
if [ -e "${RELEASE_DIR}" ]; then
  [ ! -L "${RELEASE_DIR}" ] || fallo "el release destino no puede ser un symlink."
  [ -d "${RELEASE_DIR}" ] && [ -f "${RELEASE_DIR}/.release-ok" ] && [ -f "${RELEASE_DIR}/server.js" ] || fallo "release destino incompleto."
  [ "$(stat -c %U "${RELEASE_DIR}")" = "${PROD_USER}" ] || fallo "propietario inesperado en el release destino."
fi
echo "Actual: ${BASE}"; echo "Nuevo : ${SHA}"; echo "Ruta  : ${RELEASE_DIR}"
if [ "${CHECK_ONLY}" = 1 ]; then echo "CHECK OK: no se modificó producción."; exit 0; fi
printf 'Escribe exactamente PROMOVER para continuar: '; read -r CONFIRMACION
[ "${CONFIRMACION}" = PROMOVER ] || fallo "confirmación incorrecta; no se hace nada."
BUILD_DIR="${RELEASES_DIR}/releases/.${SHA}.build.$$"
LINK_TMP="${RELEASES_DIR}/.current.$$"
ENLACE_CAMBIADO=0; OK=0
escribir_marcador() {
  local VALOR="$1" TMP="${RELEASES_DIR}/.DEPLOYED_COMMIT.$$"
  printf '%s\n' "${VALOR}" > "${TMP}"
  chmod 644 "${TMP}"
  mv -f "${TMP}" "${RELEASES_DIR}/DEPLOYED_COMMIT"
  # Espejo en el repositorio: permite que las verificaciones corridas desde
  # REPO_DIR (cron, scripts manuales) conozcan el release vigente.
  if [ -d "${REPO_DIR}" ] && [ -w "${REPO_DIR}" ]; then
    local TMP_REPO="${REPO_DIR}/.RELEASE_COMMIT.$$"
    printf '%s\n' "${VALOR}" > "${TMP_REPO}"
    chmod 644 "${TMP_REPO}"
    mv -f "${TMP_REPO}" "${REPO_DIR}/RELEASE_COMMIT"
  fi
}
saludable() {
  local PUERTO="$1"
  for _ in $(seq 1 20); do curl -fsS "http://127.0.0.1:${PUERTO}/health/ready" >/dev/null 2>&1 && return 0; sleep 2; done
  return 1
}
reiniciar_pool() {
  local VERSION_ESPERADA="$1"
  for INDICE in "${!POOL_SERVICES[@]}"; do
    systemctl restart "${POOL_SERVICES[${INDICE}]}" || return 1
    saludable "${POOL_PORTS[${INDICE}]}" || return 1
    curl -fsS "http://127.0.0.1:${POOL_PORTS[${INDICE}]}/health/version/${VERSION_ESPERADA}" >/dev/null 2>&1 || return 1
    if [ "${INDICE}" -lt "$(("${#POOL_SERVICES[@]}" - 1))" ] && [ "${POOL_SETTLE_SECONDS}" -gt 0 ]; then
      sleep "${POOL_SETTLE_SECONDS}"
    fi
  done
}
restaurar() {
  [ "${OK}" = 1 ] && return 0
  set +e
  rm -f "${LINK_TMP}" "${RELEASES_DIR}/.DEPLOYED_COMMIT.$$"
  case "${BUILD_DIR}" in "${RELEASES_DIR}/releases/.${SHA}.build."*) [ -d "${BUILD_DIR}" ] && rm -rf -- "${BUILD_DIR}";; esac
  if [ "${ENLACE_CAMBIADO}" = 1 ]; then
    echo "RESTAURANDO ${BASE}..." >&2
    ln -s "${CURRENT_REAL}" "${LINK_TMP}" && mv -Tf "${LINK_TMP}" "${RELEASES_DIR}/current"
    escribir_marcador "${BASE}"
    reiniciar_pool "${BASE}" && echo "Restauración saludable en todo el pool." >&2 \
      || echo "INTERVENCIÓN URGENTE: restauración incompleta en el pool." >&2
  fi
}
trap restaurar EXIT
if [ ! -d "${RELEASE_DIR}" ]; then
  mkdir "${BUILD_DIR}"
  "${GIT[@]}" archive "${SHA}" | tar -x -C "${BUILD_DIR}"
  [ -f "${BUILD_DIR}/server.js" ] || fallo "el commit no contiene server.js."
  (cd "${BUILD_DIR}" && npm ci --omit=dev --no-audit --no-fund)
  printf '%s\n' "${SHA}" > "${BUILD_DIR}/RELEASE_COMMIT"
  mkdir -p "${BUILD_DIR}/var"; touch "${BUILD_DIR}/.release-ok"
  chown -R "${PROD_USER}:${PROD_USER}" "${BUILD_DIR}"; mv "${BUILD_DIR}" "${RELEASE_DIR}"
fi
ln -s "${RELEASE_DIR}" "${LINK_TMP}"; mv -Tf "${LINK_TMP}" "${RELEASES_DIR}/current"; ENLACE_CAMBIADO=1
reiniciar_pool "${SHA}" || fallo "el release nuevo no respondió en todo el pool; se restaura ${BASE}."
escribir_marcador "${SHA}"
printf '%s promote -> %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SHA}" >> "${RELEASES_DIR}/RELEASE_HISTORY"
OK=1; trap - EXIT
echo "Producción actualizada y saludable con ${SHA}."

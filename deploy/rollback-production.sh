#!/usr/bin/env bash
# Rollback seguro entre releases existentes gestionados por systemd.
# Uso: sudo deploy/rollback-production.sh [commit] [--check]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
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
  # shellcheck disable=SC1090
  source "${DEPLOY_CONFIG}"
fi
PROD_SERVICES="${PROD_SERVICES:-${PROD_SERVICE}}"
PROD_PORTS="${PROD_PORTS:-${PROD_PORT}}"
PROD_UNIT_PATHS="${PROD_UNIT_PATHS:-${UNIT_PATH}}"
read -r -a POOL_SERVICES <<< "${PROD_SERVICES}"
read -r -a POOL_PORTS <<< "${PROD_PORTS}"
read -r -a POOL_UNIT_PATHS <<< "${PROD_UNIT_PATHS}"
CHECK_ONLY=0; PEDIDO=""
for ARG in "$@"; do
  case "${ARG}" in
    --check) [ "${CHECK_ONLY}" = 0 ] || fallo "--check repetido."; CHECK_ONLY=1 ;;
    --*) fallo "opción desconocida: ${ARG}" ;;
    *) [ -z "${PEDIDO}" ] || fallo "indica como máximo un commit."; PEDIDO="${ARG}" ;;
  esac
done
[ "${#POOL_SERVICES[@]}" -gt 0 ] \
  && [ "${#POOL_SERVICES[@]}" -eq "${#POOL_PORTS[@]}" ] \
  && [ "${#POOL_SERVICES[@]}" -eq "${#POOL_UNIT_PATHS[@]}" ] \
  || fallo "PROD_SERVICES, PROD_PORTS y PROD_UNIT_PATHS deben tener la misma cantidad de elementos."
[ -d "${REPO_DIR}/.git" ] || fallo "no es repositorio: ${REPO_DIR}"
[ -d "${RELEASES_DIR}/releases" ] || fallo "falta el directorio de releases."
[ -L "${RELEASES_DIR}/current" ] || fallo "current no es un symlink."
HISTORIAL="${RELEASES_DIR}/RELEASE_HISTORY"
[ -f "${HISTORIAL}" ] || fallo "falta RELEASE_HISTORY."
id "${PROD_USER}" >/dev/null 2>&1 || fallo "no existe ${PROD_USER}."
for COMANDO in curl flock git readlink stat systemctl; do
  command -v "${COMANDO}" >/dev/null || fallo "${COMANDO} no está disponible."
done
exec 9<"${RELEASES_DIR}/releases"
flock -n 9 || fallo "hay otra promoción o rollback en curso."
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
ACTUAL="$(basename "${CURRENT_REAL}")"
[[ "${ACTUAL}" =~ ^[0-9a-f]{40}$ ]] || fallo "el release activo no tiene nombre SHA completo."
[ -f "${RELEASES_DIR}/DEPLOYED_COMMIT" ] || fallo "falta DEPLOYED_COMMIT."
MARCADOR="$(tr -d '\r\n' < "${RELEASES_DIR}/DEPLOYED_COMMIT")"
[ "${MARCADOR}" = "${ACTUAL}" ] || fallo "DEPLOYED_COMMIT y current no coinciden."

if [ -z "${PEDIDO}" ]; then
  OBJETIVO="$(awk -v actual="${ACTUAL}" '$3 == "->" && $4 ~ /^[0-9a-f]{40}$/ && $4 != actual { objetivo=$4 } END { print objetivo }' "${HISTORIAL}")"
  [ -n "${OBJETIVO}" ] || fallo "el historial no contiene un release anterior distinto del actual."
else
  GIT=(git -c "safe.directory=${REPO_DIR}" -C "${REPO_DIR}")
  "${GIT[@]}" cat-file -e "${PEDIDO}^{commit}" 2>/dev/null || fallo "commit inexistente: ${PEDIDO}"
  OBJETIVO="$("${GIT[@]}" rev-parse "${PEDIDO}^{commit}")"
fi
[ "${OBJETIVO}" != "${ACTUAL}" ] || fallo "producción ya sirve ${OBJETIVO}."
awk -v objetivo="${OBJETIVO}" '$3 == "->" && $4 == objetivo { ok=1 } END { exit ok ? 0 : 1 }' "${HISTORIAL}" \
  || fallo "${OBJETIVO} no figura como activación saludable."
TARGET="${RELEASES_DIR}/releases/${OBJETIVO}"
[ ! -L "${TARGET}" ] || fallo "el release objetivo no puede ser un symlink."
[ -d "${TARGET}" ] && [ -f "${TARGET}/.release-ok" ] && [ -f "${TARGET}/server.js" ] || fallo "release objetivo incompleto o ausente."
[ "$(stat -c %U "${TARGET}")" = "${PROD_USER}" ] || fallo "propietario inesperado en el release objetivo."

echo "Actual   : ${ACTUAL}"
echo "Rollback : ${OBJETIVO}"
echo "Ruta     : ${TARGET}"
if [ "${CHECK_ONLY}" = 1 ]; then echo "CHECK OK: no se modificó producción."; exit 0; fi
printf 'Escribe exactamente ROLLBACK para continuar: '; read -r CONFIRMACION
[ "${CONFIRMACION}" = ROLLBACK ] || fallo "confirmación incorrecta; no se hace nada."

LINK_TMP="${RELEASES_DIR}/.current.$$"; ENLACE_CAMBIADO=0; OK=0
escribir_marcador() {
  local VALOR="$1" TMP="${RELEASES_DIR}/.DEPLOYED_COMMIT.$$"
  printf '%s\n' "${VALOR}" > "${TMP}"
  chmod 644 "${TMP}"
  mv -f "${TMP}" "${RELEASES_DIR}/DEPLOYED_COMMIT"
}
saludable() {
  local PUERTO="$1"
  for _ in $(seq 1 20); do curl -fsS "http://127.0.0.1:${PUERTO}/health/ready" >/dev/null 2>&1 && return 0; sleep 2; done
  return 1
}
reiniciar_pool() {
  for INDICE in "${!POOL_SERVICES[@]}"; do
    systemctl restart "${POOL_SERVICES[${INDICE}]}" || return 1
    saludable "${POOL_PORTS[${INDICE}]}" || return 1
  done
}
restaurar() {
  [ "${OK}" = 1 ] && return 0
  set +e; rm -f "${LINK_TMP}" "${RELEASES_DIR}/.DEPLOYED_COMMIT.$$"
  if [ "${ENLACE_CAMBIADO}" = 1 ]; then
    echo "RESTAURANDO ${ACTUAL}..." >&2
    ln -s "${CURRENT_REAL}" "${LINK_TMP}" && mv -Tf "${LINK_TMP}" "${RELEASES_DIR}/current"
    escribir_marcador "${ACTUAL}"
    reiniciar_pool && echo "Restauración saludable en todo el pool." >&2 \
      || echo "INTERVENCIÓN URGENTE: restauración incompleta en el pool." >&2
  fi
}
trap restaurar EXIT
ln -s "${TARGET}" "${LINK_TMP}"; mv -Tf "${LINK_TMP}" "${RELEASES_DIR}/current"; ENLACE_CAMBIADO=1
reiniciar_pool || fallo "el rollback no respondió en todo el pool; se restaura ${ACTUAL}."
escribir_marcador "${OBJETIVO}"
printf '%s rollback -> %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${OBJETIVO}" >> "${HISTORIAL}"
OK=1; trap - EXIT
echo "Rollback completado y saludable con ${OBJETIVO}."

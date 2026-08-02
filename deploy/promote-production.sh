#!/usr/bin/env bash
# Promueve a PRODUCCIÓN (proceso PM2 "futbol-app") exactamente un commit ya
# VALIDADO en staging. Fase 1: producción sigue en PM2; la migración a
# systemd/usuario restringido es la fase 2 documentada en docs/STAGING.md.
#
# Uso:   deploy/promote-production.sh <commit>
# Vars:  PROD_DIR       (por defecto /var/www/mi-app-futbol)
#        PROD_PM2_APP   (por defecto futbol-app)
#        PROD_PORT      (por defecto 3000)
#        STAGING_DIR    (por defecto /var/www/mi-app-futbol-staging) — de aquí
#                       se lee VALIDATED_COMMIT.
#
# Garantías:
#  - Rechaza cualquier commit que no coincida con el registrado como validado
#    por deploy/smoke-staging.sh.
#  - Valida por PM2 el nombre, script y cwd del proceso productivo antes de
#    tocarlo; detecta el commit actual con git en ese cwd.
#  - Se niega si el árbol de producción tiene cambios locales versionados.
#  - Exige teclear una confirmación explícita.
#  - Registra el commit anterior en ${PROD_DIR}/RELEASE_HISTORY y, si el nuevo
#    proceso no queda saludable, revierte automáticamente a ese commit.
#  - No toca MongoDB, no ejecuta db:indexes ni sincronizaciones, no borra nada.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="${PROD_DIR:-/var/www/mi-app-futbol}"
PROD_PM2_APP="${PROD_PM2_APP:-futbol-app}"
PROD_PORT="${PROD_PORT:-3000}"
STAGING_DIR="${STAGING_DIR:-/var/www/mi-app-futbol-staging}"

fallo() { echo "ERROR: $*" >&2; exit 1; }

[ "$#" -eq 1 ] || fallo "uso: $0 <commit>  (debes indicar el commit exacto a promover)"
[ -d "${PROD_DIR}/.git" ] || fallo "PROD_DIR no es un repositorio git: ${PROD_DIR}"
command -v pm2 >/dev/null || fallo "pm2 no está disponible."

git -C "${PROD_DIR}" cat-file -e "$1^{commit}" 2>/dev/null || fallo "el commit '$1' no existe en ${PROD_DIR}."
SHA="$(git -C "${PROD_DIR}" rev-parse "$1^{commit}")"

# --- Validación del proceso PM2 productivo -----------------------------------
JLIST="$(pm2 jlist)"
ESTADO="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${PROD_PM2_APP}" status)" \
  || fallo "no existe el proceso PM2 '${PROD_PM2_APP}'."
CWD_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${PROD_PM2_APP}" cwd)"
SCRIPT_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${PROD_PM2_APP}" script)"
[ "${ESTADO}" = "online" ] || fallo "el proceso ${PROD_PM2_APP} no está online (estado: ${ESTADO})."
[ "${CWD_PM2}" = "${PROD_DIR}" ] \
  || fallo "el proceso ${PROD_PM2_APP} ejecuta desde '${CWD_PM2}', no desde ${PROD_DIR}; ajusta PROD_DIR o el proceso."
case "${SCRIPT_PM2}" in
  */server.js) : ;;
  *) fallo "el proceso ${PROD_PM2_APP} ejecuta '${SCRIPT_PM2}', no server.js; me niego a continuar." ;;
esac

# --- Sólo se promueve el commit validado en staging ---------------------------
VALIDADO_ARCHIVO="${STAGING_DIR}/VALIDATED_COMMIT"
[ -f "${VALIDADO_ARCHIVO}" ] || fallo "no existe ${VALIDADO_ARCHIVO}: valida primero el commit en staging con smoke-staging.sh."
VALIDADO="$(cat "${VALIDADO_ARCHIVO}")"
[ "${SHA}" = "${VALIDADO}" ] || fallo "el commit ${SHA} NO coincide con el validado en staging (${VALIDADO}). Sólo se promueve un commit validado."

# --- Estado actual de producción ----------------------------------------------
[ -z "$(git -C "${PROD_DIR}" status --porcelain --untracked-files=no)" ] \
  || fallo "el árbol de producción tiene cambios locales en archivos versionados; guárdalos o descártalos antes de promover."
ACTUAL="$(git -C "${PROD_DIR}" rev-parse HEAD)"
[ "${ACTUAL}" != "${SHA}" ] || fallo "producción ya ejecuta el commit ${SHA}; nada que promover."

echo "Vas a promover a PRODUCCIÓN (PM2):"
echo "  Proceso        : ${PROD_PM2_APP} (online, cwd ${CWD_PM2})"
echo "  Commit actual  : ${ACTUAL}"
echo "  Commit nuevo   : ${SHA}"
echo "Este script NO toca MongoDB, ni índices, ni sincronizaciones."
printf 'Escribe exactamente PROMOVER para continuar: '
read -r CONFIRMACION
[ "${CONFIRMACION}" = "PROMOVER" ] || fallo "confirmación incorrecta; no se hace nada."

# Registro para rollback ANTES de cambiar nada.
printf '%s %s -> %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${ACTUAL}" "${SHA}" >> "${PROD_DIR}/RELEASE_HISTORY"

reiniciar_y_verificar() { # reiniciar_y_verificar -> 0 si /health/ready responde
  pm2 restart "${PROD_PM2_APP}" --update-env
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${PROD_PORT}/health/ready" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

echo "Activando commit ${SHA} en ${PROD_DIR}..."
git -C "${PROD_DIR}" checkout --detach --quiet "${SHA}"
[ -f "${PROD_DIR}/server.js" ] || fallo "el checkout no contiene server.js; abortando antes de reiniciar."
(cd "${PROD_DIR}" && npm ci --omit=dev --no-audit --no-fund)

if reiniciar_y_verificar; then
  printf '%s\n' "${SHA}" > "${PROD_DIR}/DEPLOYED_COMMIT"
  echo "Producción actualizada al commit ${SHA}."
  echo "Si algo falla: deploy/rollback-production.sh"
  exit 0
fi

echo "ERROR: producción no respondió /health/ready con el commit ${SHA}; revirtiendo a ${ACTUAL}..." >&2
printf '%s %s -> %s (auto-rollback)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SHA}" "${ACTUAL}" >> "${PROD_DIR}/RELEASE_HISTORY"
git -C "${PROD_DIR}" checkout --detach --quiet "${ACTUAL}"
(cd "${PROD_DIR}" && npm ci --omit=dev --no-audit --no-fund)
if reiniciar_y_verificar; then
  printf '%s\n' "${ACTUAL}" > "${PROD_DIR}/DEPLOYED_COMMIT"
  fallo "promoción fallida; producción quedó revertida y saludable con ${ACTUAL}. Revisa pm2 logs ${PROD_PM2_APP}."
fi
fallo "promoción fallida y el auto-rollback tampoco respondió /health/ready. INTERVENCIÓN MANUAL URGENTE: pm2 logs ${PROD_PM2_APP}."

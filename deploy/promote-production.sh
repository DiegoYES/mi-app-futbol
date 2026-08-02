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
#  - Transaccional desde antes del checkout: si fallan el checkout, npm ci,
#    pm2 restart o el health check, restaura el commit anterior, reinstala sus
#    dependencias, repone DEPLOYED_COMMIT y verifica que PM2 quede saludable.
#  - RELEASE_HISTORY sólo registra activaciones saludables ("fecha commit
#    etiqueta"); un commit fallido nunca queda como destino de rollback.
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

# --- Historial de activaciones -------------------------------------------------
# RELEASE_HISTORY registra SÓLO activaciones que quedaron saludables, una por
# línea con campos exactos: "<fecha> <commit> <etiqueta>". Un commit fallido
# jamás se registra, así el rollback sin argumento nunca lo seleccionará.
HISTORIAL="${PROD_DIR}/RELEASE_HISTORY"
registrar() { # registrar <commit> <etiqueta>
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "${HISTORIAL}"
}
# El commit actual está online y validado por PM2: es un destino legítimo de
# rollback. Regístralo como base si el historial no lo tiene como última entrada.
if [ ! -f "${HISTORIAL}" ] || [ "$(awk 'END{print $2}' "${HISTORIAL}")" != "${ACTUAL}" ]; then
  registrar "${ACTUAL}" "baseline"
fi

DEPLOYED_PREVIO=""
DEPLOYED_EXISTIA=0
if [ -f "${PROD_DIR}/DEPLOYED_COMMIT" ]; then
  DEPLOYED_EXISTIA=1
  DEPLOYED_PREVIO="$(cat "${PROD_DIR}/DEPLOYED_COMMIT")"
fi

reiniciar_y_verificar() { # -> 0 si pm2 restart funciona y /health/ready responde
  pm2 restart "${PROD_PM2_APP}" --update-env || return 1
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${PROD_PORT}/health/ready" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# --- Fase transaccional: cualquier fallo restaura el commit anterior -----------
TRANSACCION_OK=0
RESTAURADO=0
restaurar_produccion() {
  [ "${TRANSACCION_OK}" = "1" ] && return 0
  [ "${RESTAURADO}" = "1" ] && return 0
  RESTAURADO=1
  set +e
  echo "RESTAURANDO producción al commit ${ACTUAL}..." >&2
  git -C "${PROD_DIR}" checkout --detach --quiet "${ACTUAL}"
  (cd "${PROD_DIR}" && npm ci --omit=dev --no-audit --no-fund)
  if reiniciar_y_verificar; then
    if [ "${DEPLOYED_EXISTIA}" = "1" ]; then
      printf '%s\n' "${DEPLOYED_PREVIO}" > "${PROD_DIR}/DEPLOYED_COMMIT"
    else
      rm -f "${PROD_DIR}/DEPLOYED_COMMIT"
    fi
    registrar "${ACTUAL}" "auto-rollback"
    echo "Producción quedó revertida y saludable con ${ACTUAL}. Revisa pm2 logs ${PROD_PM2_APP}." >&2
  else
    echo "INTERVENCIÓN MANUAL URGENTE: la restauración tampoco respondió /health/ready. Revisa pm2 logs ${PROD_PM2_APP}." >&2
  fi
}
trap restaurar_produccion EXIT

echo "Activando commit ${SHA} en ${PROD_DIR}..."
git -C "${PROD_DIR}" checkout --detach --quiet "${SHA}"
[ -f "${PROD_DIR}/server.js" ] || fallo "el checkout no contiene server.js; se restaura el commit anterior."
(cd "${PROD_DIR}" && npm ci --omit=dev --no-audit --no-fund) \
  || fallo "npm ci falló con el commit ${SHA}; se restaura el commit anterior."
reiniciar_y_verificar \
  || fallo "producción no respondió /health/ready con el commit ${SHA}; se restaura el commit anterior."

TRANSACCION_OK=1
trap - EXIT
printf '%s\n' "${SHA}" > "${PROD_DIR}/DEPLOYED_COMMIT"
registrar "${SHA}" "promote"
echo "Producción actualizada al commit ${SHA}."
echo "Si algo falla: deploy/rollback-production.sh"
exit 0

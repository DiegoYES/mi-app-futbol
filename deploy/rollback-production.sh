#!/usr/bin/env bash
# Revierte PRODUCCIÓN (proceso PM2 "futbol-app") a un commit previamente
# registrado en RELEASE_HISTORY.
#
# Uso:   deploy/rollback-production.sh [commit]
#        Sin argumento, usa el commit anterior registrado en el historial.
# Vars:  PROD_DIR      (por defecto /var/www/mi-app-futbol)
#        PROD_PM2_APP  (por defecto futbol-app)
#        PROD_PORT     (por defecto 3000)
#
# Garantías:
#  - Sólo vuelve a commits registrados como activaciones saludables en
#    ${PROD_DIR}/RELEASE_HISTORY (campos exactos "fecha commit etiqueta").
#  - Valida por PM2 el nombre, script y cwd del proceso antes de tocarlo.
#  - Se niega si el árbol tiene cambios locales versionados.
#  - Exige confirmación explícita. No toca MongoDB. No borra nada.
#  - Transaccional: si fallan el checkout, npm ci, pm2 restart o el health
#    check, restaura el commit actual, sus dependencias y DEPLOYED_COMMIT, y
#    verifica que PM2 quede saludable.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="${PROD_DIR:-/var/www/mi-app-futbol}"
PROD_PM2_APP="${PROD_PM2_APP:-futbol-app}"
PROD_PORT="${PROD_PORT:-3000}"

fallo() { echo "ERROR: $*" >&2; exit 1; }

[ -d "${PROD_DIR}/.git" ] || fallo "PROD_DIR no es un repositorio git: ${PROD_DIR}"
command -v pm2 >/dev/null || fallo "pm2 no está disponible."
HISTORIAL="${PROD_DIR}/RELEASE_HISTORY"
[ -f "${HISTORIAL}" ] || fallo "no existe ${HISTORIAL}: no hay despliegues registrados a los que volver."

# --- Validación del proceso PM2 productivo -----------------------------------
JLIST="$(pm2 jlist)"
ESTADO="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${PROD_PM2_APP}" status)" \
  || fallo "no existe el proceso PM2 '${PROD_PM2_APP}'."
CWD_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${PROD_PM2_APP}" cwd)"
SCRIPT_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${PROD_PM2_APP}" script)"
[ "${CWD_PM2}" = "${PROD_DIR}" ] \
  || fallo "el proceso ${PROD_PM2_APP} ejecuta desde '${CWD_PM2}', no desde ${PROD_DIR}."
case "${SCRIPT_PM2}" in
  */server.js) : ;;
  *) fallo "el proceso ${PROD_PM2_APP} ejecuta '${SCRIPT_PM2}', no server.js; me niego a continuar." ;;
esac

OBJETIVO="${1:-}"
[ -z "$(git -C "${PROD_DIR}" status --porcelain --untracked-files=no)" ] \
  || fallo "el árbol de producción tiene cambios locales en archivos versionados; resuélvelos antes del rollback."
ACTUAL="$(git -C "${PROD_DIR}" rev-parse HEAD)"

# El historial registra SÓLO activaciones saludables, con campos exactos
# "<fecha> <commit> <etiqueta>". Los commits fallidos nunca aparecen.
if [ -z "${OBJETIVO}" ]; then
  # Última activación saludable distinta del commit actual.
  OBJETIVO="$(awk -v actual="${ACTUAL}" 'NF >= 2 && $2 != actual { ultimo = $2 } END { print ultimo }' "${HISTORIAL}")"
  [ -n "${OBJETIVO}" ] || fallo "el historial no registra un commit anterior distinto del actual; indícalo como argumento."
fi
git -C "${PROD_DIR}" cat-file -e "${OBJETIVO}^{commit}" 2>/dev/null \
  || fallo "el commit '${OBJETIVO}' no existe en ${PROD_DIR}."
OBJETIVO="$(git -C "${PROD_DIR}" rev-parse "${OBJETIVO}^{commit}")"
awk -v objetivo="${OBJETIVO}" 'NF >= 2 && $2 == objetivo { encontrado = 1 } END { exit encontrado ? 0 : 1 }' "${HISTORIAL}" \
  || fallo "el commit ${OBJETIVO} no aparece como activación saludable en ${HISTORIAL}; sólo se permite volver a commits registrados."
[ "${OBJETIVO}" != "${ACTUAL}" ] || fallo "producción ya ejecuta el commit ${OBJETIVO}; nada que revertir."

echo "Rollback de PRODUCCIÓN (PM2):"
echo "  Proceso        : ${PROD_PM2_APP} (estado: ${ESTADO}, cwd ${CWD_PM2})"
echo "  Commit actual  : ${ACTUAL}"
echo "  Volver a       : ${OBJETIVO}"
printf 'Escribe exactamente ROLLBACK para continuar: '
read -r CONFIRMACION
[ "${CONFIRMACION}" = "ROLLBACK" ] || fallo "confirmación incorrecta; no se hace nada."

registrar() { # registrar <commit> <etiqueta>
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "${HISTORIAL}"
}

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

# --- Fase transaccional: cualquier fallo restaura el commit actual -------------
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
    echo "Producción quedó restaurada y saludable con ${ACTUAL}. Revisa pm2 logs ${PROD_PM2_APP}." >&2
  else
    echo "INTERVENCIÓN MANUAL URGENTE: la restauración tampoco respondió /health/ready. Revisa pm2 logs ${PROD_PM2_APP}." >&2
  fi
}
trap restaurar_produccion EXIT

git -C "${PROD_DIR}" checkout --detach --quiet "${OBJETIVO}"
[ -f "${PROD_DIR}/server.js" ] || fallo "el checkout no contiene server.js; se restaura el commit actual."
(cd "${PROD_DIR}" && npm ci --omit=dev --no-audit --no-fund) \
  || fallo "npm ci falló con el commit ${OBJETIVO}; se restaura el commit actual."

echo "Reiniciando ${PROD_PM2_APP}..."
reiniciar_y_verificar \
  || fallo "producción no respondió /health/ready tras el rollback; se restaura el commit actual."

printf '%s\n' "${OBJETIVO}" > "${PROD_DIR}/DEPLOYED_COMMIT"
registrar "${OBJETIVO}" "rollback"
TRANSACCION_OK=1
trap - EXIT
echo "Rollback completado: producción sirve el commit ${OBJETIVO}."
exit 0
